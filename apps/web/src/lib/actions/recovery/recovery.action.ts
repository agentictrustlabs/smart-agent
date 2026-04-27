'use server'

/**
 * Cross-device recovery actions for OAuth-bootstrapped accounts.
 *
 *   proposeRecoveryAction:
 *     User signs in with Google on a fresh device, has no synced passkey.
 *     Browser registers a NEW passkey via navigator.credentials.create() and
 *     POSTs (digest, X, Y). Server computes the canonical recovery intent
 *     hash for `account.addPasskey(digest, X, Y)`, calls
 *     RecoveryEnforcer.propose(accountAddr, intentHash), persists a pending
 *     intent row, and returns { intentHash, readyAt }.
 *
 *   completeRecoveryAction:
 *     After the timelock elapses, the same client posts back. Server signs
 *     the intent hash with the guardian EOA, redeems the stored recovery
 *     delegation with args=(intentHash, [guardianSig]) targeting
 *     `account.addPasskey(...)`. The new passkey is now registered on-chain;
 *     the user can sign UserOps from the fresh device.
 */

import { privateKeyToAccount } from 'viem/accounts'
import {
  encodeFunctionData,
  keccak256,
  getAddress,
  hashMessage,
} from 'viem'
import {
  agentAccountAbi,
  delegationManagerAbi,
  computeRecoveryIntentHash,
  encodeRecoveryArgs,
} from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { getPublicClient, getWalletClient } from '@/lib/contracts'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

interface ProposeArgs {
  credentialIdBase64Url: string
  pubKeyX: string
  pubKeyY: string
}

export interface ProposeResult {
  success: boolean
  error?: string
  intentHash?: `0x${string}`
  readyAt?: number
}

export async function proposeRecoveryAction(args: ProposeArgs): Promise<ProposeResult> {
  try {
    const session = await requireSession()
    if (session.via !== 'google') {
      return { success: false, error: 'Recovery is currently OAuth-only' }
    }

    const userRow = await db.select().from(schema.users)
      .where(eq(schema.users.did, session.userId)).limit(1).then(r => r[0])
    if (!userRow?.smartAccountAddress) return { success: false, error: 'no smart account on user row' }
    const accountAddr = getAddress(userRow.smartAccountAddress as `0x${string}`)

    // Lookup the persisted recovery delegation; it carries the delaySeconds.
    const delegationRow = await db.select().from(schema.recoveryDelegations)
      .where(eq(schema.recoveryDelegations.accountAddress, accountAddr.toLowerCase()))
      .limit(1).then(r => r[0])
    if (!delegationRow) return { success: false, error: 'no recovery delegation provisioned for this account' }
    const cfg = JSON.parse(delegationRow.recoveryConfigJson) as { delaySeconds: number }

    // Compute the canonical intent hash for `account.addPasskey(digest, X, Y)`.
    const credIdBytes = base64UrlDecode(args.credentialIdBase64Url)
    const credentialIdDigest = keccak256(credIdBytes)
    const callData = encodeFunctionData({
      abi: agentAccountAbi, functionName: 'addPasskey',
      args: [credentialIdDigest, BigInt(args.pubKeyX), BigInt(args.pubKeyY)],
    })
    const intentHash = computeRecoveryIntentHash({
      chainId: CHAIN_ID,
      delegator: accountAddr,
      target: accountAddr,
      value: 0n,
      callData,
    })

    // Submit RecoveryEnforcer.propose(account, intentHash) — anyone can call
    // this; we use the deployer for the demo.
    const recoveryAddr = process.env.RECOVERY_ENFORCER_ADDRESS as `0x${string}` | undefined
    if (!recoveryAddr) return { success: false, error: 'RECOVERY_ENFORCER_ADDRESS not configured' }
    const wallet = getWalletClient()
    const txHash = await wallet.writeContract({
      address: recoveryAddr,
      abi: [{
        type: 'function', name: 'propose',
        inputs: [
          { name: 'delegator', type: 'address' },
          { name: 'intentHash', type: 'bytes32' },
        ],
        outputs: [], stateMutability: 'nonpayable',
      }] as const,
      functionName: 'propose',
      args: [accountAddr, intentHash],
    })
    const pub = getPublicClient()
    await pub.waitForTransactionReceipt({ hash: txHash })

    const readyAt = Math.floor(Date.now() / 1000) + cfg.delaySeconds
    await db.insert(schema.recoveryIntents).values({
      id: crypto.randomUUID(),
      accountAddress: accountAddr.toLowerCase(),
      intentHash,
      newCredentialId: args.credentialIdBase64Url,
      newPubKeyX: args.pubKeyX,
      newPubKeyY: args.pubKeyY,
      readyAt,
      status: 0,
    }).onConflictDoUpdate({
      target: schema.recoveryIntents.intentHash,
      set: { readyAt, status: 0 },
    })

    return { success: true, intentHash, readyAt }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

interface CompleteArgs {
  intentHash: `0x${string}`
}

export interface CompleteResult {
  success: boolean
  error?: string
  txHash?: `0x${string}`
}

export async function completeRecoveryAction(args: CompleteArgs): Promise<CompleteResult> {
  try {
    const session = await requireSession()
    if (session.via !== 'google') {
      return { success: false, error: 'Recovery is currently OAuth-only' }
    }

    const userRow = await db.select().from(schema.users)
      .where(eq(schema.users.did, session.userId)).limit(1).then(r => r[0])
    if (!userRow?.smartAccountAddress) return { success: false, error: 'no smart account on user row' }
    const accountAddr = getAddress(userRow.smartAccountAddress as `0x${string}`)

    const intent = await db.select().from(schema.recoveryIntents)
      .where(eq(schema.recoveryIntents.intentHash, args.intentHash))
      .limit(1).then(r => r[0])
    if (!intent) return { success: false, error: 'no pending intent' }
    if (intent.accountAddress.toLowerCase() !== accountAddr.toLowerCase()) {
      return { success: false, error: 'intent belongs to a different account' }
    }
    if (intent.status !== 0) return { success: false, error: 'intent already consumed or cancelled' }
    if (Math.floor(Date.now() / 1000) < intent.readyAt) {
      return { success: false, error: `timelock not elapsed; ${intent.readyAt - Math.floor(Date.now() / 1000)}s remaining` }
    }

    const delegationRow = await db.select().from(schema.recoveryDelegations)
      .where(eq(schema.recoveryDelegations.accountAddress, accountAddr.toLowerCase()))
      .limit(1).then(r => r[0])
    if (!delegationRow) return { success: false, error: 'no recovery delegation' }
    const delegation = JSON.parse(delegationRow.delegationJson) as {
      delegator: `0x${string}`
      delegate: `0x${string}`
      authority: `0x${string}`
      caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}`; args: `0x${string}` }>
      salt: string
      signature: `0x${string}`
    }

    // Guardian (deployer EOA) signs the intent hash, eth-signed-message wrapped.
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
    const guardian = privateKeyToAccount(deployerKey)
    const guardianSig = await guardian.signMessage({
      message: { raw: hexToBytes(args.intentHash) },
    })
    void hashMessage // (silence unused-import; signMessage already does the wrap)

    const recoveryArgs = encodeRecoveryArgs(args.intentHash, [guardianSig])

    // Inject the runtime args into the recovery caveat. Caveats[0] is the
    // RecoveryEnforcer caveat by construction (see lib/recovery/delegation).
    const caveatsAtRedeem = delegation.caveats.map((c, i) =>
      i === 0 ? { ...c, args: recoveryArgs } : c,
    )

    const dmAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}` | undefined
    if (!dmAddr) return { success: false, error: 'DELEGATION_MANAGER_ADDRESS not configured' }

    const callData = encodeFunctionData({
      abi: agentAccountAbi, functionName: 'addPasskey',
      args: [
        keccak256(base64UrlDecode(intent.newCredentialId)),
        BigInt(intent.newPubKeyX),
        BigInt(intent.newPubKeyY),
      ],
    })

    // The delegate (server EOA) is the only authorised redeemer per
    // ERC-7710 spec; it must be msg.sender of redeemDelegation.
    const wallet = getWalletClient()
    const txHash = await wallet.writeContract({
      address: dmAddr,
      abi: delegationManagerAbi,
      functionName: 'redeemDelegation',
      args: [
        [{
          delegator: delegation.delegator,
          delegate: delegation.delegate,
          authority: delegation.authority,
          caveats: caveatsAtRedeem,
          salt: BigInt(delegation.salt),
          signature: delegation.signature,
        }],
        accountAddr,
        0n,
        callData,
      ],
    })
    const pub = getPublicClient()
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') {
      return { success: false, error: `recovery tx reverted (${txHash})`, txHash }
    }

    // No server-side passkey mirror — on-chain account._passkeys[digest]
    // is the source of truth for which credentials authorise this account.

    await db.update(schema.recoveryIntents)
      .set({ status: 1 })
      .where(eq(schema.recoveryIntents.intentHash, args.intentHash))
    return { success: true, txHash }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  return new Uint8Array(Buffer.from(padded, 'base64'))
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
