'use server'

/**
 * Round admin server actions — Tier 1.
 *
 * Two operations:
 *   - advanceRoundLifecycle: thin proxy to org-mcp's `round:set_status` tool
 *     (which calls FundRegistry.setRoundStatus on chain). Used by the
 *     "Open submissions / Open voting / Finalize / Close / Cancel" buttons
 *     on the round admin page.
 *   - updateRoundVotingConfig: still goes through `round:update_voting_config`
 *     to write the off-chain voting config row.
 *
 * The MCP tools enforce the auth gate (orgPrincipal == fundAgent) — the
 * web action no longer pre-checks via `canManageAgent`.
 */

import { type Hex } from 'viem'
import { callMcp, McpCallError } from '@/lib/clients/mcp-client'
import type { RoundStatus } from '@smart-agent/sdk'

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

export async function advanceRoundLifecycle(
  roundFullId: string,
  action: RoundLifecycleAction,
): Promise<AdvanceLifecycleResult | ActionFailure> {
  const newStatus = ACTION_TO_STATUS[action]
  const roundSlug = roundFullId.startsWith('urn:smart-agent:round:')
    ? roundFullId.slice('urn:smart-agent:round:'.length)
    : roundFullId
  try {
    const res = await callMcp<{ ok: true; txHash: Hex; newStatus: RoundStatus }>(
      'org',
      'round:set_status',
      {
        roundId: roundSlug,
        newStatus,
      },
    )
    // When the admin advances to `review` (i.e. closes submissions and opens
    // voting), bump `votingWindowStartsAt` to now. The round was created with
    // `votingWindowStartsAt = submissionDeadline` (14 days out by default),
    // so without this the eligibility check still reports `voting-not-started`
    // even though the status moved to review. Voting window end is left alone
    // — the operator can still cap voting at the configured ISO timestamp.
    if (newStatus === 'review') {
      const nowIso = new Date().toISOString()
      try {
        await callMcp('org', 'round:update_voting_config', {
          roundId: roundFullId.startsWith('urn:smart-agent:round:')
            ? roundFullId
            : `urn:smart-agent:round:${roundSlug}`,
          votingWindowStartsAt: nowIso,
        })
      } catch (err) {
        // Non-fatal: status advanced; voting just won't open if this
        // config update missed. Surfaced via the eligibility-reason
        // chip in the UI.
        console.warn('[advanceRoundLifecycle] voting-window bump failed (non-fatal):', err instanceof Error ? err.message : err)
      }
    }
    const { hubScheduleKbSync } = await import('@/lib/clients/hub-client')
    await hubScheduleKbSync(true)
    return { ok: true, newStatus, txHash: res.txHash }
  } catch (err) {
    if (err instanceof McpCallError) return { ok: false, error: err.message }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
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
    if (err instanceof McpCallError) return { ok: false, error: err.message }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()
  return { ok: true }
}
