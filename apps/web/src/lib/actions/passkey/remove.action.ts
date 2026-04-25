'use server'

/**
 * Remove a passkey: submit a UserOp calling `account.removePasskey(digest)`.
 * Same self-bundling shape as register.action.ts.
 */

import { privateKeyToAccount } from 'viem/accounts'
import {
  encodeFunctionData,
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
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

const entryPointAbi = [
  {
    type: 'function',
    name: 'getNonce',
    inputs: [{ name: 'sender', type: 'address' }, { name: 'key', type: 'uint192' }],
    outputs: [{ name: 'nonce', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'handleOps',
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
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

export interface RemovePasskeyArgs {
  credentialIdDigest: `0x${string}`
}

export interface RemovePasskeyResult {
  success: boolean
  txHash?: `0x${string}`
  error?: string
}

export async function removePasskeyAction(args: RemovePasskeyArgs): Promise<RemovePasskeyResult> {
  try {
    if (!ENTRYPOINT) return { success: false, error: 'ENTRYPOINT_ADDRESS not configured' }
    if (!DEPLOYER_KEY) return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' }

    const { userRow } = await loadSignerForCurrentUser()
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, userRow.id)).limit(1)
    const smartAcct = rows[0]?.smartAccountAddress
    if (!smartAcct) return { success: false, error: 'no smart account address on user row' }
    const accountAddr = getAddress(smartAcct as `0x${string}`)
    const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

    const removeData = encodeFunctionData({
      abi: agentAccountAbi,
      functionName: 'removePasskey',
      args: [args.credentialIdDigest],
    })
    const outerCallData = encodeFunctionData({
      abi: agentAccountAbi,
      functionName: 'execute',
      args: [accountAddr, 0n, removeData],
    })

    const nonce = (await publicClient.readContract({
      address: ENTRYPOINT,
      abi: entryPointAbi,
      functionName: 'getNonce',
      args: [accountAddr, 0n],
    })) as bigint

    const userOp = {
      sender: accountAddr,
      nonce,
      callData: outerCallData,
      callGasLimit:         400_000n,
      verificationGasLimit: 400_000n,
      preVerificationGas:    80_000n,
      maxFeePerGas:        2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      signature: '0x' as `0x${string}`,
    }
    const userOpHash = getUserOperationHash({
      userOperation: userOp,
      entryPointAddress: ENTRYPOINT,
      entryPointVersion: '0.8',
      chainId: CHAIN_ID,
    })
    const deployer = privateKeyToAccount(DEPLOYER_KEY)
    const signature = await deployer.sign({ hash: userOpHash })
    const signedOp = { ...userOp, signature }
    const packed = toPackedUserOperation(signedOp)

    const walletClient = createWalletClient({
      account: deployer,
      chain: { ...localhost, id: CHAIN_ID },
      transport: http(RPC_URL),
    })
    const txHash = await walletClient.writeContract({
      address: ENTRYPOINT,
      abi: entryPointAbi,
      functionName: 'handleOps',
      args: [[packed], deployer.address],
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') return { success: false, error: `handleOps reverted (tx ${txHash})` }
    return { success: true, txHash }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
