'use server'

/**
 * Sprint C — finalizeRoundFromTally.
 *
 * Reads the live vote tally for a round, filters to passing proposals
 * (approves >= votingThreshold per the steward-quorum strategy), looks
 * up each winning proposal's recipient + amount, and calls the existing
 * closeRound action which:
 *   1. Computes the awards Merkle root.
 *   2. Calls FundRegistry.setRoundAwardsRoot + setRoundStatus('decided').
 *   3. Calls ProposalRegistry.announceAward per winner.
 *
 * This is the bridge between Sprint A (votes) and the on-chain award
 * commitment that opens the dispute window.
 */

import { type Address } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { callMcp } from '@/lib/clients/mcp-client'
import { closeRound, type Award, type CloseRoundResult } from '@/lib/actions/roundClose.action'

export interface ActionFailure { ok: false; error: string }

interface RoundRow {
  id: string
  fundAgentId: string
  votingThreshold: number
}

interface ProposalRow {
  id: string
  principal: string
  status: string
  budget: string                    // JSON
  desiredOutcomes: string           // JSON
}

async function loadRound(fullRoundId: string): Promise<RoundRow | null> {
  // voting_threshold lives in org-mcp's slim rounds table (off-chain DAO
  // config). fundAgentId + status live on chain — read via DiscoveryService.
  const path = await import('path')
  const fs = await import('fs')
  const candidates = [
    path.resolve(process.cwd(), '../org-mcp/org-mcp.db'),
    path.resolve(process.cwd(), 'apps/org-mcp/org-mcp.db'),
  ]
  const dbPath = candidates.find((p) => fs.existsSync(p))
  let votingThreshold = 2 // default
  if (dbPath) {
    const Database = (await import('better-sqlite3')).default
    const db = new Database(dbPath, { readonly: true })
    try {
      const r = db.prepare('SELECT voting_threshold FROM rounds WHERE id = ?').get(fullRoundId) as
        | { voting_threshold: number }
        | undefined
      if (r) votingThreshold = r.voting_threshold
    } finally { db.close() }
  }
  const { DiscoveryService } = await import('@smart-agent/discovery')
  const slug = fullRoundId.startsWith('urn:smart-agent:round:')
    ? fullRoundId.slice('urn:smart-agent:round:'.length)
    : fullRoundId
  const round = await DiscoveryService.fromEnv().getRoundDetail(slug, null)
  if (!round) return null
  const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'
  const fundAgentId = round.fundAgentId.startsWith(AGENT_IRI_PREFIX)
    ? round.fundAgentId.slice(AGENT_IRI_PREFIX.length)
    : round.fundAgentId
  return { id: fullRoundId, fundAgentId, votingThreshold }
}

async function loadProposalsByIds(ids: string[]): Promise<Map<string, ProposalRow>> {
  if (ids.length === 0) return new Map()
  const path = await import('path')
  const fs = await import('fs')
  const candidates = [
    path.resolve(process.cwd(), '../org-mcp/org-mcp.db'),
    path.resolve(process.cwd(), 'apps/org-mcp/org-mcp.db'),
  ]
  const dbPath = candidates.find((p) => fs.existsSync(p))
  if (!dbPath) return new Map()
  const Database = (await import('better-sqlite3')).default
  const db = new Database(dbPath, { readonly: true })
  try {
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT id, principal, status, budget, desired_outcomes FROM proposal_submissions WHERE id IN (${placeholders})`
    ).all(...ids) as Array<{ id: string; principal: string; status: string; budget: string; desired_outcomes: string }>
    const m = new Map<string, ProposalRow>()
    for (const r of rows) {
      m.set(r.id, {
        id: r.id,
        principal: r.principal,
        status: r.status,
        budget: r.budget,
        desiredOutcomes: r.desired_outcomes,
      })
    }
    return m
  } finally { db.close() }
}

interface TallyResponse {
  tally: Array<{ proposalId: string; approves: number; passes: boolean }>
  threshold: number
}

export interface FinalizeFromTallyInput {
  roundFullId: string
  /** Optional override for dispute window length in hours. Default 72. */
  disputeHours?: number
}

export interface FinalizeFromTallyResult {
  ok: true
  winnerCount: number
  closeResult: CloseRoundResult
}

export async function finalizeRoundFromTally(
  input: FinalizeFromTallyInput,
): Promise<FinalizeFromTallyResult | ActionFailure> {
  // 1. Auth.
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  const round = await loadRound(input.roundFullId)
  if (!round) return { ok: false, error: 'round-not-found' }
  let canMng = false
  try { canMng = await canManageAgent(myAgent, round.fundAgentId) } catch { canMng = false }
  if (!canMng) return { ok: false, error: 'not-fund-owner' }

  // 2. Read tally + filter to passing.
  let tally: TallyResponse
  try {
    tally = await callMcp<TallyResponse>('org', 'vote:tally_for_round', { roundId: input.roundFullId })
  } catch (err) {
    return { ok: false, error: `tally-read-failed: ${err instanceof Error ? err.message : err}` }
  }
  const passingIds = tally.tally.filter((t) => t.passes).map((t) => t.proposalId)
  if (passingIds.length === 0) {
    return { ok: false, error: 'no-passing-proposals' }
  }

  // 3. Look up proposal details so we can build the Award list.
  const proposals = await loadProposalsByIds(passingIds)
  const awards: Award[] = []
  for (const id of passingIds) {
    const p = proposals.get(id)
    if (!p) continue
    if (p.status !== 'submitted' && p.status !== 'awarded') continue
    let total = 0
    let unit = 'USD'
    try {
      const b = JSON.parse(p.budget) as { total?: number; lineItems?: Array<{ unit?: string }> }
      total = b.total ?? 0
      unit = b.lineItems?.[0]?.unit ?? 'USD'
    } catch { /* keep defaults */ }
    // Recipient: prefer the proposer's principal as the recipient address.
    // Person principals are 'person_<userId>' in our demo seed, not 0x; for
    // the on-chain Award we need a 0x address. Fall back to the fund agent
    // when the proposer is a person principal — the disbursement layer
    // can re-target later via the proposer's claim flow.
    const principalLower = p.principal.toLowerCase()
    const recipientAddr: Address = /^0x[0-9a-f]{40}$/.test(principalLower)
      ? (principalLower as Address)
      : (round.fundAgentId as Address)
    awards.push({
      proposalIRI: p.id,
      recipientAgentIRI: p.principal,
      recipientAddr,
      totalAmount: BigInt(Math.max(0, Math.floor(total))),
      unit,
    })
  }

  if (awards.length === 0) {
    return { ok: false, error: 'no-eligible-winners' }
  }

  // 4. Hand off to existing closeRound action.
  let closeResult: CloseRoundResult
  try {
    closeResult = await closeRound({
      roundId: input.roundFullId,
      poolAgentId: round.fundAgentId as Address,
      awards,
      disputeHours: input.disputeHours ?? 72,
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // 5. Record disbursement tranches in org-mcp ledger. v1 stub: one
  //    "single-tranche" per winner equal to the awarded amount. Real
  //    milestone-tranche scheduling lives in Treasury Phase 3.
  for (const a of awards) {
    try {
      await callMcp('org', 'disbursement:record', {
        proposalId: a.proposalIRI,
        roundId: input.roundFullId,
        trancheLabel: 'Award (single tranche)',
        amount: Number(a.totalAmount),
        unit: a.unit,
        recipientAgentId: a.recipientAgentIRI,
        notes: `Round finalized via tally; tx ${closeResult.awardsRootTxHash}`,
      })
    } catch (err) {
      // Best-effort — closing the round already succeeded. Log and continue.
      console.warn(`[finalizeRoundFromTally] disbursement:record failed for ${a.proposalIRI}:`,
        err instanceof Error ? err.message : err)
    }
  }

  return { ok: true, winnerCount: awards.length, closeResult }
}
