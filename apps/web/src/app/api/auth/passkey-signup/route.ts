/**
 * POST /api/auth/passkey-signup
 *
 *   Body: { name, credentialIdBase64Url, pubKeyX, pubKeyY }
 *
 * Server:
 *   1. Generates a random salt → predicts smart account address.
 *   2. Deploys smart account with deployer as initial owner (so we can
 *      send UserOps before any passkey is registered).
 *   3. Submits a UserOp calling addPasskey(digest, x, y) on the new account.
 *   4. Stores the user row keyed by the smart account address.
 *   5. Mints a session JWT (kind=session, via=passkey) and sets the cookie.
 *
 * The deployer remains as a fallback owner — we keep it as a relayer-only
 * signer so future server-relayed UserOps still work. Production: user can
 * remove deployer once they enroll a 2nd passkey.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, toBytes, encodeFunctionData, createPublicClient, createWalletClient, http, getAddress } from 'viem'
import { localhost } from 'viem/chains'
import { getUserOperationHash, toPackedUserOperation } from 'viem/account-abstraction'
import { agentAccountAbi, agentAccountFactoryAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { mintSession, SESSION_COOKIE } from '@/lib/auth/native-session'
import { getWalletClient } from '@/lib/contracts'
import { eq } from 'drizzle-orm'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const ENTRYPOINT = (process.env.ENTRYPOINT_ADDRESS ?? '') as `0x${string}`
const FACTORY = (process.env.AGENT_FACTORY_ADDRESS ?? '') as `0x${string}`
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
const RELAYER_KEY = (process.env.PASSKEY_RELAYER_KEY ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') as `0x${string}`

const entryPointAbi = [
  { type: 'function', name: 'getNonce', inputs: [{ name: 'sender', type: 'address' }, { name: 'key', type: 'uint192' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function', name: 'handleOps',
    inputs: [
      { name: 'ops', type: 'tuple[]', components: [
        { name: 'sender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'initCode', type: 'bytes' },
        { name: 'callData', type: 'bytes' },
        { name: 'accountGasLimits', type: 'bytes32' },
        { name: 'preVerificationGas', type: 'uint256' },
        { name: 'gasFees', type: 'bytes32' },
        { name: 'paymasterAndData', type: 'bytes' },
        { name: 'signature', type: 'bytes' },
      ] },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
] as const

interface SignupBody {
  name: string
  credentialIdBase64Url: string
  pubKeyX: string  // decimal string (bigint)
  pubKeyY: string
}

export async function POST(request: Request) {
  try {
  if (!ENTRYPOINT || !FACTORY || !DEPLOYER_KEY) {
    return NextResponse.json({ error: 'auth chain config missing' }, { status: 500 })
  }
  // CSRF guard
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin && host && !origin.includes(host.split(':')[0])) {
    return NextResponse.json({ error: 'CSRF rejected' }, { status: 403 })
  }

  const body = await request.json() as SignupBody
  if (!body.name || !body.credentialIdBase64Url || !body.pubKeyX || !body.pubKeyY) {
    return NextResponse.json({ error: 'name, credentialIdBase64Url, pubKeyX, pubKeyY required' }, { status: 400 })
  }

  const credIdBytes = base64UrlDecode(body.credentialIdBase64Url)
  const credentialIdDigest = keccak256(credIdBytes)

  // Already enrolled? Block re-signup against the same credential.
  const credIdHex = credentialIdDigest.toLowerCase()
  const existing = await db.select().from(schema.users).where(eq(schema.users.id, credIdHex)).limit(1).then(r => r[0])
  if (existing) {
    return NextResponse.json({ error: 'credential already registered' }, { status: 409 })
  }

  const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })
  const deployer = privateKeyToAccount(DEPLOYER_KEY)
  const relayer = privateKeyToAccount(RELAYER_KEY)
  // Use the shared wallet client — its writeContract is wrapped with the
  // process-wide deployer-lock so this createAccount can't race with the
  // boot-seed loop's setStringProperty/setEdgeStatus writes (which would
  // produce a "nonce too low" since both use the same EOA).
  const deployerWallet = getWalletClient()

  // 1. Deploy smart account — owner=deployer, salt = keccak(credentialIdDigest|now).
  const salt = BigInt(keccak256(toBytes(`${credIdHex}${Date.now()}`)).slice(0, 18))
  const accountAddr = (await publicClient.readContract({
    address: FACTORY, abi: agentAccountFactoryAbi, functionName: 'getAddress',
    args: [deployer.address, salt],
  })) as `0x${string}`

  // Pre-fund prefund.
  await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [accountAddr, '0xde0b6b3a7640000'] }),
  })

  const code = await publicClient.getCode({ address: accountAddr })
  if (!code || code === '0x') {
    const hash = await deployerWallet.writeContract({
      address: FACTORY, abi: agentAccountFactoryAbi, functionName: 'createAccount',
      args: [deployer.address, salt],
    })
    await publicClient.waitForTransactionReceipt({ hash })
  }

  // 2. UserOp: addPasskey(digest, x, y) signed by deployer (currently the sole owner).
  const addPasskeyCalldata = encodeFunctionData({
    abi: agentAccountAbi, functionName: 'addPasskey',
    args: [credentialIdDigest, BigInt(body.pubKeyX), BigInt(body.pubKeyY)],
  })
  const outerCallData = encodeFunctionData({
    abi: agentAccountAbi, functionName: 'execute',
    args: [getAddress(accountAddr), 0n, addPasskeyCalldata],
  })
  const nonce = (await publicClient.readContract({
    address: ENTRYPOINT, abi: entryPointAbi, functionName: 'getNonce', args: [accountAddr, 0n],
  })) as bigint
  const userOp = {
    sender: accountAddr, nonce, callData: outerCallData,
    callGasLimit: 400_000n, verificationGasLimit: 400_000n, preVerificationGas: 80_000n,
    maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
    signature: '0x' as `0x${string}`,
  }
  const userOpHash = getUserOperationHash({
    userOperation: userOp, entryPointAddress: ENTRYPOINT, entryPointVersion: '0.8', chainId: CHAIN_ID,
  })
  const signature = await deployer.sign({ hash: userOpHash })
  const packed = toPackedUserOperation({ ...userOp, signature })
  const relayerWallet = createWalletClient({ account: relayer, chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })
  const txHash = await relayerWallet.writeContract({
    address: ENTRYPOINT, abi: entryPointAbi, functionName: 'handleOps',
    args: [[packed], relayer.address],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    return NextResponse.json({ error: `addPasskey reverted (tx ${txHash})` }, { status: 500 })
  }

  // 3. Insert user row. id = the credentialIdDigest (lowercased) so we can
  //    look up by it on sign-in. did = `did:passkey:<accountAddr>`.
  const accountAddrLower = accountAddr.toLowerCase() as `0x${string}`
  const did = `did:passkey:${CHAIN_ID}:${accountAddrLower}`
  await db.insert(schema.users).values({
    id: credIdHex,
    email: null,
    name: body.name,
    walletAddress: accountAddrLower,
    did: did,
    privateKey: null,
    smartAccountAddress: accountAddrLower,
    personAgentAddress: null,
  })

  // No server-side passkey mirror anymore — login resolves the smart
  // account by .agent name and verifies via on-chain isValidSignature.
  // The account's _passkeys[digest] mapping is the source of truth for
  // which credentials authorise the account.

  // 4. Mint session JWT.
  const cookieStore = await cookies()
  const jwt = mintSession({
    sub: did,
    walletAddress: accountAddrLower,
    smartAccountAddress: accountAddrLower,
    name: body.name,
    email: null,
    via: 'passkey',
    kind: 'session',
  })
  const response = NextResponse.json({
    success: true,
    user: {
      id: credIdHex,
      did,
      name: body.name,
      smartAccountAddress: accountAddrLower,
      credentialIdDigest,
    },
    txHash,
  })
  response.cookies.set(SESSION_COOKIE, jwt, {
    path: '/', maxAge: 60 * 60 * 24 * 30, httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  void cookieStore
  return response
  } catch (err) {
    // Always return JSON so the client's `await r.json()` can read the error.
    // Bare throws turn into a 500 with no body and the client crashes with
    // "Unexpected end of JSON input".
    const msg = err instanceof Error
      ? (err as Error & { shortMessage?: string }).shortMessage ?? err.message
      : 'passkey signup failed'
    console.error('[passkey-signup] failed:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  return new Uint8Array(Buffer.from(padded, 'base64'))
}
