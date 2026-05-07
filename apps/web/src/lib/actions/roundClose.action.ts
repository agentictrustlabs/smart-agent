'use server'

/**
 * Treasury Phase 2.5 — Round close + allocation decision orchestration.
 *
 * The most complex of the action-layer write paths. Stewards have signed
 * the AllocationDecided EIP-712 payload off-chain (sigs collected via
 * `treasury_proposal:*` tools); this action lands the decision in three
 * places at once:
 *
 *   1. org-mcp:
 *      - `round:close` flips the round's row + persists awardsRoot,
 *        decidedAt, disputeUntil.
 *      - `grant_proposal:award` runs once per winning proposal.
 *
 *   2. On-chain (via ClassAssertion):
 *      - sa:RoundClosedAssertion              — lifecycle close
 *      - sa:AllocationDecidedAssertion        — full awards list + Merkle root
 *      - sa:DisputeWindowOpenedAssertion      — opens 72h challenge period
 *      - sa:GrantAwardedAssertion × N         — one per winning proposal
 *
 *   3. (Phase 2 — production) DelegationManager:
 *      - mint SESSION_DELEGATION whose RoundDecisionWindowEnforcer terms
 *        carry awardsRoot + disputeUntil. Phase 2.5 stops short — the
 *        SESSION mint is added when treasuryDisburse.action.ts ships in
 *        Phase 3.
 *
 * Caveats:
 *   - All MCP calls land first; if they succeed we then emit the chain
 *     assertions. A partial failure between MCP and chain leaves the
 *     row in `awarded` but with `onChainAssertionId = null` — the
 *     reconciliation path is to retry via a backfill script.
 *   - Award assertions emit in parallel via Promise.all. If any one
 *     fails the others still land — assertion ids are returned so the
 *     caller can tell which succeeded.
 */

import { keccak256, toBytes } from 'viem'
import { callMcp } from '@/lib/clients/mcp-client'
import { emitRoundClosedAssertion } from '@/lib/onchain/roundAssertion'
import { emitAllocationDecidedAssertion, type Award } from '@/lib/onchain/allocationDecidedAssertion'
import { emitDisputeWindowOpenedAssertion } from '@/lib/onchain/disputeWindowAssertion'
import { emitGrantAwardedAssertion } from '@/lib/onchain/grantAwardedAssertion'

export interface CloseRoundInput {
  /** Round id (URN or slug). Resolved to URN form internally. */
  roundId: string
  /** Pool / fund agent id (URN or address). Carried into AllocationDecided + GrantAwarded. */
  poolAgentId: string
  /** Award list — one entry per winning proposal. */
  awards: Award[]
  /** ISO-8601 decision timestamp. Defaults to now. */
  decidedAt?: string
  /** Dispute-window length in hours. Defaults to 72 per oSnap pattern. */
  disputeHours?: number
  /** Hash of (signerSet, threshold) at decision time — used by rotation runbook. */
  stewardSetHash?: string
  /** Optional escalation contact URI surfaced in the dispute window assertion. */
  escalationContact?: string
}

export interface CloseRoundResult {
  roundId: string
  decidedAt: string
  disputeUntil: string
  awardsRoot: string
  assertions: {
    roundClosed: string | null
    allocationDecided: string | null
    disputeWindowOpened: string | null
    grantAwarded: Array<{ proposalIRI: string; assertionId: string | null }>
  }
}

/** Compute the Merkle awardsRoot the SESSION_DELEGATION will commit to. */
function computeAwardsRoot(awards: Award[]): string {
  // Per RoundDecisionWindowEnforcer: leaf = keccak256(proposalIRIHash || recipient || totalAmount)
  const leaves = awards.map(a => {
    const proposalIRIHash = keccak256(toBytes(a.proposalIRI))
    return keccak256(
      new Uint8Array([
        ...toBytes(proposalIRIHash),
        ...toBytes(a.recipientAddr.toLowerCase() as `0x${string}`),
        ...toBytes(`0x${a.totalAmount.toString(16).padStart(64, '0')}`),
      ]),
    )
  })

  // Standard sorted-pair Merkle reduction. Single-leaf returns the leaf itself.
  if (leaves.length === 0) return '0x' + '0'.repeat(64)
  let layer: `0x${string}`[] = leaves as `0x${string}`[]
  while (layer.length > 1) {
    const next: `0x${string}`[] = []
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!
      const b = i + 1 < layer.length ? layer[i + 1]! : a
      const [lo, hi] = a < b ? [a, b] : [b, a]
      next.push(
        keccak256(new Uint8Array([...toBytes(lo), ...toBytes(hi)])),
      )
    }
    layer = next
  }
  return layer[0]!
}

export async function closeRound(input: CloseRoundInput): Promise<CloseRoundResult> {
  const decidedAt = input.decidedAt ?? new Date().toISOString()
  const disputeHours = input.disputeHours ?? 72
  const disputeUntil = new Date(Date.parse(decidedAt) + disputeHours * 60 * 60 * 1000).toISOString()
  const roundId = input.roundId.startsWith('urn:smart-agent:round:')
    ? input.roundId
    : `urn:smart-agent:round:${input.roundId}`
  const awardsRoot = computeAwardsRoot(input.awards)

  // 1. Persist round close (org-mcp).
  await callMcp('org', 'round:close', {
    roundId,
    awardsRoot,
    decidedAt,
    disputeUntil,
    stewardSetHash: input.stewardSetHash,
  })

  // 2. Mark each winning proposal as awarded.
  for (const a of input.awards) {
    await callMcp('org', 'grant_proposal:award', {
      proposalId: a.proposalIRI,
      totalAwarded: a.totalAmount,
      unit: a.unit,
      awardedAt: decidedAt,
    })
  }

  // 3. Emit the on-chain assertion batch in parallel.
  const [
    roundClosedId,
    allocationDecidedId,
    disputeWindowId,
    ...awardIds
  ] = await Promise.all([
    emitRoundClosedAssertion(roundId.replace('urn:smart-agent:round:', ''), decidedAt),
    emitAllocationDecidedAssertion({
      roundId: roundId.replace('urn:smart-agent:round:', ''),
      poolAgentId: input.poolAgentId,
      awards: input.awards,
      awardsRoot,
      decisionDate: decidedAt,
      stewardSetHash: input.stewardSetHash ?? '',
      decidedAt,
    }),
    emitDisputeWindowOpenedAssertion({
      roundId: roundId.replace('urn:smart-agent:round:', ''),
      decidedAt,
      disputeUntil,
      escalationContact: input.escalationContact,
    }),
    ...input.awards.map(a =>
      emitGrantAwardedAssertion({
        proposalIRI: a.proposalIRI,
        roundId: roundId.replace('urn:smart-agent:round:', ''),
        poolAgentId: input.poolAgentId,
        recipientAgentIRI: a.recipientAgentIRI,
        totalAwarded: a.totalAmount,
        unit: a.unit,
        awardedAt: decidedAt,
      }),
    ),
  ])

  // Debounced kb-sync — same protection rationale as poolCreate /
  // openRound. Cost: up to 60s before the round flips to closed in the
  // public mirror.
  const { scheduleKbSync } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSync()

  return {
    roundId,
    decidedAt,
    disputeUntil,
    awardsRoot,
    assertions: {
      roundClosed: roundClosedId,
      allocationDecided: allocationDecidedId,
      disputeWindowOpened: disputeWindowId,
      grantAwarded: input.awards.map((a, i) => ({
        proposalIRI: a.proposalIRI,
        assertionId: awardIds[i] ?? null,
      })),
    },
  }
}
