'use server'

/**
 * Round opening orchestration (Phase 0.4 — on-chain attribute store).
 *
 * Flow:
 *   1. Open the round on chain via FundRegistry.openRound(...) — body lives
 *      in FundRegistry's own typed-attribute storage. ShapeRegistry validates.
 *   2. Cache body in org-mcp via the `round:open` MCP tool — used by the
 *      proposal-flow hot path (validation, addressed-applicants check).
 *   3. Trigger debounced kb-sync.
 *
 * Drops the legacy `sa:RoundOpenedAssertion` emit — registry's RoundOpened
 * event + on-chain attribute writes are the new public mirror source.
 */

import { type Address } from 'viem'
import { callMcp } from '@/lib/clients/mcp-client'
import { getWalletClient, getPublicClient } from '@/lib/contracts'
import { FundRegistryClient } from '@smart-agent/sdk'

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
}

export interface OpenRoundResult {
  roundId: string
  fundAgentId: Address
  visibility: 'public' | 'private'
  txHash: `0x${string}`
}

const CADENCE_CONCEPT: Record<OpenRoundInput['reportingCadence'], string> = {
  monthly: 'sa:CadenceMonthly',
  quarterly: 'sa:CadenceQuarterly',
  annual: 'sa:CadenceAnnual',
  milestone: 'sa:CadenceMilestone',
  none: 'sa:CadenceNone',
}

export async function openRound(input: OpenRoundInput): Promise<OpenRoundResult> {
  const registryAddr = process.env.FUND_REGISTRY_ADDRESS as Address | undefined
  if (!registryAddr) throw new Error('FUND_REGISTRY_ADDRESS not set')

  const fullId = `urn:smart-agent:round:${input.id}`
  const deadlineSec = BigInt(Math.floor(Date.parse(input.deadline) / 1000))
  const decisionSec = BigInt(Math.floor(Date.parse(input.decisionDate) / 1000))

  const client = new FundRegistryClient({
    registryAddress: registryAddr,
    walletClient: getWalletClient(),
    publicClient: getPublicClient(),
  })

  const { txHash } = await client.openRound({
    roundId: input.id,
    fundAgent: input.fundAgentId,
    deadline: deadlineSec,
    decisionDate: decisionSec,
    reportingCadence: CADENCE_CONCEPT[input.reportingCadence],
    requiredCredentials: input.requiredCredentials,
    visibility: input.visibility,
    initialStatus: 'open',
  })

  // Cache body in org-mcp for the proposal hot-path validator.
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

  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()

  return {
    roundId: fullId,
    fundAgentId: input.fundAgentId,
    visibility: input.visibility,
    txHash,
  }
}
