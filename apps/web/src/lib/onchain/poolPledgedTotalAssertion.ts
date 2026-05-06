/**
 * Spec 002 — Intent Marketplace (Pool Lane).
 *
 * On-chain emit helper for `sa:PoolPledgedTotalAssertion` (per data-model.md
 * § Pool + IA § 2.2 / § 3.3). The donor-less aggregate the pool itself
 * mints to mirror its `pledgedTotal` to GraphDB even when individual donors
 * are anonymous.
 *
 * IMPORTANT — no proposal-side anchor in v1; SHACL
 * `sa:AnonymousPledgeNoAnchorShape` and
 * `sa:PrivatePoolPledgeNoAnchorShape` enforce the privacy invariants —
 * reviewer must reject any PR that bypasses them. This aggregate
 * specifically EXISTS so anonymous + shareWithSupportTeam pledges can
 * still surface the pool's total without leaking donor identity.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const POOL_PLEDGED_TOTAL_CLASS = 'sa:PoolPledgedTotalAssertion'

export interface PoolPledgedTotalPayload {
  poolAgentId: string
  pledgedTotal: number
  allocatedTotal: number
  availableTotal: number
  /** ISO-8601 — generation time of this snapshot. */
  emittedAt: string
}

export interface ClassAssertionEnv {
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

function poolSubjectIRI(poolAgentId: string): string {
  // Pool's own IRI is the agent IRI; for the aggregate snapshot we mint a
  // separate subject so multiple snapshots over time produce distinct
  // assertion subjects.
  return `urn:smart-agent:pool-pledged-total:${poolAgentId}:${Date.now()}`
}

/**
 * Emit a `sa:PoolPledgedTotalAssertion` on chain. Donor-less; signed by
 * the pool's stewards / pool-controlled key. Callers should rate-limit
 * emissions (one snapshot per state-change is overkill).
 *
 * Returns the assertion id on success, null when env not configured.
 */
export async function emitPledgedTotalAssertion(
  payload: PoolPledgedTotalPayload,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[poolPledgedTotalAssertion] emit skipped — missing RPC_URL, CLASS_ASSERTION_ADDRESS, or DEPLOYER_PRIVATE_KEY')
    return null
  }
  try {
    const result = await emitClassAssertion(env, {
      classIri: POOL_PLEDGED_TOTAL_CLASS,
      subjectIri: poolSubjectIRI(payload.poolAgentId),
      payload: { ...payload },
    })
    return result.assertionId
  } catch (err) {
    console.error('[poolPledgedTotalAssertion] emitPledgedTotalAssertion failed:', err instanceof Error ? err.message : err)
    return null
  }
}
