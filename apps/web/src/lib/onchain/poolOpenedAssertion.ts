/**
 * Treasury Phase 1 — emit `sa:PoolOpenedAssertion` on chain when a Pool
 * is created. Payload carries the treasury address (the pool's
 * AgentAccount), governance model, accepted units / kinds / geo, ceiling
 * policy, initial steward set.
 *
 * Public-tier pools always anchor; private pools anchor a COARSE variant
 * that omits addressedMembers. Mirrors the public/private bifurcation in
 * `roundAssertion.ts` so the GraphDB projection works the same way.
 *
 * Reuses `ClassAssertion` — no new ABI required.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const POOL_OPENED_CLASS = 'sa:PoolOpenedAssertion'
const POOL_CLOSED_CLASS = 'sa:PoolClosedAssertion'

export interface PoolOpenedPayload {
  id: string
  treasuryAddress: string  // pool.AgentAccount address (lowercased hex)
  governanceModel: 'fund' | 'coaching-network' | 'prayer-chain' | 'skills-bench' | 'hospitality-network'
  acceptedUnits: string[]
  acceptedKinds: string[]
  acceptedGeo: string[]
  ceilingPolicy: 'block' | 'waitlist' | 'accept'
  capacityCeiling: number | null
  visibility: 'public' | 'private'
  /** Only present on PRIVATE pools. Public pools omit. */
  addressedMembers?: string[]
  /** Initial steward set (may be empty in seed-time bootstrap). */
  stewards: string[]
  openedAt: string
}

interface ClassAssertionEnv {
  rpcUrl: string
  contractAddress: Address
  operatorPrivateKey: Hex
}

function readEnv(): ClassAssertionEnv | null {
  const rpcUrl = process.env.RPC_URL
  const contractAddress = process.env.CLASS_ASSERTION_ADDRESS as Address | undefined
  const operatorPrivateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
  if (!rpcUrl || !contractAddress || !operatorPrivateKey) return null
  return { rpcUrl, contractAddress, operatorPrivateKey }
}

function poolSubjectIRI(poolId: string): string {
  return `urn:smart-agent:pool:${poolId}`
}

export async function emitPoolOpenedAssertion(
  pool: PoolOpenedPayload,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[poolOpenedAssertion] emit skipped — missing RPC_URL, CLASS_ASSERTION_ADDRESS, or DEPLOYER_PRIVATE_KEY')
    return null
  }

  const isPrivate = pool.visibility === 'private'

  // PUBLIC pools never anchor addressedMembers (it'd reveal the gated
  // membership for a "public" tier — contradiction). PRIVATE pools never
  // anchor it either; the addressed-members list lives in the pool's
  // org-mcp and is read via cross-delegation. Public anchor carries
  // mandate detail; private anchor is coarse (no acceptedKinds detail).
  const payload: Record<string, unknown> = isPrivate
    ? {
        id: pool.id,
        treasuryAddress: pool.treasuryAddress,
        governanceModel: pool.governanceModel,
        acceptedUnits: pool.acceptedUnits,
        ceilingPolicy: pool.ceilingPolicy,
        visibility: 'private',
        openedAt: pool.openedAt,
      }
    : {
        id: pool.id,
        treasuryAddress: pool.treasuryAddress,
        governanceModel: pool.governanceModel,
        acceptedUnits: pool.acceptedUnits,
        acceptedKinds: pool.acceptedKinds,
        acceptedGeo: pool.acceptedGeo,
        ceilingPolicy: pool.ceilingPolicy,
        capacityCeiling: pool.capacityCeiling,
        visibility: 'public',
        stewards: pool.stewards,
        openedAt: pool.openedAt,
      }

  try {
    const result = await emitClassAssertion(env, {
      classIri: POOL_OPENED_CLASS,
      subjectIri: poolSubjectIRI(pool.id),
      payload,
    })
    return result.assertionId
  } catch (err) {
    console.error('[poolOpenedAssertion] emit failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function emitPoolClosedAssertion(
  poolId: string,
  closureReason: 'mandate-fulfilled' | 'sunset' | 'dispute-resolution' | 'merge',
  closedAt: string = new Date().toISOString(),
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[poolOpenedAssertion] emit skipped — missing env')
    return null
  }
  try {
    const result = await emitClassAssertion(env, {
      classIri: POOL_CLOSED_CLASS,
      subjectIri: poolSubjectIRI(poolId),
      payload: { poolId, closureReason, closedAt },
    })
    return result.assertionId
  } catch (err) {
    console.error('[poolOpenedAssertion] emitPoolClosedAssertion failed:', err instanceof Error ? err.message : err)
    return null
  }
}
