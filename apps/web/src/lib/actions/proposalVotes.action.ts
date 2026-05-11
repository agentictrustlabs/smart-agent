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
import { resolveSpec004Chain } from '@/lib/spec004/chain'
import { buildMarketplacePresentation } from '@/lib/spec004/presentation'
import { SPEC004_SELECTORS } from '@smart-agent/sdk'
import { keccak256, encodePacked, type Address } from 'viem'

function roundSubjectFromUrn(roundIdUrn: string): `0x${string}` {
  const slug = roundIdUrn.startsWith('urn:smart-agent:round:')
    ? roundIdUrn.slice('urn:smart-agent:round:'.length)
    : roundIdUrn
  return keccak256(encodePacked(['string', 'string'], ['sa:round:', slug]))
}

function requireVoteRegistryAddress(): Address {
  const v = process.env.VOTE_REGISTRY_ADDRESS as Address | undefined
  if (!v) throw new Error('VOTE_REGISTRY_ADDRESS not set')
  return v
}

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
  /** Pre-derived proposal subject (bytes32 hex). The proposal-list UI
   *  receives this from GrantProposalRegistry events / GraphDB sync;
   *  the vote action just forwards it. */
  proposalSubject: `0x${string}`
  vote: 'approve' | 'reject' | 'abstain'
  rationale?: string
}

export async function castVote(input: CastVoteInput): Promise<
  | { ok: true; txHash: `0x${string}`; nullifier: string; anonymous: true }
  | { ok: false; error: string }
> {
  const me = await getCurrentUser()
  if (!me) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  // Eligibility used to be enforced here against the round's voter set;
  // spec 004 moves authorization to the credential layer. If the holder
  // has a RoundVoterCredential + admin→holder delegation, they're eligible.
  // We still consult the strategy for `weight` (default 1).
  const elig = await getVoteEligibility(input.roundId)
  const weight =
    'error' in elig
      ? 1
      : elig.canVote
        ? elig.weight
        : 1

  let voteRegistry: Address
  try {
    voteRegistry = requireVoteRegistryAddress()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  // 1. Build the RoundVoterCredential presentation. The cred binds
  //    `roundSubject` to a specific round; the verifier matches it
  //    against this vote's roundSubject so a cred for round A can't
  //    vote in round B.
  const roundSubject = roundSubjectFromUrn(input.roundId)
  const pres = await buildMarketplacePresentation({
    credentialType: 'RoundVoterCredential',
    expectedAttributes: { roundSubject },
  })
  if (!pres.ok) return { ok: false, error: `presentation: ${pres.error}` }

  // 2. Resolve the admin→holder→session chain.
  const chain = await resolveSpec004Chain({
    targetRegistry: voteRegistry,
    credentialType: 'RoundVoterCredential',
    methodSelectors: [SPEC004_SELECTORS.voteCast],
  })
  if (!chain.ok) return { ok: false, error: `chain: ${chain.error} — ${chain.message}` }

  // 3. Fire vote:cast on org-mcp. The MCP tool returns
  //    `{ ok: true, txHash, nullifier, anonymous }` on success or
  //    `{ ok: false, error }` on auth/verify failure — propagate either.
  try {
    const result = await callMcp<
      | { ok: true; txHash: `0x${string}`; nullifier: string; anonymous: true }
      | { ok: false; error: string | { kind?: string; message?: string } }
    >('org', 'vote:cast', {
      roundSubject,
      proposalSubject: input.proposalSubject,
      vote: input.vote,
      weight,
      rationale: input.rationale ?? null,
      presentation: {
        presentationJson: pres.presentationJson,
        presentationRequest: pres.presentationRequest,
      },
      chain: chain.chain,
    })
    if (!result.ok) {
      const e = result.error
      const msg = typeof e === 'string' ? e : (e?.message ?? e?.kind ?? 'vote:cast failed')
      return { ok: false, error: msg }
    }
    return { ok: true, txHash: result.txHash, nullifier: result.nullifier, anonymous: true }
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
