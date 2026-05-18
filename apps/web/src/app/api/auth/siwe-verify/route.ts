/** @sa-route bootstrap @sa-auth none-with-csrf @sa-rate-limit 10/min @sa-risk-tier high @sa-validation zod @sa-owner security */
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
import { agentAccountFactoryAbi } from '@smart-agent/sdk'
import { mintSession, SESSION_COOKIE } from '@/lib/auth/native-session'
import { verifySiweChallengeToken } from '@/lib/auth/passkey-challenge'
import { getAuthBootstrapSigner } from '@/lib/key-custody/tool-executor'
import { requireOriginAllowed } from '@/lib/auth/csrf'
import { z } from 'zod'
import { validateRequest } from '@/lib/auth/validate-request'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const FACTORY = (process.env.AGENT_FACTORY_ADDRESS ?? '') as `0x${string}`

// SIWE messages are a few hundred bytes; signatures are 65 bytes →
// 132 hex chars. 8 KiB cap on the message is generous and stops a
// caller flooding `viem.verifyMessage` with a multi-MB payload.
const BodySchema = z.object({
  token: z.string().min(1).max(8192),
  message: z.string().min(1).max(8192),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(512),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
})

export async function POST(request: Request) {
  if (!FACTORY) {
    return NextResponse.json({ error: 'auth chain config missing' }, { status: 500 })
  }
  // S2.2 — CSRF guard via parsed-URL exact-allowlist.
  const csrfDenied = requireOriginAllowed(request)
  if (csrfDenied) return csrfDenied

  const parsed = await validateRequest(request, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const body = parsed.data as {
    token: string
    message: string
    signature: `0x${string}`
    address: `0x${string}`
  }
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
    // K6 S1.5 — sign with the dedicated `auth-bootstrap` tool-executor key
    // (separate KMS slot in prod), NOT the deployer private key. The
    // factory cares about gas + signature; the EOA owner of the new
    // smart account is `eoa` (the user's SIWE wallet), so the bootstrap
    // signer is a pure relayer here.
    const bootstrap = await getAuthBootstrapSigner()
    const wallet = createWalletClient({ account: bootstrap, chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })
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

  // Spec 005 + 006 — provision a distinct personal treasury agent
  // (idempotent). User's signing EOA is the SIWE wallet address.
  // Non-fatal.
  try {
    const { ensurePersonalTreasury } = await import('@/lib/treasury/provision')
    const provisioned = await ensurePersonalTreasury(smartAcctLower, eoa)
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
