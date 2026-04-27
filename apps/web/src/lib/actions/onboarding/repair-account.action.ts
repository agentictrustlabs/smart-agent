'use server'

/**
 * One-shot account repair for users whose account already had the bootstrap
 * server removed from `_owners` (legacy Phase 2 path). The resolver's
 * `onlyAgentOwner` modifier requires an ECDSA owner; passkeys aren't
 * recognised by that path. To unblock resolver writes for these accounts we
 * have the user sign a UserOp `account.execute(account, 0, addOwner(serverEOA))`
 * with their passkey — the EntryPoint validates the WebAuthn assertion via
 * `_validateSignature → _verifyWebAuthn`, the account self-calls `addOwner`,
 * and the deployer is back in the owner set.
 *
 * Two-step flow (mirrors the Phase 2 enroll dance):
 *   1. prepareReAuthBootstrapAction → returns the canonical userOpHash
 *      the client must sign with their passkey via navigator.credentials.get.
 *   2. completeReAuthBootstrapAction → packs the WebAuthn assertion as the
 *      UserOp signature (0x01 || abi.encode(Assertion)) and submits via
 *      EntryPoint.handleOps.
 */

import { privateKeyToAccount } from 'viem/accounts'
import {
  encodeFunctionData,
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

interface UnsignedUserOp {
  sender: `0x${string}`
  nonce: bigint
  callData: `0x${string}`
  callGasLimit: bigint
  verificationGasLimit: bigint
  preVerificationGas: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

const DEFAULT_GAS = {
  callGasLimit: 400_000n,
  verificationGasLimit: 400_000n,
  preVerificationGas: 80_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
}

export interface PrepareReAuthResult {
  success: boolean
  error?: string
  /** True iff the bootstrap server is already an owner — no repair needed. */
  alreadyOwner?: boolean
  /** Userop fields the client signs over via WebAuthn. Encoded as a string-bigint
   *  envelope (bigints serialised) so it survives a server→client→server round-trip. */
  unsignedOp?: {
    sender: `0x${string}`
    nonce: string
    callData: `0x${string}`
    callGasLimit: string
    verificationGasLimit: string
    preVerificationGas: string
    maxFeePerGas: string
    maxPriorityFeePerGas: string
  }
  /** EIP-712 userOpHash the user must sign with their passkey. */
  userOpHash?: `0x${string}`
  /** Credential IDs (base64url) of every passkey the user has registered on
   *  this smart account. Used as `allowCredentials` so the OS picker only
   *  offers credentials that will actually validate on-chain. */
  knownCredentialIds?: string[]
}

export async function prepareReAuthBootstrapAction(): Promise<PrepareReAuthResult> {
  try {
    if (!ENTRYPOINT) return { success: false, error: 'ENTRYPOINT_ADDRESS not configured' }
    if (!DEPLOYER_KEY) return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' }

    const session = await requireSession()
    const user = await db.select().from(schema.users)
      .where(eq(schema.users.did, session.userId)).limit(1).then(r => r[0])
    if (!user?.smartAccountAddress) return { success: false, error: 'no smart account on user row' }

    const accountAddr = getAddress(user.smartAccountAddress as `0x${string}`)
    const serverEOA = privateKeyToAccount(DEPLOYER_KEY).address as `0x${string}`

    const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

    // Fast path — server already in _owners; nothing to repair.
    const isOwner = await publicClient.readContract({
      address: accountAddr, abi: agentAccountAbi, functionName: 'isOwner',
      args: [serverEOA],
    }) as boolean
    if (isOwner) return { success: true, alreadyOwner: true }

    // The account must have at least one passkey for the user to sign the
    // repair UserOp. If they don't, this path is impossible.
    const pkCount = await publicClient.readContract({
      address: accountAddr, abi: agentAccountAbi, functionName: 'passkeyCount',
    }) as bigint
    if (pkCount === 0n) {
      return { success: false, error: 'account has no passkey to sign repair — finish /passkey-enroll first' }
    }

    // Top up so the EntryPoint prefund clears.
    const bal = await publicClient.getBalance({ address: accountAddr })
    if (bal < parseEther('0.5')) {
      await fetch(RPC_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'anvil_setBalance',
          params: [accountAddr, '0xde0b6b3a7640000'],
        }),
      })
    }

    // Build UserOp: execute(account, 0, addOwner(serverEOA))
    const innerCall = encodeFunctionData({
      abi: agentAccountAbi, functionName: 'addOwner', args: [serverEOA],
    })
    const callData = encodeFunctionData({
      abi: agentAccountAbi, functionName: 'execute',
      args: [accountAddr, 0n, innerCall],
    })

    const nonce = await publicClient.readContract({
      address: ENTRYPOINT, abi: entryPointAbi, functionName: 'getNonce',
      args: [accountAddr, 0n],
    }) as bigint

    const unsignedOp: UnsignedUserOp = {
      sender: accountAddr,
      nonce,
      callData,
      ...DEFAULT_GAS,
    }
    const userOpHash = getUserOperationHash({
      userOperation: { ...unsignedOp, signature: '0x' as `0x${string}` },
      entryPointAddress: ENTRYPOINT,
      entryPointVersion: '0.8',
      chainId: CHAIN_ID,
    })

    // No server-side passkey mirror — the OS picker is unconstrained.
    // Local browser hints (localStorage smart-agent.passkeys.local) cover
    // the common case; users on a fresh browser pick from their full list.
    const knownCredentialIds: string[] = []

    return {
      success: true,
      alreadyOwner: false,
      userOpHash,
      unsignedOp: {
        sender: unsignedOp.sender,
        nonce: unsignedOp.nonce.toString(),
        callData: unsignedOp.callData,
        callGasLimit: unsignedOp.callGasLimit.toString(),
        verificationGasLimit: unsignedOp.verificationGasLimit.toString(),
        preVerificationGas: unsignedOp.preVerificationGas.toString(),
        maxFeePerGas: unsignedOp.maxFeePerGas.toString(),
        maxPriorityFeePerGas: unsignedOp.maxPriorityFeePerGas.toString(),
      },
      knownCredentialIds,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'prepare failed' }
  }
}

export interface CompleteReAuthArgs {
  unsignedOp: NonNullable<PrepareReAuthResult['unsignedOp']>
  /** 0x01 || abi.encode(WebAuthnLib.Assertion) — the passkey signature on userOpHash. */
  passkeySignature: `0x${string}`
  /** base64url credentialId of the passkey the user signed with. We use this
   *  to backfill the server-side passkeys mirror for legacy accounts that
   *  enrolled before the mirror existed. */
  credentialIdBase64Url?: string
}

export interface CompleteReAuthResult {
  success: boolean
  error?: string
  txHash?: `0x${string}`
}

export async function completeReAuthBootstrapAction(args: CompleteReAuthArgs): Promise<CompleteReAuthResult> {
  try {
    if (!ENTRYPOINT) return { success: false, error: 'ENTRYPOINT_ADDRESS not configured' }
    if (!DEPLOYER_KEY) return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' }

    await requireSession()

    const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

    // Pre-flight: check that the credential the user signed with is actually
    // registered on the account. If not, handleOps reverts with the cryptic
    // AA24; instead, fail fast with a clear message and route the user into
    // the recovery flow.
    if (args.credentialIdBase64Url) {
      try {
        const { keccak256 } = await import('viem')
        const credBytes = base64UrlDecode(args.credentialIdBase64Url)
        const digest = keccak256(credBytes)
        const has = await publicClient.readContract({
          address: args.unsignedOp.sender,
          abi: agentAccountAbi,
          functionName: 'hasPasskey',
          args: [digest],
        }) as boolean
        if (!has) {
          return {
            success: false,
            error: 'PASSKEY_NOT_REGISTERED',
          }
        }
      } catch (e) {
        console.warn('[repair] hasPasskey pre-flight failed (continuing):', (e as Error).message)
      }
    }

    const signedOp = {
      sender: args.unsignedOp.sender,
      nonce: BigInt(args.unsignedOp.nonce),
      callData: args.unsignedOp.callData,
      callGasLimit: BigInt(args.unsignedOp.callGasLimit),
      verificationGasLimit: BigInt(args.unsignedOp.verificationGasLimit),
      preVerificationGas: BigInt(args.unsignedOp.preVerificationGas),
      maxFeePerGas: BigInt(args.unsignedOp.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(args.unsignedOp.maxPriorityFeePerGas),
      signature: args.passkeySignature,
    }
    const packed = toPackedUserOperation(signedOp)

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
      return { success: false, error: `handleOps reverted (${txHash})`, txHash }
    }

    // Surface inner UserOp reverts (handleOps swallows them by default).
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
    const reverts = parseEventLogs({ abi: revertAbi, eventName: 'UserOperationRevertReason', logs: receipt.logs })
    if (reverts.length > 0) {
      return { success: false, error: `UserOp reverted: ${reverts[0].args.revertReason}`, txHash }
    }

    // No server-side passkey mirror — the on-chain account._passkeys[digest]
    // mapping is the source of truth. Login resolves accounts by .agent name.

    return { success: true, txHash }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'complete failed' }
  }
}

function base64UrlDecode(s: string): `0x${string}` {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  return ('0x' + Buffer.from(padded, 'base64').toString('hex')) as `0x${string}`
}
