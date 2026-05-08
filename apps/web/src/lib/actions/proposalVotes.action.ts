'use server'

/**
 * Sprint A — server actions for the per-proposal vote UI.
 *
 * Reads/writes go through the org-mcp `vote:*` tools. Eligibility check
 * runs the strategy module against on-chain `canManageAgent` for the
 * round's fund — that gate matches the existing close-round / cancel-round
 * gate so stewards consistently get the same answer.
 *
 * Per output/voting-and-admin-plan.md (Sprint A).
 */

import { callMcp } from '@/lib/clients/mcp-client'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getStrategy, type VotingStrategyName, type TallyEntry, type VoteRow } from '@/lib/voting/strategies'
import { DiscoveryService } from '@smart-agent/discovery'

interface RoundConfigRow {
  id: string
  fundAgentId: string
  votingStrategy: string
  votingThreshold: number
  votingWindowStartsAt: string | null
  votingWindowEndsAt: string | null
}

const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'

async function loadRoundConfig(roundId: string): Promise<RoundConfigRow | null> {
  // Voting fields live in org-mcp's slim rounds table (off-chain DAO config).
  // fundAgentId lives on chain in FundRegistry — read via DiscoveryService.
  // Body fields (deadline, status, mandate, etc.) also on chain.
  const path = await import('path')
  const fs = await import('fs')
  const cwd = process.cwd()
  const candidates = [
    path.resolve(cwd, '../org-mcp/org-mcp.db'),
    path.resolve(cwd, 'apps/org-mcp/org-mcp.db'),
    path.resolve(cwd, '../../apps/org-mcp/org-mcp.db'),
  ]
  const dbPath = candidates.find((p) => fs.existsSync(p))
  if (!dbPath) return null
  const Database = (await import('better-sqlite3')).default
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  let votingRow:
    | {
        id: string
        voting_strategy: string
        voting_threshold: number
        voting_window_starts_at: string | null
        voting_window_ends_at: string | null
      }
    | undefined
  try {
    votingRow = db.prepare(`
      SELECT id, voting_strategy, voting_threshold,
             voting_window_starts_at, voting_window_ends_at
      FROM rounds WHERE id = ?
    `).get(roundId) as typeof votingRow
  } finally {
    db.close()
  }

  // Resolve fundAgentId from the on-chain → GraphDB mirror.
  const roundSlug = roundId.startsWith('urn:smart-agent:round:')
    ? roundId.slice('urn:smart-agent:round:'.length)
    : roundId
  let fundAgentId = ''
  try {
    const round = await DiscoveryService.fromEnv().getRoundDetail(roundSlug, null)
    if (round) {
      fundAgentId = round.fundAgentId.startsWith(AGENT_IRI_PREFIX)
        ? round.fundAgentId.slice(AGENT_IRI_PREFIX.length)
        : round.fundAgentId
    }
  } catch { /* discovery offline → empty fundAgentId; eligibility falls through */ }

  if (!votingRow) {
    // No voting config row yet — return defaults so the strategy can run.
    if (!fundAgentId) return null
    return {
      id: roundId,
      fundAgentId,
      votingStrategy: 'steward-quorum',
      votingThreshold: 2,
      votingWindowStartsAt: null,
      votingWindowEndsAt: null,
    }
  }
  return {
    id: votingRow.id,
    fundAgentId,
    votingStrategy: votingRow.voting_strategy,
    votingThreshold: votingRow.voting_threshold,
    votingWindowStartsAt: votingRow.voting_window_starts_at,
    votingWindowEndsAt: votingRow.voting_window_ends_at,
  }
}

export interface VoteEligibilityResult {
  canVote: boolean
  weight: number
  reason?: string
  message: string
  strategy: VotingStrategyName
  threshold: number
}

export async function getVoteEligibility(roundId: string): Promise<VoteEligibilityResult | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { error: 'no-person-agent' }
  const round = await loadRoundConfig(roundId)
  if (!round) return { error: 'round-not-found' }
  const strategy = getStrategy(round.votingStrategy)
  const r = await strategy.eligibility(myAgent, {
    id: round.id,
    fundAgentId: round.fundAgentId,
    votingStrategy: round.votingStrategy as VotingStrategyName,
    votingThreshold: round.votingThreshold,
    votingWindowStartsAt: round.votingWindowStartsAt,
    votingWindowEndsAt: round.votingWindowEndsAt,
  })
  return {
    canVote: r.canVote,
    weight: r.weight,
    reason: r.reason,
    message: strategy.copy.eligibilityMessage(r),
    strategy: round.votingStrategy as VotingStrategyName,
    threshold: round.votingThreshold,
  }
}

export interface CastVoteInput {
  roundId: string
  proposalId: string
  vote: 'approve' | 'reject' | 'abstain'
  rationale?: string
}

export async function castVote(input: CastVoteInput): Promise<{ ok: true; status: 'cast' | 'updated' } | { ok: false; error: string }> {
  const me = await getCurrentUser()
  if (!me) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  const elig = await getVoteEligibility(input.roundId)
  if ('error' in elig) return { ok: false, error: elig.error }
  if (!elig.canVote) return { ok: false, error: elig.reason ?? 'not-eligible' }
  try {
    const result = await callMcp<{ id: string; status: 'cast' | 'updated' }>(
      'org',
      'vote:cast',
      {
        roundId: input.roundId,
        proposalId: input.proposalId,
        voterAgentId: myAgent,
        vote: input.vote,
        weight: elig.weight,
        rationale: input.rationale ?? null,
      },
    )
    return { ok: true, status: result.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface RoundTally {
  tally: TallyEntry[]
  threshold: number
  strategy: VotingStrategyName
  windowStartsAt: string | null
  windowEndsAt: string | null
}

export async function getRoundTally(roundId: string): Promise<RoundTally | { error: string }> {
  try {
    const r = await callMcp<RoundTally>('org', 'vote:tally_for_round', { roundId })
    return r
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export interface BallotsForProposal {
  votes: VoteRow[]
}

export async function listBallotsForProposal(proposalId: string): Promise<BallotsForProposal | { error: string }> {
  try {
    return await callMcp<BallotsForProposal>('org', 'vote:list_for_proposal', { proposalId })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function getMyVoteForProposal(roundId: string, proposalId: string): Promise<VoteRow | null | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { error: 'no-person-agent' }
  const r = await listBallotsForProposal(proposalId)
  if ('error' in r) return r
  const mine = r.votes.find((v) => v.voterAgentId.toLowerCase() === myAgent.toLowerCase() && v.roundId === roundId)
  return mine ?? null
}
