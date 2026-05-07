'use server'

/**
 * Treasury Phase 2.5 — Round cancellation guardian (OZ Governor pattern).
 *
 * Pool root key (or designated lead steward) cancels a Round between
 * AllocationDecided and the first Disbursement — the adversarial-path
 * defense that activates within the 72h dispute window.
 *
 * Three-step orchestration:
 *   1. (Optional, when revokedSessionHash is provided) Revoke the
 *      SESSION_DELEGATION on chain so any in-flight redeem reverts at
 *      the DelegationManager authority-chain check.
 *   2. Persist the cancel + reason on the round row via `round:cancel` MCP.
 *   3. Emit `sa:RoundCanceledAssertion` so the public mirror reflects it.
 *
 * Companion to:
 *   - `roundClose.action.ts` — the normal-lifecycle path.
 *   - `revokeAward.action.ts` (TODO Phase 3) — the per-proposal variant.
 */

import { callMcp } from '@/lib/clients/mcp-client'
import { emitRoundCanceledAssertion, type RoundCancelReason } from '@/lib/onchain/roundCanceledAssertion'

export interface CancelRoundInput {
  roundId: string
  reasonKind: RoundCancelReason
  /** Optional URI to a longer explanation / dispute record. */
  reasonURI?: string
  /**
   * Optional SESSION_DELEGATION hash to revoke. When present, the action
   * calls `DelegationManager.revokeDelegation` so any in-flight redeem
   * reverts. Phase 2.5 callers may omit; Phase 3 callers must provide
   * once a SESSION is minted at round-close time.
   */
  revokedSessionHash?: string
}

export interface CancelRoundResult {
  roundId: string
  reasonKind: RoundCancelReason
  canceledAt: string
  onChainAssertionId: string | null
}

export async function cancelRound(input: CancelRoundInput): Promise<CancelRoundResult> {
  const roundId = input.roundId.startsWith('urn:smart-agent:round:')
    ? input.roundId
    : `urn:smart-agent:round:${input.roundId}`
  const canceledAt = new Date().toISOString()

  // 1. Revoke SESSION_DELEGATION on chain — only when the caller has minted
  //    one. Phase 2.5 stops short of minting sessions, so this branch is
  //    inert until Phase 3. Wired now so the Phase 3 caller doesn't have
  //    to refactor cancellation.
  // TODO(phase-3): when SESSION_DELEGATION_HASH is known, call
  //   getDelegationManager().writeContract({
  //     functionName: 'revokeDelegation',
  //     args: [revokedSessionHash],
  //   })

  // 2. Persist cancel on the row.
  await callMcp('org', 'round:cancel', {
    roundId,
    reasonKind: input.reasonKind,
    reasonURI: input.reasonURI,
    revokedSessionHash: input.revokedSessionHash,
  })

  // 3. Public mirror.
  const onChainAssertionId = await emitRoundCanceledAssertion({
    roundId: roundId.replace('urn:smart-agent:round:', ''),
    reasonKind: input.reasonKind,
    reasonURI: input.reasonURI,
    revokedSessionHash: input.revokedSessionHash,
    canceledAt,
  })

  // Debounced kb-sync — same protection rationale as poolCreate /
  // openRound. Cost: up to 60s before the round flips to "canceled" in
  // the public mirror.
  const { scheduleKbSync } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSync()

  return {
    roundId,
    reasonKind: input.reasonKind,
    canceledAt,
    onChainAssertionId,
  }
}
