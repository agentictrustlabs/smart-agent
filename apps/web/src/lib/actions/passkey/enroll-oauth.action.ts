'use server'

/**
 * OAuth enrollment is a 3-step browser dance:
 *
 *   1. Browser: navigator.credentials.create()  → new passkey (digest, X, Y)
 *   2. Server: enrollOAuthAddPasskeyAction
 *        → UserOp addPasskey signed by serverEOA (still co-owner)
 *        → builds the recovery delegation (delegator=account, delegate=server,
 *          caveats=[Recovery + AllowedTargets + AllowedMethods]) and returns
 *          the delegation + EIP-712 hash for the client to sign.
 *   3. Browser: navigator.credentials.get(challenge=delegationHash)
 *      → WebAuthn assertion proving the new passkey signed the delegation.
 *      Encoded as 0x01 || abi.encode(Assertion) (account.isValidSignature
 *      passkey path).
 *   4. Server: enrollOAuthFinalizeAction
 *        → stores the signed delegation in DB
 *        → UserOp removeOwner(serverEOA) signed by serverEOA
 *        → account is now passkey-only with a recovery delegation in place.
 *
 * The two-ceremony enrollment is the cost of true non-custody: the recovery
 * delegation must be signed by a key that remains valid after the bootstrap
 * server is removed (the new passkey), not by the server itself.
 */

import { privateKeyToAccount } from 'viem/accounts'
import {
  encodeFunctionData,
  keccak256,
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseEther,
  parseEventLogs,
} from 'viem'
import { localhost } from 'viem/chains'
import { getUserOperationHash, toPackedUserOperation } from 'viem/account-abstraction'
import { agentAccountAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { buildRecoveryDelegation } from '@/lib/recovery/delegation'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const ENTRYPOINT = (process.env.ENTRYPOINT_ADDRESS ?? '') as `0x${string}`
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
const RELAYER_KEY = (process.env.PASSKEY_RELAYER_KEY ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') as `0x${string}`

const entryPointAbi = [
  {
    type: 'function', name: 'getNonce',
    inputs: [{ name: 'sender', type: 'address' }, { name: 'key', type: 'uint192' }],
    outputs: [{ name: 'nonce', type: 'uint256' }], stateMutability: 'view',
  },
  {
    type: 'function', name: 'handleOps',
    inputs: [
      {
        name: 'ops', type: 'tuple[]', components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'accountGasLimits', type: 'bytes32' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
] as const

// ─── Step 1: addPasskey + build recovery delegation ─────────────────

export interface EnrollAddPasskeyArgs {
  credentialIdBase64Url: string
  pubKeyX: string
  pubKeyY: string
}

/** Serialisable delegation with bigint salt converted to string. */
export interface SerialDelegation {
  delegator: `0x${string}`
  delegate: `0x${string}`
  authority: `0x${string}`
  caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}`; args: `0x${string}` }>
  salt: string
}

export interface EnrollAddPasskeyResult {
  success: boolean
  error?: string
  credentialIdDigest?: `0x${string}`
  accountAddress?: `0x${string}`
  txHashAddPasskey?: `0x${string}`
  /** Delegation to be signed by the new passkey on the client. */
  delegation?: SerialDelegation
  /** EIP-712 hash that the client signs via WebAuthn. */
  delegationHash?: `0x${string}`
}

export async function enrollOAuthAddPasskeyAction(args: EnrollAddPasskeyArgs): Promise<EnrollAddPasskeyResult> {
  try {
    if (!ENTRYPOINT) return { success: false, error: 'ENTRYPOINT_ADDRESS not configured' }
    if (!DEPLOYER_KEY) return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' }

    const session = await requireSession()
    if (session.via !== 'google') {
      return { success: false, error: `OAuth-only path (session.via=${session.via ?? 'unknown'})` }
    }

    const userRow = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1).then(r => r[0])
    if (!userRow?.smartAccountAddress) return { success: false, error: 'no smart account on user row' }
    const accountAddr = getAddress(userRow.smartAccountAddress as `0x${string}`)

    const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

    const code = await publicClient.getCode({ address: accountAddr })
    if (!code || code === '0x') return { success: false, error: `account ${accountAddr} not deployed` }

    const bal = await publicClient.getBalance({ address: accountAddr })
    if (bal < parseEther('0.5')) {
      await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'anvil_setBalance',
          params: [accountAddr, '0xde0b6b3a7640000'],
        }),
      })
    }

    const credIdBytes = base64UrlDecode(args.credentialIdBase64Url)
    const credentialIdDigest = keccak256(credIdBytes)
    const already = (await publicClient.readContract({
      address: accountAddr, abi: agentAccountAbi,
      functionName: 'hasPasskey', args: [credentialIdDigest],
    })) as boolean
    if (already) return { success: false, error: `credential already registered (digest ${credentialIdDigest})` }

    const addPasskeyCalldata = encodeFunctionData({
      abi: agentAccountAbi, functionName: 'addPasskey',
      args: [credentialIdDigest, BigInt(args.pubKeyX), BigInt(args.pubKeyY)],
    })
    const txAdd = await sendUserOp({
      accountAddr,
      callData: encodeFunctionData({
        abi: agentAccountAbi, functionName: 'execute',
        args: [accountAddr, 0n, addPasskeyCalldata],
      }),
      publicClient,
    })
    if (!txAdd.success) return { success: false, error: `addPasskey failed: ${txAdd.error}` }

    // Mirror the credential server-side so future passkey-signed flows
    // (recovery, repair) can constrain the OS picker to only credentials
    // actually registered on this account, even on a fresh browser where
    // localStorage hints aren't available.
    try {
      await db.insert(schema.passkeys).values({
        id: crypto.randomUUID(),
        userId: userRow.id,
        accountAddress: accountAddr.toLowerCase(),
        credentialIdBase64Url: args.credentialIdBase64Url,
        credentialIdDigest: credentialIdDigest,
        pubKeyX: args.pubKeyX,
        pubKeyY: args.pubKeyY,
        label: null,
      }).onConflictDoNothing()
    } catch (e) {
      console.warn('[enroll-oauth] failed to mirror passkey to DB (non-fatal):', (e as Error).message)
    }

    // Build the recovery delegation; signing happens client-side (passkey).
    const serverEOA = privateKeyToAccount(DEPLOYER_KEY).address as `0x${string}`
    const enforcerAddrs = {
      recovery: process.env.RECOVERY_ENFORCER_ADDRESS as `0x${string}`,
      allowedTargets: process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as `0x${string}`,
      allowedMethods: process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as `0x${string}`,
    }
    const dmAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
    if (!enforcerAddrs.recovery || !enforcerAddrs.allowedTargets || !enforcerAddrs.allowedMethods || !dmAddr) {
      // Recovery isn't deployed — succeed anyway, but skip delegation. Phase 3
      // is non-fatal: without it the user just can't recover lost devices.
      return {
        success: true,
        credentialIdDigest,
        accountAddress: accountAddr,
        txHashAddPasskey: txAdd.txHash,
      }
    }
    const built = buildRecoveryDelegation({
      accountAddress: accountAddr,
      serverEOA,
      enforcers: enforcerAddrs,
      chainId: CHAIN_ID,
      delegationManager: dmAddr,
    })
    return {
      success: true,
      credentialIdDigest,
      accountAddress: accountAddr,
      txHashAddPasskey: txAdd.txHash,
      delegation: {
        delegator: built.delegator,
        delegate: built.delegate,
        authority: built.authority,
        caveats: built.caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms, args: '0x' as `0x${string}` })),
        salt: built.salt.toString(),
      },
      delegationHash: built.hash,
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ─── Step 2: store signed delegation + remove server-owner ──────────

export interface EnrollFinalizeArgs {
  delegation: SerialDelegation
  /** 0x01 || abi.encode(Assertion) — passkey signature on delegationHash. */
  delegationSignature: `0x${string}`
  /** Hash returned by step 1; stored alongside the delegation for revocation lookups. */
  delegationHash: `0x${string}`
}

export interface EnrollFinalizeResult {
  success: boolean
  error?: string
  txHashRemoveOwner?: `0x${string}`
}

export async function enrollOAuthFinalizeAction(args: EnrollFinalizeArgs): Promise<EnrollFinalizeResult> {
  try {
    if (!ENTRYPOINT) return { success: false, error: 'ENTRYPOINT_ADDRESS not configured' }
    if (!DEPLOYER_KEY) return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' }

    const session = await requireSession()
    if (session.via !== 'google') {
      return { success: false, error: `OAuth-only path (session.via=${session.via ?? 'unknown'})` }
    }
    const userRow = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1).then(r => r[0])
    if (!userRow?.smartAccountAddress) return { success: false, error: 'no smart account on user row' }
    const accountAddr = getAddress(userRow.smartAccountAddress as `0x${string}`)

    const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

    // Persist delegation. We do this BEFORE removing the server-owner so that
    // a transient failure on removeOwner doesn't leave the account without a
    // recovery path. (Re-running enroll handles the duplicate-digest case.)
    const recoveryConfig = JSON.stringify({
      guardians: [privateKeyToAccount(DEPLOYER_KEY).address],
      threshold: 1,
      delaySeconds: Number(process.env.RECOVERY_DELAY_SECONDS ?? '60'),
    })
    const delegationJson = JSON.stringify({
      ...args.delegation,
      signature: args.delegationSignature,
    })
    await db.insert(schema.recoveryDelegations).values({
      id: crypto.randomUUID(),
      accountAddress: accountAddr.toLowerCase(),
      delegationJson,
      delegationHash: args.delegationHash,
      recoveryConfigJson: recoveryConfig,
    }).onConflictDoUpdate({
      target: schema.recoveryDelegations.accountAddress,
      set: { delegationJson, delegationHash: args.delegationHash, recoveryConfigJson: recoveryConfig },
    })

    // NB: we deliberately do NOT removeOwner(serverEOA) here. Removing the
    // bootstrap server breaks server-signed onboarding writes (registry
    // registration, .agent-name records) because every resolver call in
    // AgentAccountResolver and AgentNameResolver checks `agent.isOwner(msg.sender)`
    // and there's no ECDSA owner left to authenticate as. The recovery
    // delegation we just stored covers the non-custodial-recovery promise;
    // Phase 4 (ERC-1271 / passkey-signed resolver writes) is the proper lift
    // that lets us drop the server-owner safely.
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ─── Internal: sign + submit a UserOp from the server EOA ───────────

async function sendUserOp(opts: {
  accountAddr: `0x${string}`
  callData: `0x${string}`
  publicClient: ReturnType<typeof createPublicClient>
}): Promise<{ success: boolean; error?: string; txHash?: `0x${string}` }> {
  const { accountAddr, callData, publicClient } = opts
  if (!DEPLOYER_KEY) return { success: false, error: 'no DEPLOYER_KEY' }

  const nonce = (await publicClient.readContract({
    address: ENTRYPOINT, abi: entryPointAbi, functionName: 'getNonce',
    args: [accountAddr, 0n],
  })) as bigint

  const userOp = {
    sender: accountAddr,
    nonce,
    callData,
    callGasLimit: 400_000n,
    verificationGasLimit: 400_000n,
    preVerificationGas: 80_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    signature: '0x' as `0x${string}`,
  }
  const userOpHash = getUserOperationHash({
    userOperation: userOp,
    entryPointAddress: ENTRYPOINT,
    entryPointVersion: '0.8',
    chainId: CHAIN_ID,
  })

  const serverAccount = privateKeyToAccount(DEPLOYER_KEY)
  const signature = await serverAccount.sign({ hash: userOpHash })
  const packed = toPackedUserOperation({ ...userOp, signature })

  const relayer = privateKeyToAccount(RELAYER_KEY)
  const walletClient = createWalletClient({
    account: relayer,
    chain: { ...localhost, id: CHAIN_ID },
    transport: http(RPC_URL),
  })

  const txHash = await walletClient.writeContract({
    address: ENTRYPOINT, abi: entryPointAbi, functionName: 'handleOps',
    args: [[packed], relayer.address],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    return { success: false, error: `handleOps reverted (tx ${txHash})`, txHash }
  }
  const revertAbi = [
    {
      type: 'event', name: 'UserOperationRevertReason',
      inputs: [
        { name: 'userOpHash', type: 'bytes32', indexed: true },
        { name: 'sender', type: 'address', indexed: true },
        { name: 'nonce', type: 'uint256', indexed: false },
        { name: 'revertReason', type: 'bytes', indexed: false },
      ],
    },
  ] as const
  const userOpRevertLogs = parseEventLogs({
    abi: revertAbi,
    eventName: 'UserOperationRevertReason',
    logs: receipt.logs,
  })
  if (userOpRevertLogs.length > 0) {
    return { success: false, error: `UserOp reverted: ${userOpRevertLogs[0].args.revertReason}`, txHash }
  }
  return { success: true, txHash }
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  const bin = Buffer.from(padded, 'base64')
  return new Uint8Array(bin)
}
