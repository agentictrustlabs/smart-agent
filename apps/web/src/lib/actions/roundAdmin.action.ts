'use server'

/**
 * Sprint B — round admin server actions.
 *
 * Two operations:
 *   - advanceRoundLifecycle: calls FundRegistry.setRoundStatus on chain +
 *     mirrors the new status into org-mcp.db rounds.status. Used by the
 *     "Open submissions / Open voting / Finalize / Close / Cancel" buttons
 *     on the round admin page.
 *   - updateRoundVotingConfig: writes voting_strategy / voting_threshold /
 *     voting_window_starts_at / voting_window_ends_at / eligible_voters to
 *     the cache row. Voting config is off-chain (the strategy logic lives
 *     server-side); the on-chain commit at finalize is the awardsRoot.
 *
 * Both gates on `canManageAgent(viewer, round.fundAgent)`.
 */

import { type Address, type Hex } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getWalletClient, getPublicClient } from '@/lib/contracts'
import { FundRegistryClient, type RoundStatus } from '@smart-agent/sdk'
import { callMcp } from '@/lib/clients/mcp-client'
import { DiscoveryService } from '@smart-agent/discovery'

const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'

export type RoundLifecycleAction = 'advance-to-review' | 'advance-to-decided' | 'advance-to-closed' | 'cancel'

export interface AdvanceLifecycleResult {
  ok: true
  newStatus: RoundStatus
  txHash: Hex
}

export interface ActionFailure { ok: false; error: string }

const ACTION_TO_STATUS: Record<RoundLifecycleAction, RoundStatus> = {
  'advance-to-review': 'review',
  'advance-to-decided': 'decided',
  'advance-to-closed': 'closed',
  'cancel': 'canceled',
}

async function authForRound(roundFullId: string): Promise<{ ok: true; fundAgent: Address; roundSlug: string } | ActionFailure> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  const roundSlug = roundFullId.startsWith('urn:smart-agent:round:')
    ? roundFullId.slice('urn:smart-agent:round:'.length)
    : roundFullId
  // Read fund_agent_id from the GraphDB public mirror. Fund owners aren't
  // listed in addressedApplicants, so pass a null viewer to skip that
  // gate — authorization here is done via canManageAgent below.
  const discovery = DiscoveryService.fromEnv()
  const round = await discovery.getRoundDetail(roundSlug, null)
  if (!round) return { ok: false, error: 'round-not-found' }
  const fundAgentRaw = round.fundAgentId.startsWith(AGENT_IRI_PREFIX)
    ? round.fundAgentId.slice(AGENT_IRI_PREFIX.length)
    : round.fundAgentId
  if (!fundAgentRaw) return { ok: false, error: 'round-not-found' }
  const fundAgent = fundAgentRaw as Address
  let canMng = false
  try { canMng = await canManageAgent(myAgent, fundAgent) } catch { canMng = false }
  if (!canMng) return { ok: false, error: 'not-fund-owner' }
  return { ok: true, fundAgent, roundSlug }
}

export async function advanceRoundLifecycle(
  roundFullId: string,
  action: RoundLifecycleAction,
): Promise<AdvanceLifecycleResult | ActionFailure> {
  const auth = await authForRound(roundFullId)
  if (!auth.ok) return auth
  const newStatus = ACTION_TO_STATUS[action]
  const registryAddr = process.env.FUND_REGISTRY_ADDRESS as Address | undefined
  if (!registryAddr) return { ok: false, error: 'FUND_REGISTRY_ADDRESS not set' }

  const fund = new FundRegistryClient({
    registryAddress: registryAddr,
    walletClient: getWalletClient(),
    publicClient: getPublicClient(),
  })
  let txHash: Hex
  try {
    txHash = await fund.setRoundStatus(auth.roundSlug, newStatus)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Status is on chain via FundRegistry.setRoundStatus (above) — no SQL
  // mirror needed; the on-chain → GraphDB sync surfaces the new status.
  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()

  return { ok: true, newStatus, txHash }
}

export interface UpdateVotingConfigInput {
  roundFullId: string
  votingStrategy?: 'steward-quorum' | 'member-approval' | 'quadratic' | 'ranked-choice'
  votingThreshold?: number
  votingWindowStartsAt?: string  // ISO
  votingWindowEndsAt?: string    // ISO
  eligibleVoters?: Record<string, unknown>
}

export interface UpdateVotingConfigResult { ok: true }

export async function updateRoundVotingConfig(
  input: UpdateVotingConfigInput,
): Promise<UpdateVotingConfigResult | ActionFailure> {
  const auth = await authForRound(input.roundFullId)
  if (!auth.ok) return auth
  try {
    await callMcp('org', 'round:update_voting_config', {
      roundId: input.roundFullId,
      votingStrategy: input.votingStrategy,
      votingThreshold: input.votingThreshold,
      votingWindowStartsAt: input.votingWindowStartsAt,
      votingWindowEndsAt: input.votingWindowEndsAt,
      eligibleVoters: input.eligibleVoters,
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()
  return { ok: true }
}
