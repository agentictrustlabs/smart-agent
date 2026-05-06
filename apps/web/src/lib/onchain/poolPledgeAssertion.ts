/**
 * Spec 002 — Intent Marketplace (Pool Lane).
 *
 * On-chain emit helper for `sa:PledgeAssertion` (per data-model.md §
 * PoolPledge + IA § 2.2).
 *
 * IMPORTANT — no proposal-side anchor in v1; SHACL
 * `sa:AnonymousPledgeNoAnchorShape` and
 * `sa:PrivatePoolPledgeNoAnchorShape` enforce the privacy invariants —
 * reviewer must reject any PR that bypasses them.
 *
 * Anchor matrix (IA § 2.2):
 *   - pool public + storyPermissions=public               → FULL anchor
 *     (donor IRI + amount + ...).
 *   - pool public + storyPermissions=shareWithSupportTeam → COARSE anchor
 *     (donor IRI OMITTED).
 *   - pool public + storyPermissions=anonymous            → NO anchor
 *     (signer linkable; can't anonymize on chain).
 *   - pool private (any storyPermissions)                 → NO anchor.
 *
 * Reuses the existing `ClassAssertion` contract — no new ABI required.
 * The on-chain → GraphDB sync at
 * `apps/web/src/lib/ontology/graphdb-sync.ts` is class-agnostic (see
 * `KNOWN_ASSERTION_CLASSES`) and already mirrors `sa:PledgeAssertion`
 * triples into the public mirror.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const PLEDGE_CLASS = 'sa:PledgeAssertion'

export interface PledgePayloadFull {
  /** Pledge id (the body's primary key). */
  id: string
  pledgerAgentId: string
  poolAgentId: string
  cadence: 'one-time' | 'monthly' | 'annual'
  unit: string
  amount: number
  duration?: number | null
  storyPermissions: 'public' | 'shareWithSupportTeam' | 'anonymous'
  poolVisibility: 'public' | 'private'
  pledgedAt: string
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

function pledgeSubjectIRI(pledgeId: string): string {
  return `urn:smart-agent:pledge:${pledgeId}`
}

/**
 * Emit a `sa:PledgeAssertion` on chain — full when pool public + public
 * attribution; coarse (no donor IRI) when shareWithSupportTeam.
 *
 * Returns the on-chain assertionId (decimal string) on success, or null
 * when:
 *   - the privacy invariants forbid an anchor (anonymous OR pool private), OR
 *   - the env (RPC_URL / CLASS_ASSERTION_ADDRESS / DEPLOYER_PRIVATE_KEY) is
 *     missing.
 *
 * Callers MUST treat null as "row remains owner-private (correct)".
 */
export async function emitPledgeAssertion(
  pledge: PledgePayloadFull,
): Promise<string | null> {
  // Privacy invariants — must run BEFORE the env check to ensure these
  // gates are deterministic regardless of deployment.
  if (pledge.poolVisibility === 'private') {
    // SHACL sa:PrivatePoolPledgeNoAnchorShape — never anchor private-pool pledges.
    return null
  }
  if (pledge.storyPermissions === 'anonymous') {
    // SHACL sa:AnonymousPledgeNoAnchorShape — never anchor anonymous pledges.
    return null
  }

  const env = readEnv()
  if (!env) {
    console.warn('[pledgeAssertion] emit skipped — missing RPC_URL, CLASS_ASSERTION_ADDRESS, or DEPLOYER_PRIVATE_KEY')
    return null
  }

  const isCoarse = pledge.storyPermissions === 'shareWithSupportTeam'

  const payload: Record<string, unknown> = isCoarse
    ? {
        // Coarse: donor IRI omitted; aggregate-only fields.
        id: pledge.id,
        poolAgentId: pledge.poolAgentId,
        cadence: pledge.cadence,
        unit: pledge.unit,
        amount: pledge.amount,
        duration: pledge.duration ?? null,
        storyPermissions: 'shareWithSupportTeam',
        pledgedAt: pledge.pledgedAt,
      }
    : {
        // Full: includes donor IRI.
        id: pledge.id,
        pledgerAgentId: pledge.pledgerAgentId,
        poolAgentId: pledge.poolAgentId,
        cadence: pledge.cadence,
        unit: pledge.unit,
        amount: pledge.amount,
        duration: pledge.duration ?? null,
        storyPermissions: 'public',
        pledgedAt: pledge.pledgedAt,
      }

  try {
    const result = await emitClassAssertion(env, {
      classIri: PLEDGE_CLASS,
      subjectIri: pledgeSubjectIRI(pledge.id),
      payload,
    })
    return result.assertionId
  } catch (err) {
    console.error('[pledgeAssertion] emitPledgeAssertion failed:', err instanceof Error ? err.message : err)
    return null
  }
}
