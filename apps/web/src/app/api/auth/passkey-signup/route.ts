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
import {
  agentAccountAbi, agentAccountFactoryAbi,
  agentNameRegistryAbi, agentNameResolverAbi, agentAccountResolverAbi,
  ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  TYPE_PERSON,
  namehash, namehashRoot,
} from '@smart-agent/sdk'

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
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
  /** Bare label the user typed, e.g. "richp". Server appends ".agent". */
  agentLabel: string
  credentialIdBase64Url: string
  pubKeyX: string  // decimal string (bigint)
  pubKeyY: string
}

/** Lowercase letters/digits/hyphens, 1–32 chars, no leading/trailing hyphen,
 *  no double hyphens. Mirrors a conservative DNS-style label rule so the
 *  resulting `<label>.agent` is a sane on-chain name. */
function isValidLabel(label: string): boolean {
  if (label.length < 1 || label.length > 32) return false
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(label)) return false
  if (label.includes('--')) return false
  return true
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
  if (!body.agentLabel || !body.credentialIdBase64Url || !body.pubKeyX || !body.pubKeyY) {
    return NextResponse.json({ error: 'agentLabel, credentialIdBase64Url, pubKeyX, pubKeyY required' }, { status: 400 })
  }
  const label = body.agentLabel.toLowerCase().trim()
  if (!isValidLabel(label)) {
    return NextResponse.json({ error: 'invalid label — use 1–32 chars: lowercase letters, digits, hyphens (no leading/trailing/double hyphens)' }, { status: 400 })
  }
  const fullName = `${label}.agent`

  const NAME_REGISTRY = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}` | undefined
  const NAME_RESOLVER = process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}` | undefined
  const ACCOUNT_RESOLVER = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!NAME_REGISTRY || !NAME_RESOLVER || !ACCOUNT_RESOLVER) {
    return NextResponse.json({ error: 'name registry not configured' }, { status: 500 })
  }

  const credIdBytes = base64UrlDecode(body.credentialIdBase64Url)
  const credentialIdDigest = keccak256(credIdBytes)
  const credIdHex = credentialIdDigest.toLowerCase()

  const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

  // Reject early if the .agent name is already registered. The registry's
  // register() also reverts on collision, but checking up front gives a
  // clean error before we do any deploy work.
  const fullNode = namehash(fullName) as `0x${string}`
  const nameTaken = await publicClient.readContract({
    address: NAME_REGISTRY, abi: agentNameRegistryAbi,
    functionName: 'recordExists', args: [fullNode],
  }) as boolean
  if (nameTaken) {
    return NextResponse.json({ error: `${fullName} is taken` }, { status: 409 })
  }

  // Block re-signup against the same credential.
  const existing = await db.select().from(schema.users).where(eq(schema.users.id, credIdHex)).limit(1).then(r => r[0])
  if (existing) {
    return NextResponse.json({ error: 'credential already registered' }, { status: 409 })
  }

  const deployer = privateKeyToAccount(DEPLOYER_KEY)
  const relayer = privateKeyToAccount(RELAYER_KEY)
  // Use the shared wallet client — its writeContract is wrapped with the
  // process-wide deployer-lock so this createAccount can't race with the
  // boot-seed loop's setStringProperty/setEdgeStatus writes (which would
  // produce a "nonce too low" since both use the same EOA).
  const deployerWallet = getWalletClient()

  // 1. Deploy smart account — owner=deployer, salt = keccak(fullName).
  // Using the name as the salt seed makes the address counterfactual and
  // deterministic from what the user typed; the same name always points
  // to the same address even before the contract is deployed.
  const salt = BigInt(keccak256(toBytes(fullName)).slice(0, 18))
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

  // 3. Register `<label>.agent` in the AgentNameRegistry, pointing the
  //    address record at the freshly-deployed smart account. .agent root
  //    is owned by the deployer, so the deployer can mint child names.
  //    setAddr passes auth because deployer is the initial owner of the
  //    new smart account (registry.owner(child) is the smart account, and
  //    smart-account.isOwner(deployer) returns true).
  //
  //    waitForTransactionReceipt does NOT throw on a reverted tx — it
  //    returns { status: 'reverted' }. We must check status explicitly,
  //    otherwise a silent revert here lands the user with a deployed
  //    account that has no .agent name and breaks sign-in.
  const accountAddrLower = accountAddr.toLowerCase() as `0x${string}`
  const agentRoot = namehashRoot('agent') as `0x${string}`
  try {
    const regHash = await deployerWallet.writeContract({
      address: NAME_REGISTRY, abi: agentNameRegistryAbi,
      functionName: 'register',
      args: [agentRoot, label, accountAddr, NAME_RESOLVER, 0n],
    })
    const regReceipt = await publicClient.waitForTransactionReceipt({ hash: regHash })
    if (regReceipt.status !== 'success') {
      throw new Error(`AgentNameRegistry.register reverted (tx ${regHash})`)
    }
    const setAddrHash = await deployerWallet.writeContract({
      address: NAME_RESOLVER, abi: agentNameResolverAbi,
      functionName: 'setAddr', args: [fullNode, accountAddr],
    })
    const setAddrReceipt = await publicClient.waitForTransactionReceipt({ hash: setAddrHash })
    if (setAddrReceipt.status !== 'success') {
      throw new Error(`AgentNameResolver.setAddr reverted (tx ${setAddrHash})`)
    }
  } catch (err) {
    // Name registration failure shouldn't strand a deployed account, but
    // it does mean the user can't sign in by name. Surface explicitly.
    return NextResponse.json({
      error: `name registration failed: ${(err as Error).message}`,
      detail: 'account is deployed but the .agent name was not registered',
    }, { status: 500 })
  }

  // 4. Register the smart account itself in the AgentAccountResolver so
  //    setStringProperty / getCore / etc. work for it. AgentAccountResolver
  //    requires the agent to be `register`ed before any property writes;
  //    otherwise NotRegistered() (0xaba47339) reverts every setStringProperty
  //    call. Auth: AgentAccountResolver.register uses onlyAgentOwner, and
  //    deployer is an initial owner of the freshly-created account.
  try {
    const regHash = await deployerWallet.writeContract({
      address: ACCOUNT_RESOLVER, abi: agentAccountResolverAbi,
      functionName: 'register',
      args: [accountAddr, fullName, '', TYPE_PERSON, ZERO_HASH, ''],
    })
    const r = await publicClient.waitForTransactionReceipt({ hash: regHash })
    if (r.status !== 'success') {
      console.warn(`[passkey-signup] AgentAccountResolver.register reverted (tx ${regHash}) — display props will be unset`)
    }
  } catch (e) {
    console.warn('[passkey-signup] AgentAccountResolver.register failed (non-fatal):', (e as Error).message)
  }

  // 5. Set the resolver display props so reverse-resolution + name display
  //    elsewhere in the app know what to show. Best-effort; failure here
  //    only affects display, not login.
  try {
    await deployerWallet.writeContract({
      address: ACCOUNT_RESOLVER, abi: agentAccountResolverAbi,
      functionName: 'setStringProperty',
      args: [accountAddr, ATL_NAME_LABEL as `0x${string}`, label],
    })
    await deployerWallet.writeContract({
      address: ACCOUNT_RESOLVER, abi: agentAccountResolverAbi,
      functionName: 'setStringProperty',
      args: [accountAddr, ATL_PRIMARY_NAME as `0x${string}`, fullName],
    })
  } catch (e) {
    console.warn('[passkey-signup] resolver props failed (non-fatal):', (e as Error).message)
  }

  // 5. Insert user row. id = credentialIdDigest (kept for legacy lookups),
  //    did = did:passkey:<chainId>:<accountAddr>, agentName = full name so
  //    the user's identity in the app matches their on-chain name.
  const did = `did:passkey:${CHAIN_ID}:${accountAddrLower}`
  await db.insert(schema.users).values({
    id: credIdHex,
    email: null,
    name: fullName,
    walletAddress: accountAddrLower,
    did: did,
    privateKey: null,
    smartAccountAddress: accountAddrLower,
    personAgentAddress: null,
    agentName: fullName,
  })

  // No server-side passkey mirror anymore — login resolves the smart
  // account by .agent name and verifies via on-chain isValidSignature.
  // The account's _passkeys[digest] mapping is the source of truth for
  // which credentials authorise the account.

  // 6. Mint session JWT.
  const cookieStore = await cookies()
  const jwt = mintSession({
    sub: did,
    walletAddress: accountAddrLower,
    smartAccountAddress: accountAddrLower,
    name: fullName,
    email: null,
    via: 'passkey',
    kind: 'session',
  })
  const response = NextResponse.json({
    success: true,
    user: {
      id: credIdHex,
      did,
      name: fullName,
      agentName: fullName,
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
