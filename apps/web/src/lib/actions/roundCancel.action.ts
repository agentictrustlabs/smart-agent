'use server'

/**
 * Round cancellation guardian (OZ Governor pattern) — Tier 1 thin proxy.
 *
 * On-chain logic (FundRegistry.setRoundStatus(roundSubject, 'canceled'))
 * lives in org-mcp's `round:cancel` tool. The MCP-side delegation gate
 * replaces the web's old `canManageAgent` pre-flight + direct deployer-key
 * signing.
 */

import { type Hex } from 'viem'
import { callMcp } from '@/lib/clients/mcp-client'

export type RoundCancelReason =
  | 'dispute'
  | 'security-incident'
  | 'mandate-change'
  | 'steward-action'
  | 'other'

export interface CancelRoundInput {
  roundId: string
  reasonKind: RoundCancelReason
  reasonURI?: string
  /**
   * Optional SESSION_DELEGATION hash to revoke. Wired here for Phase 3 callers;
   * inert in Phase 0.4.
   */
  revokedSessionHash?: string
}

export interface CancelRoundResult {
  roundId: string
  reasonKind: RoundCancelReason
  canceledAt: string
  txHash: Hex
}

export async function cancelRound(input: CancelRoundInput): Promise<CancelRoundResult> {
  const roundIdSlug = input.roundId.startsWith('urn:smart-agent:round:')
    ? input.roundId.replace('urn:smart-agent:round:', '')
    : input.roundId
  const fullRoundId = `urn:smart-agent:round:${roundIdSlug}`
  const canceledAt = new Date().toISOString()

  const res = await callMcp<{ ok: true; txHash: Hex }>('org', 'round:cancel', {
    roundId: roundIdSlug,
  })

  // TODO(phase-3): revoke the SESSION_DELEGATION via DelegationManager when
  // input.revokedSessionHash is provided. The reason metadata is published
  // via sa:RoundCanceledAssertion in the assertion emit pipeline.
  void input.reasonURI; void input.revokedSessionHash

  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()

  return {
    roundId: fullRoundId,
    reasonKind: input.reasonKind,
    canceledAt,
    txHash: res.txHash,
  }
}
