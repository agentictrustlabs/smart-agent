'use server'

/**
 * Treasury Phase 2.5 — Round opening orchestration.
 *
 * Calls the org-mcp `round:open` write tool to persist the round body
 * and emits `sa:RoundOpenedAssertion` so the public mirror picks up the
 * round at the moment it opens. Until this action existed, rounds were
 * seed-only; this is the production path a UI can hit.
 *
 * The emit helper bifurcates public vs. private (coarse) — for private
 * rounds the on-chain payload omits `addressedApplicants` and the rest
 * of the addressed list lives only in the fund's org-mcp.
 */

import { callMcp } from '@/lib/clients/mcp-client'
import { emitRoundOpenedAssertion } from '@/lib/onchain/roundAssertion'

export interface OpenRoundInput {
  /** Canonical round id slug (e.g. "demo-trauma-care-q2"). */
  id: string
  /** The fund / pool agent operating the round (URN or address). */
  fundAgentId: string
  mandate: {
    acceptedKinds: string[]
    acceptedGeo: string[]
    budgetCeiling: number
    expectedAwards: number
  }
  milestoneTemplate?: { minMilestones: number; maxMilestones: number; trancheHints?: { atKickoff: number; midpoint: number; completion: number } }
  validatorRequirements?: { minValidators: number }
  reportingCadence: 'monthly' | 'quarterly' | 'annual' | 'milestone' | 'none'
  /** ISO-8601 deadline. Proposers can submit until this timestamp. */
  deadline: string
  /** ISO-8601 decision date. Stewards must close the round by this date. */
  decisionDate: string
  requiredCredentials?: string[]
  visibility: 'public' | 'private'
  addressedApplicants?: string[]
}

export interface OpenRoundResult {
  roundId: string
  fundAgentId: string
  visibility: 'public' | 'private'
  onChainAssertionId: string | null
}

export async function openRound(input: OpenRoundInput): Promise<OpenRoundResult> {
  const fullId = `urn:smart-agent:round:${input.id}`

  // 1. Persist body.
  await callMcp('org', 'round:open', {
    id: fullId,
    fundAgentId: input.fundAgentId,
    mandate: input.mandate,
    milestoneTemplate: input.milestoneTemplate ?? {},
    validatorRequirements: input.validatorRequirements ?? { minValidators: 1 },
    reportingCadence: input.reportingCadence,
    deadline: input.deadline,
    decisionDate: input.decisionDate,
    requiredCredentials: input.requiredCredentials ?? [],
    visibility: input.visibility,
    addressedApplicants: input.addressedApplicants,
  })

  // 2. Public anchor (or coarse for private).
  const onChainAssertionId = await emitRoundOpenedAssertion({
    id: input.id,
    fundAgentId: input.fundAgentId,
    mandate: input.mandate,
    reportingCadence: input.reportingCadence,
    deadline: input.deadline,
    decisionDate: input.decisionDate,
    requiredCredentials: input.requiredCredentials ?? [],
    visibility: input.visibility,
    addressedApplicants: input.addressedApplicants,
  })

  // Debounced kb-sync (60s quiet + 30s cooldown) — user-triggered
  // writes can pile up; direct syncs hammer GraphDB. Cost: up to 60s
  // before the new round appears on /h/<hub>/rounds.
  const { scheduleKbSync } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSync()

  return {
    roundId: fullId,
    fundAgentId: input.fundAgentId,
    visibility: input.visibility,
    onChainAssertionId,
  }
}
