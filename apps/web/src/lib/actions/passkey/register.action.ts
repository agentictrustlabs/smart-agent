'use server'

/**
 * Passkey registration flow.
 *
 * Browser does `navigator.credentials.create(...)` → parses the COSE public
 * key out of the attestation → POSTs the extracted (x, y) + credentialId to
 * this server action. The server then submits an ERC-4337 UserOperation that
 * calls `account.execute(account, 0, account.addPasskey(digest, x, y))` —
 * `addPasskey` is `onlySelf`, so it must be invoked via a UserOp that ends
 * up self-calling back into the account.
 *
 * We "self-bundle" locally: sign with the deployer EOA (which is a co-owner
 * of every demo account via the factory's serverSigner mode) and submit via
 * `entryPoint.handleOps([userOp], beneficiary)`. No Pimlico/Stackup required
 * for the local demo; the same UserOp shape will go through any real bundler
 * when we switch over.
 */

import { privateKeyToAccount } from 'viem/accounts'
import {
  encodeFunctionData,
  keccak256,
  toBytes,
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseEventLogs,
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
// Use a different anvil-funded EOA as the bundler relayer so we don't race
// the deployer's nonce with ongoing boot-seed traffic.
const RELAYER_KEY = (process.env.PASSKEY_RELAYER_KEY ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') as `0x${string}`

// Minimal ABI for the bits we use.
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

export interface RegisterPasskeyArgs {
  /** Raw credentialId bytes from navigator.credentials.create(). */
  credentialIdBase64Url: string
  /** Human-friendly label ("Laptop Touch ID", "iPhone Face ID", …). */
  label: string
  /** P-256 public key X coordinate (decimal string — bigint serialisation). */
  pubKeyX: string
  /** P-256 public key Y coordinate. */
  pubKeyY: string
}

export interface RegisterPasskeyResult {
  success: boolean
  error?: string
  txHash?: `0x${string}`
  credentialIdDigest?: `0x${string}`
  accountAddress?: `0x${string}`
}

export async function registerPasskeyAction(args: RegisterPasskeyArgs): Promise<RegisterPasskeyResult> {
  try {
    if (!ENTRYPOINT) return { success: false, error: 'ENTRYPOINT_ADDRESS not configured' }
    if (!DEPLOYER_KEY) return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' }

    const ctx = await loadSignerForCurrentUser()
    if (ctx.kind !== 'eoa') {
      return { success: false, error: 'this path requires an EOA user; OAuth users should use the OAuth enrollment flow' }
    }
    const userRow = ctx.userRow
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, userRow.id)).limit(1)
    const smartAcct = rows[0]?.smartAccountAddress
    if (!smartAcct) return { success: false, error: 'no smart account address on user row' }
    const accountAddr = getAddress(smartAcct as `0x${string}`)

    const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

    const code = await publicClient.getCode({ address: accountAddr })
    if (!code || code === '0x') {
      return { success: false, error: `account ${accountAddr} is not deployed yet — login to auto-provision first` }
    }

    // Ensure the smart account has funds to pay the EntryPoint prefund.
    // Use anvil_setBalance — instantaneous, no nonce race with the handleOps
    // tx we're about to send from the same deployer EOA. Demo-only shortcut;
    // production flows use a paymaster.
    const bal = await publicClient.getBalance({ address: accountAddr })
    if (bal < parseEther('0.5')) {
      await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'anvil_setBalance',
          params: [accountAddr, '0xde0b6b3a7640000'], // 1 ETH
        }),
      })
    }

    // Compute the credentialId digest on-chain terms and check idempotency.
    const credIdBytes = base64UrlDecode(args.credentialIdBase64Url)
    const credentialIdDigest = keccak256(credIdBytes)
    const already = (await publicClient.readContract({
      address: accountAddr,
      abi: agentAccountAbi,
      functionName: 'hasPasskey',
      args: [credentialIdDigest],
    })) as boolean
    if (already) {
      return { success: false, error: `credential already registered (digest ${credentialIdDigest})` }
    }

    // Build the self-call: execute(account, 0, addPasskey(digest, x, y))
    const addPasskeyCalldata = encodeFunctionData({
      abi: agentAccountAbi,
      functionName: 'addPasskey',
      args: [credentialIdDigest, BigInt(args.pubKeyX), BigInt(args.pubKeyY)],
    })
    const outerCallData = encodeFunctionData({
      abi: agentAccountAbi,
      functionName: 'execute',
      args: [accountAddr, 0n, addPasskeyCalldata],
    })

    // Nonce from EntryPoint.
    const nonce = (await publicClient.readContract({
      address: ENTRYPOINT,
      abi: entryPointAbi,
      functionName: 'getNonce',
      args: [accountAddr, 0n],
    })) as bigint

    // Gas numbers sized generously for local anvil — we're not cost-sensitive here.
    const callGasLimit          = 400_000n
    const verificationGasLimit  = 400_000n
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
      // signature placeholder — will be replaced below
      signature: '0x' as `0x${string}`,
    }

    // userOpHash per EntryPoint v0.7 canonical pack.
    const userOpHash = getUserOperationHash({
      userOperation: userOp,
      entryPointAddress: ENTRYPOINT,
      entryPointVersion: '0.8',
      chainId: CHAIN_ID,
    })

    // Sign with the user's own EOA (primary owner of the account). This key
    // is stored in the demo DB at provisioning time. Deployer handles gas +
    // relay, but the sig proves user authorization.
    const userAccount = privateKeyToAccount(userRow.privateKey as `0x${string}`)
    // v0.8 EntryPoint produces an EIP-712 userOpHash — sign it directly
    // (no eth-signed-message prefix). Our _verifyEcdsa tries both formats.
    const signature = await userAccount.sign({ hash: userOpHash })
    const signedOp = { ...userOp, signature }
    const relayer = privateKeyToAccount(RELAYER_KEY)

    // Pack for handleOps.
    const packed = toPackedUserOperation(signedOp)

    // Submit via handleOps from a dedicated relayer EOA so we don't fight
    // the deployer's nonce (boot-seed traffic) for the same key.
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
    if (receipt.status !== 'success') {
      return { success: false, error: `handleOps reverted (tx ${txHash})` }
    }

    // Sanity: the PasskeyAdded event should be in the logs.
    const logs = parseEventLogs({
      abi: agentAccountAbi,
      eventName: 'PasskeyAdded',
      logs: receipt.logs,
    })
    if (logs.length === 0) {
      return { success: false, error: `handleOps succeeded but no PasskeyAdded event` }
    }

    return {
      success: true,
      txHash,
      credentialIdDigest,
      accountAddress: accountAddr,
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  const bin = Buffer.from(padded, 'base64')
  return new Uint8Array(bin)
}
