'use server'

/**
 * Sprint B — pool admin server actions.
 *
 * Operations:
 *   - updatePoolMandate: PoolRegistry.updateMandate(poolAgent, hash, uri)
 *   - rotatePoolStewards: PoolRegistry.rotateStewards(poolAgent, [steward...])
 *
 * Auth: caller must be an owner of the pool's AgentAccount. The contract
 * enforces this via `onlyPoolOwner`; the action layer pre-checks via
 * canManageAgent so the failure is surfaced as a 4xx-style error rather
 * than a tx revert.
 */

import { keccak256, toHex, type Address, type Hex } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getWalletClient, getPublicClient } from '@/lib/contracts'
import { poolRegistryAbi } from '@smart-agent/sdk'

export interface ActionFailure { ok: false; error: string }

async function authForPool(poolAgent: Address): Promise<{ ok: true; viewer: string } | ActionFailure> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  let canMng = false
  try { canMng = await canManageAgent(myAgent, poolAgent) } catch { canMng = false }
  if (!canMng) return { ok: false, error: 'not-pool-owner' }
  return { ok: true, viewer: myAgent }
}

export interface UpdateMandateInput {
  poolAgent: Address
  poolIRI: string                  // for cache update (urn:smart-agent:pool:<slug>)
  mandate: Record<string, unknown> // canonical mandate JSON; hashed for chain
  mandateURI?: string              // optional ipfs/https URI
}

export async function updatePoolMandate(
  input: UpdateMandateInput,
): Promise<{ ok: true; txHash: Hex } | ActionFailure> {
  const auth = await authForPool(input.poolAgent)
  if (!auth.ok) return auth
  const registryAddr = process.env.POOL_REGISTRY_ADDRESS as Address | undefined
  if (!registryAddr) return { ok: false, error: 'POOL_REGISTRY_ADDRESS not set' }

  const mandateJson = JSON.stringify(input.mandate)
  const mandateHash = keccak256(toHex(mandateJson))
  const wallet = getWalletClient()
  const account = wallet.account!
  let txHash: Hex
  try {
    txHash = await wallet.writeContract({
      address: registryAddr,
      abi: poolRegistryAbi,
      functionName: 'updateMandate',
      args: [input.poolAgent, mandateHash, input.mandateURI ?? ''],
      account,
      chain: wallet.chain ?? null,
    })
    await getPublicClient().waitForTransactionReceipt({ hash: txHash })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Pool body lives on chain via PoolRegistry — the updateMandate tx above
  // is the source of truth; the on-chain → GraphDB sync surfaces the new
  // mandate. No SQL cache to update.
  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()

  return { ok: true, txHash }
}

export interface RotateStewardsInput {
  poolAgent: Address
  poolIRI: string
  stewards: Address[]
}

export async function rotatePoolStewards(
  input: RotateStewardsInput,
): Promise<{ ok: true; txHash: Hex } | ActionFailure> {
  const auth = await authForPool(input.poolAgent)
  if (!auth.ok) return auth
  const registryAddr = process.env.POOL_REGISTRY_ADDRESS as Address | undefined
  if (!registryAddr) return { ok: false, error: 'POOL_REGISTRY_ADDRESS not set' }

  const wallet = getWalletClient()
  const account = wallet.account!
  let txHash: Hex
  try {
    txHash = await wallet.writeContract({
      address: registryAddr,
      abi: poolRegistryAbi,
      functionName: 'rotateStewards',
      args: [input.poolAgent, input.stewards],
      account,
      chain: wallet.chain ?? null,
    })
    await getPublicClient().waitForTransactionReceipt({ hash: txHash })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Stewards live on chain via PoolRegistry.rotateStewards — no SQL cache
  // to update.
  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()

  return { ok: true, txHash }
}
