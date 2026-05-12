/**
 * POST /api/auth/siwe-verify
 *
 *   Body: { token, message, signature, address }
 *
 * Server:
 *   1. Verify (token, nonce-from-message) via verifySiweChallengeToken.
 *   2. Verify the SIWE signature via viem.verifyMessage.
 *   3. Look up or create a user row keyed by walletAddress (lowercased).
 *      For new users, deploy a smart account via factory.createAccount(eoa, salt=0).
 *   4. Mint a session JWT (kind=session, via=siwe), set cookie.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyMessage, getAddress, createPublicClient, createWalletClient, http, parseEther } from 'viem'
import { localhost } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { agentAccountFactoryAbi } from '@smart-agent/sdk'
import { mintSession, SESSION_COOKIE } from '@/lib/auth/native-session'
import { verifySiweChallengeToken } from '@/lib/auth/passkey-challenge'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const FACTORY = (process.env.AGENT_FACTORY_ADDRESS ?? '') as `0x${string}`
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined

interface VerifyBody {
  token: string
  message: string
  signature: `0x${string}`
  address: `0x${string}`
}

export async function POST(request: Request) {
  if (!FACTORY || !DEPLOYER_KEY) {
    return NextResponse.json({ error: 'auth chain config missing' }, { status: 500 })
  }
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin && host && !origin.includes(host.split(':')[0])) {
    return NextResponse.json({ error: 'CSRF rejected' }, { status: 403 })
  }

  const body = await request.json() as VerifyBody
  const nonce = extractNonce(body.message)
  if (!nonce) return NextResponse.json({ error: 'message missing nonce' }, { status: 400 })
  if (!verifySiweChallengeToken(body.token, nonce)) {
    return NextResponse.json({ error: 'invalid or expired challenge' }, { status: 401 })
  }

  // Verify the signature was produced by the address claimed in the message.
  const messageAddress = extractAddress(body.message)
  if (!messageAddress || messageAddress.toLowerCase() !== body.address.toLowerCase()) {
    return NextResponse.json({ error: 'address/message mismatch' }, { status: 400 })
  }

  const ok = await verifyMessage({
    address: body.address,
    message: body.message,
    signature: body.signature,
  })
  if (!ok) return NextResponse.json({ error: 'invalid SIWE signature' }, { status: 401 })

  const eoa = getAddress(body.address)
  const eoaLower = eoa.toLowerCase() as `0x${string}`

  // SIWE auth is stateless: deploy the AgentAccount counter-factually on
  // first sign-in if needed, then mint a session entirely from on-chain
  // state. No `users` row is written — the session JWT carries display
  // name + smartAccount, and the user's person-mcp owns their profile.
  const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })
  const smartAcct = (await publicClient.readContract({
    address: FACTORY, abi: agentAccountFactoryAbi, functionName: 'getAddress', args: [eoa, 0n],
  })) as `0x${string}`
  const smartAcctLower = smartAcct.toLowerCase() as `0x${string}`

  const code = await publicClient.getCode({ address: smartAcct })
  if (!code || code === '0x') {
    const deployer = privateKeyToAccount(DEPLOYER_KEY)
    const wallet = createWalletClient({ account: deployer, chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })
    await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [smartAcct, '0xde0b6b3a7640000'] }),
    })
    const hash = await wallet.writeContract({
      address: FACTORY, abi: agentAccountFactoryAbi, functionName: 'createAccount', args: [eoa, 0n],
    })
    await publicClient.waitForTransactionReceipt({ hash })
  }

  // Spec 005 — provision personal treasury (idempotent). Non-fatal.
  try {
    const { ensurePersonalTreasury } = await import('@/lib/treasury/provision')
    const provisioned = await ensurePersonalTreasury(smartAcctLower)
    if (!provisioned.ok) {
      console.warn('[siwe-verify] treasury provision incomplete:', provisioned.warnings)
    }
  } catch (e) {
    console.warn('[siwe-verify] treasury provision threw:', (e as Error).message)
  }

  const cookieStore = await cookies()
  const did = `did:ethr:${CHAIN_ID}:${eoaLower}`
  const name = `Wallet ${eoaLower.slice(0, 6)}…${eoaLower.slice(-4)}`
  const jwt = mintSession({
    sub: did,
    walletAddress: eoaLower,
    smartAccountAddress: smartAcctLower,
    name,
    email: null,
    via: 'siwe',
    kind: 'session',
  })
  const response = NextResponse.json({
    success: true,
    user: { id: smartAcctLower, did, name, walletAddress: eoaLower, smartAccountAddress: smartAcctLower },
  })
  response.cookies.set(SESSION_COOKIE, jwt, {
    path: '/', maxAge: 60 * 60 * 24 * 30, httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  void cookieStore
  return response
}

function extractNonce(message: string): string | null {
  const m = message.match(/^Nonce: ([0-9a-fA-F]+)$/m)
  return m ? m[1] : null
}

function extractAddress(message: string): `0x${string}` | null {
  // The 2nd line of the SIWE message is the address (per spec).
  const lines = message.split('\n')
  const candidate = lines[1]?.trim()
  return candidate && /^0x[0-9a-fA-F]{40}$/.test(candidate) ? candidate as `0x${string}` : null
}

void parseEther
