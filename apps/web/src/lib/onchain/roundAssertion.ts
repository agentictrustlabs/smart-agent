/**
 * Spec 003 — Intent Marketplace (Proposal Lane).
 *
 * On-chain emit helpers for `sa:RoundOpenedAssertion` and
 * `sa:RoundClosedAssertion` (per data-model.md § Round + IA § 2.4).
 *
 * Reuses the existing `ClassAssertion` contract — no new ABI required.
 * The on-chain → GraphDB sync at `apps/web/src/lib/ontology/graphdb-sync.ts`
 * is class-agnostic (see `KNOWN_ASSERTION_CLASSES`) and already mirrors
 * `sa:RoundOpenedAssertion` and `sa:RoundClosedAssertion` triples to the
 * public mirror; no additional sync wiring is needed.
 *
 * IMPORTANT — no proposal-side emit helper exists or will exist for
 * `sa:GrantProposal` in v1. Per the data-model and spec.md FR-013, grant
 * proposals are confidential under steward review; SHACL
 * `sa:GrantProposalAlwaysPrivateShape` enforces "no
 * `sa:onChainAssertionId` on `sa:GrantProposal`". Reviewer must reject
 * any PR that adds such a helper.
 *
 * Round authoring is OUT of scope for spec 003 (rounds are pre-seeded
 * for v1). This module exists so:
 *   - the future round-creation spec can reuse it directly, and
 *   - the spec-003 `proposalsReceived` counter sync (US3 / T040) can
 *     emit a fresh anchor when the counter increments if/when that
 *     downstream design lands.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const ROUND_OPENED_CLASS = 'sa:RoundOpenedAssertion'
const ROUND_CLOSED_CLASS = 'sa:RoundClosedAssertion'

// ---------------------------------------------------------------------------
// Types — kept minimal to avoid coupling this helper to the discovery /
// SDK Round shape (those types land in T020 / T026). The fields here are
// the subset that go into the on-chain payload.
// ---------------------------------------------------------------------------

export interface RoundOpenedPayloadFull {
  id: string
  fundAgentId: string
  mandate: {
    acceptedKinds: string[]
    acceptedGeo: string[]
    budgetCeiling: number
    expectedAwards: number
  }
  reportingCadence: 'quarterly' | 'milestone' | 'annual' | 'none'
  deadline: string // ISO-8601
  decisionDate: string // ISO-8601
  requiredCredentials: string[]
  visibility: 'public' | 'private'
  /** Only present on PUBLIC rounds. Coarse-anchored rounds OMIT this. */
  addressedApplicants?: string[]
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

function roundSubjectIRI(roundId: string): string {
  return `urn:smart-agent:round:${roundId}`
}

/**
 * Emit a `sa:RoundOpenedAssertion` on chain.
 *
 *  - PUBLIC rounds anchor the FULL mandate-summary including the
 *    `addressedApplicants` list when set (it should be empty for
 *    public rounds; private rounds use the coarse path below).
 *  - PRIVATE rounds anchor a COARSE assertion that DOES NOT carry
 *    `addressedApplicants` — that list lives in the fund's org-mcp
 *    only (per IA § 2.4 / FR-003). Private-round addressees query
 *    the fund's org-mcp via the `round:read_addressed_list`
 *    cross-delegation issued at round creation.
 *
 * Returns the on-chain assertionId (decimal string) on success, or
 * null when the env (RPC_URL / CLASS_ASSERTION_ADDRESS /
 * DEPLOYER_PRIVATE_KEY) is missing — matches the resilience pattern
 * the MCPs' intent emitters use.
 */
export async function emitRoundOpenedAssertion(
  round: RoundOpenedPayloadFull,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[roundAssertion] emit skipped — missing RPC_URL, CLASS_ASSERTION_ADDRESS, or DEPLOYER_PRIVATE_KEY')
    return null
  }

  const isPrivate = round.visibility === 'private'

  // For private rounds, the coarse payload OMITS addressedApplicants
  // (the private list never appears on chain — IA § 2.4 / R1).
  const payload: Record<string, unknown> = isPrivate
    ? {
        id: round.id,
        fundAgentId: round.fundAgentId,
        mandate: {
          acceptedKinds: round.mandate.acceptedKinds,
          // Coarse: drop budgetCeiling exact figure to a bucket if the
          // downstream design eventually wants further coarsening; v1
          // keeps the ceiling but explicitly drops addressedApplicants.
          budgetCeiling: round.mandate.budgetCeiling,
          expectedAwards: round.mandate.expectedAwards,
        },
        deadline: round.deadline,
        decisionDate: round.decisionDate,
        visibility: 'private',
      }
    : {
        id: round.id,
        fundAgentId: round.fundAgentId,
        mandate: round.mandate,
        reportingCadence: round.reportingCadence,
        deadline: round.deadline,
        decisionDate: round.decisionDate,
        requiredCredentials: round.requiredCredentials,
        visibility: 'public',
      }

  try {
    const result = await emitClassAssertion(env, {
      classIri: ROUND_OPENED_CLASS,
      subjectIri: roundSubjectIRI(round.id),
      payload,
    })
    return result.assertionId
  } catch (err) {
    console.error('[roundAssertion] emitRoundOpenedAssertion failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Emit a `sa:RoundClosedAssertion` on chain. Payload is intentionally
 * minimal — { roundId, closedAt } — so the public mirror can flip the
 * round's lifecycle state without re-publishing mandate detail.
 */
export async function emitRoundClosedAssertion(
  roundId: string,
  closedAt: string = new Date().toISOString(),
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[roundAssertion] emit skipped — missing RPC_URL, CLASS_ASSERTION_ADDRESS, or DEPLOYER_PRIVATE_KEY')
    return null
  }

  try {
    const result = await emitClassAssertion(env, {
      classIri: ROUND_CLOSED_CLASS,
      subjectIri: roundSubjectIRI(roundId),
      payload: { roundId, closedAt },
    })
    return result.assertionId
  } catch (err) {
    console.error('[roundAssertion] emitRoundClosedAssertion failed:', err instanceof Error ? err.message : err)
    return null
  }
}
