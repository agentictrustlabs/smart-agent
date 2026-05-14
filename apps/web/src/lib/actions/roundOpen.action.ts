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
import { getPublicClient } from '@/lib/contracts'
import { agentAccountResolverAbi } from '@smart-agent/sdk'

export interface OpenRoundInput {
  /** Canonical round id slug (e.g. 'demo-trauma-care-q2'). */
  id: string
  /** The fund / pool agent operating the round (address). */
  fundAgentId: Address
  /** Optional: pool that operates this round. Stored on-chain so the
   *  round↔pool link doesn't depend on the fragile
   *  `fundAgent === pool.stewardshipAgent` inference. */
  poolAgentId?: Address
  mandate: {
    acceptedKinds: string[]
    acceptedGeo: string[]
    budgetCeiling: number
    expectedAwards: number
    /** Optional display name carried through the mandate JSON. The kb-sync
     *  hoists this back out as `sa:displayName` on the round subject so
     *  the UI shows the round's human-readable title instead of falling
     *  back to the mandate's accepted-kinds. */
    displayName?: string
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

  // Spec-006 invariant — fundAgent MUST resolve. The round operator
  // appears on round detail, proposal timeline, commitment views, and the
  // agent graph; if it's not registered on AgentAccountResolver every
  // display name there falls back to hex truncation. Reject early with a
  // clear error rather than letting an un-resolvable round land on chain.
  // Contract-level enforcement (FundRegistry.openRound staticcall to the
  // resolver) is the proper fix but requires a redeploy; this off-chain
  // gate matches the same invariant at the action boundary.
  const resolverAddress = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  if (resolverAddress) {
    try {
      const pub = getPublicClient()
      const isRegistered = (await pub.readContract({
        address: resolverAddress, abi: agentAccountResolverAbi,
        functionName: 'isRegistered', args: [input.fundAgentId],
      })) as boolean
      if (!isRegistered) {
        throw new Error(
          `fundAgent ${input.fundAgentId} is not registered on AgentAccountResolver — ` +
          `every round operator must resolve. Re-run pool creation (which now registers) ` +
          `or run scripts/repair-pool-registration.ts to backfill.`,
        )
      }
    } catch (err) {
      // If the read itself fails (e.g. wrong env), let the error bubble —
      // we never want to silently accept an unresolved operator.
      if (err instanceof Error && err.message.startsWith('fundAgent')) throw err
      // RPC blip / read-error: warn but don't block — the contract call
      // will still get the chance to land downstream.
      console.warn('[openRound] resolver isRegistered probe failed (proceeding):', (err as Error).message?.slice(0, 160))
    }
  }

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
    // Carry displayName through the mandate JSON; emitRoundsTurtle hoists
    // it back as `sa:displayName` so the round detail page shows the
    // user-entered title.
    ...(input.mandate.displayName ? { displayName: input.mandate.displayName } : {}),
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
    poolAgent: input.poolAgentId,
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

  // Targeted per-round sync — splices just this round's triples (plus
  // its RoundOpenedAssertion anchor) into the data graph. Replaces the
  // prior scheduleKbSyncEager() full-graph rebuild that crashed GraphDB
  // under seed load.
  try {
    const { syncRoundToGraphDB } = await import('@/lib/ontology/graphdb-sync')
    const r = await syncRoundToGraphDB(input.id)
    if (!r.ok) console.warn('[roundOpen] per-round sync failed:', r.message)
  } catch (err) {
    console.warn('[roundOpen] per-round sync threw:', err instanceof Error ? err.message : err)
  }

  return {
    roundId: fullId,
    fundAgentId: input.fundAgentId,
    visibility: input.visibility,
    txHash,
  }
}
