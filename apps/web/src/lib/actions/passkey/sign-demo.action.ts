'use server'

/**
 * Passkey-sign demo.
 *
 * prepareUserOpAction: builds a no-op UserOp (execute(account, 0, "0x"))
 *                     targeting the current user's smart account, fetches
 *                     the nonce from EntryPoint, returns the UserOp fields
 *                     + userOpHash so the client can sign it via WebAuthn.
 *
 * submitPasskeySignedOpAction: takes the UserOp + a passkey-built signature
 *                              (0x01 || abi.encode(Assertion)) and submits
 *                              via entryPoint.handleOps. If the account's
 *                              _validateSignature agrees (passkey registered
 *                              + valid WebAuthn assertion + P-256 verify
 *                              succeeds), the op lands. Otherwise handleOps
 *                              reverts and we surface the error.
 */

import { privateKeyToAccount } from 'viem/accounts'
import {
  encodeFunctionData,
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseEther,
} from 'viem'
import { localhost } from 'viem/chains'
import { getUserOperationHash, toPackedUserOperation } from 'viem/account-abstraction'
import { agentAccountAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { loadSignerForCurrentUser } from '@/lib/ssi/signer'

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

export interface PreparedUserOp {
  sender: `0x${string}`
  nonce: string              // stringified bigint for wire safety
  callData: `0x${string}`
  callGasLimit: string
  verificationGasLimit: string
  preVerificationGas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  userOpHash: `0x${string}`  // what the passkey must sign
}

export interface PrepareResult {
  success: boolean
  error?: string
  userOp?: PreparedUserOp
}

/**
 * Build a UserOp that calls `account.execute(account, 0, 0x)` — a no-op
 * round-trip through the EntryPoint that proves signature validation.
 */
export async function prepareUserOpAction(): Promise<PrepareResult> {
  try {
    if (!ENTRYPOINT) return { success: false, error: 'ENTRYPOINT_ADDRESS not configured' }

    const { userRow } = await loadSignerForCurrentUser()
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, userRow.id)).limit(1)
    const smartAcct = rows[0]?.smartAccountAddress
    if (!smartAcct) return { success: false, error: 'no smart account address on user row' }
    const accountAddr = getAddress(smartAcct as `0x${string}`)
    const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

    const code = await publicClient.getCode({ address: accountAddr })
    if (!code || code === '0x') return { success: false, error: `account ${accountAddr} not deployed` }

    // No-op self-call.
    const outerCallData = encodeFunctionData({
      abi: agentAccountAbi,
      functionName: 'execute',
      args: [accountAddr, 0n, '0x' as `0x${string}`],
    })

    const nonce = (await publicClient.readContract({
      address: ENTRYPOINT,
      abi: entryPointAbi,
      functionName: 'getNonce',
      args: [accountAddr, 0n],
    })) as bigint

    const callGasLimit          = 200_000n
    const verificationGasLimit  = 500_000n  // larger to accommodate P-256 verify
    const preVerificationGas    = 80_000n
    const maxFeePerGas          = 2_000_000_000n
    const maxPriorityFeePerGas  = 1_000_000_000n

    const userOp = {
      sender: accountAddr,
      nonce,
      callData: outerCallData,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      signature: '0x' as `0x${string}`,
    }
    const userOpHash = getUserOperationHash({
      userOperation: userOp,
      entryPointAddress: ENTRYPOINT,
      entryPointVersion: '0.8',
      chainId: CHAIN_ID,
    })

    return {
      success: true,
      userOp: {
        sender: userOp.sender,
        nonce: userOp.nonce.toString(),
        callData: userOp.callData,
        callGasLimit: userOp.callGasLimit.toString(),
        verificationGasLimit: userOp.verificationGasLimit.toString(),
        preVerificationGas: userOp.preVerificationGas.toString(),
        maxFeePerGas: userOp.maxFeePerGas.toString(),
        maxPriorityFeePerGas: userOp.maxPriorityFeePerGas.toString(),
        userOpHash,
      },
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export interface SubmitArgs {
  userOp: PreparedUserOp
  /** 0x01 || abi.encode(Assertion) */
  signature: `0x${string}`
}

export interface SubmitResult {
  success: boolean
  error?: string
  txHash?: `0x${string}`
}

export async function submitPasskeySignedOpAction(args: SubmitArgs): Promise<SubmitResult> {
  try {
    if (!ENTRYPOINT) return { success: false, error: 'ENTRYPOINT_ADDRESS not configured' }
    if (!DEPLOYER_KEY) return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' }

    const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

    // Defensive top-up so the EntryPoint has prefund. anvil_setBalance avoids
    // nonce races with the subsequent handleOps tx from the same deployer EOA.
    const acctBal = await publicClient.getBalance({ address: args.userOp.sender })
    if (acctBal < parseEther('0.1')) {
      await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'anvil_setBalance',
          params: [args.userOp.sender, '0xde0b6b3a7640000'],
        }),
      })
    }

    const userOp = {
      sender: args.userOp.sender,
      nonce: BigInt(args.userOp.nonce),
      callData: args.userOp.callData,
      callGasLimit: BigInt(args.userOp.callGasLimit),
      verificationGasLimit: BigInt(args.userOp.verificationGasLimit),
      preVerificationGas: BigInt(args.userOp.preVerificationGas),
      maxFeePerGas: BigInt(args.userOp.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(args.userOp.maxPriorityFeePerGas),
      signature: args.signature,
    }
    const packed = toPackedUserOperation(userOp)

    const relayer = privateKeyToAccount(RELAYER_KEY)
    const walletClient = createWalletClient({
      account: relayer,
      chain: { ...localhost, id: CHAIN_ID },
      transport: http(RPC_URL),
    })

    const txHash = await walletClient.writeContract({
      address: ENTRYPOINT,
      abi: entryPointAbi,
      functionName: 'handleOps',
      args: [[packed], relayer.address],
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') return { success: false, error: `handleOps reverted (tx ${txHash})` }
    return { success: true, txHash }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
