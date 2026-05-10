'use server'

/**
 * Round opening orchestration — Tier 1 thin proxy.
 *
 * On-chain logic (FundRegistry.openRound) lives in org-mcp's `round:open`
 * tool. The web action:
 *
 *   1. Forwards form input to `callMcp('org', 'round:open', input)`.
 *   2. Initializes the slim off-chain voting config row in org-mcp via
 *      `round:update_voting_config`.
 *   3. Triggers debounced kb-sync.
 */

import { type Address } from 'viem'
import { callMcp } from '@/lib/clients/mcp-client'

export interface OpenRoundInput {
  /** Canonical round id slug (e.g. 'demo-trauma-care-q2'). */
  id: string
  /** The fund / pool agent operating the round (address). */
  fundAgentId: Address
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
  // Sprint B — caller-overridable voting config (defaults applied below).
  votingStrategy?: 'steward-quorum' | 'member-approval' | 'quadratic' | 'ranked-choice'
  votingThreshold?: number
  votingWindowDays?: number
}

export interface OpenRoundResult {
  roundId: string
  fundAgentId: Address
  visibility: 'public' | 'private'
  txHash: `0x${string}`
}

export async function openRound(input: OpenRoundInput): Promise<OpenRoundResult> {
  const fullId = `urn:smart-agent:round:${input.id}`
  const deadlineSec = Math.floor(Date.parse(input.deadline) / 1000)
  const decisionSec = Math.floor(Date.parse(input.decisionDate) / 1000)

  // The MCP tool persists the body fields as JSON on chain (the registry's
  // typed-attribute store has dedicated string columns for them). Stringify
  // here so the wire payload is already canonical.
  const mandateJson = JSON.stringify({
    acceptedKinds: input.mandate.acceptedKinds,
    acceptedGeo: input.mandate.acceptedGeo,
    budgetCeiling: input.mandate.budgetCeiling,
    expectedAwards: input.mandate.expectedAwards,
    addressedApplicants: input.addressedApplicants ?? [],
  })
  const milestoneTemplateJson = input.milestoneTemplate
    ? JSON.stringify(input.milestoneTemplate)
    : ''
  const validatorRequirementsJson = input.validatorRequirements
    ? JSON.stringify(input.validatorRequirements)
    : ''

  const { txHash } = await callMcp<{ txHash: `0x${string}` }>('org', 'round:open', {
    roundId: input.id,
    fundAgent: input.fundAgentId,
    deadline: deadlineSec,
    decisionDate: decisionSec,
    reportingCadence: input.reportingCadence,
    requiredCredentials: input.requiredCredentials ?? [],
    visibility: input.visibility,
    initialStatus: 'open',
    mandate: mandateJson,
    milestoneTemplate: milestoneTemplateJson,
    validatorRequirements: validatorRequirementsJson,
  })

  // Voting window defaults (per output/voting-and-admin-plan.md):
  //   - opens at the submission deadline
  //   - closes N days later (default 7; configurable via the create form)
  //   - threshold = 2 approves (matches "2-of-3 stewards")
  const windowDays = Math.max(1, input.votingWindowDays ?? 7)
  const votingWindowStartsAt = input.deadline
  const votingWindowEndsAt = new Date(
    Date.parse(input.deadline) + windowDays * 24 * 60 * 60 * 1000,
  ).toISOString()
  const votingStrategy = input.votingStrategy ?? 'steward-quorum'
  const votingThreshold = input.votingThreshold ?? 2

  await callMcp('org', 'round:update_voting_config', {
    roundId: fullId,
    votingStrategy,
    votingThreshold,
    votingWindowStartsAt,
    votingWindowEndsAt,
    eligibleVoters: { kind: 'stewards' },
  })

  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()

  return {
    roundId: fullId,
    fundAgentId: input.fundAgentId,
    visibility: input.visibility,
    txHash,
  }
}
