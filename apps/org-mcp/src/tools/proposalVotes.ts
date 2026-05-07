/**
 * Sprint A — DAO governance voting tools.
 *
 * Per output/voting-and-admin-plan.md. v1 supports the `steward-quorum`
 * strategy: stewards cast approve/reject/abstain ballots; tally is the
 * count of approve votes; threshold N from `rounds.voting_threshold`
 * decides which proposals win.
 *
 * Auth: token must be a valid org-mcp delegation. Eligibility (e.g.,
 * "is this voter a steward?") is checked at the action layer because
 * it requires `canManageAgent` against on-chain state.
 *
 * Tools registered:
 *   - vote:cast               UPSERT — voters can change their vote pre-finalize
 *   - vote:list_for_round     all ballots on a round (for tally + audit)
 *   - vote:list_for_proposal  ballots on a single proposal
 *   - vote:tally_for_round    computed: per-proposal {approve, reject, abstain} counts
 *   - vote:list_for_voter     ballots a voter has cast (for "Votes I cast" view)
 */
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import { proposalVotes, rounds, proposalSubmissions } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function nowIso(): string {
  return new Date().toISOString()
}

interface CastVoteArgs {
  token: string
  roundId: string                       // URN form
  proposalId: string
  voterAgentId: string
  vote: 'approve' | 'reject' | 'abstain'
  weight?: number                       // defaults to 1
  rationale?: string | null
  signature?: string | null
}

const castVoteTool = {
  name: 'vote:cast',
  description:
    "Cast or update a ballot on a proposal. UPSERT semantics — voters may change their vote pre-finalize. Eligibility (steward-quorum: voter must be canManageAgent of round.fundAgent) is enforced at the action layer.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      proposalId: { type: 'string' },
      voterAgentId: { type: 'string' },
      vote: { type: 'string', enum: ['approve', 'reject', 'abstain'] },
      weight: { type: 'integer' },
      rationale: { type: 'string' },
      signature: { type: 'string' },
    },
    required: ['token', 'roundId', 'proposalId', 'voterAgentId', 'vote'],
  },
  handler: async (args: CastVoteArgs) => {
    await requireOrgPrincipal(args.token, args, 'vote:cast')
    const now = nowIso()
    const voter = args.voterAgentId.toLowerCase()
    const existing = db.select().from(proposalVotes)
      .where(and(
        eq(proposalVotes.roundId, args.roundId),
        eq(proposalVotes.proposalId, args.proposalId),
        eq(proposalVotes.voterAgentId, voter),
      )).all()[0]
    if (existing) {
      db.update(proposalVotes)
        .set({
          vote: args.vote,
          weight: args.weight ?? 1,
          rationale: args.rationale ?? null,
          signature: args.signature ?? null,
          updatedAt: now,
        })
        .where(eq(proposalVotes.id, existing.id))
        .run()
      return mcpText({ id: existing.id, status: 'updated' })
    }
    const id = randomUUID()
    db.insert(proposalVotes).values({
      id,
      roundId: args.roundId,
      proposalId: args.proposalId,
      voterAgentId: voter,
      vote: args.vote,
      weight: args.weight ?? 1,
      rationale: args.rationale ?? null,
      signature: args.signature ?? null,
      castAt: now,
      updatedAt: now,
    }).run()
    return mcpText({ id, status: 'cast' })
  },
}

const listForRoundTool = {
  name: 'vote:list_for_round',
  description:
    'List all ballots on a round (for tally + audit). Returns rows in cast order.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'vote:list_for_round')
    const rows = db.select().from(proposalVotes)
      .where(eq(proposalVotes.roundId, args.roundId))
      .all()
    return mcpText({ votes: rows })
  },
}

const listForProposalTool = {
  name: 'vote:list_for_proposal',
  description: 'List all ballots on a single proposal.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalId: { type: 'string' },
    },
    required: ['token', 'proposalId'],
  },
  handler: async (args: { token: string; proposalId: string }) => {
    await requireOrgPrincipal(args.token, args, 'vote:list_for_proposal')
    const rows = db.select().from(proposalVotes)
      .where(eq(proposalVotes.proposalId, args.proposalId))
      .all()
    return mcpText({ votes: rows })
  },
}

const listForVoterTool = {
  name: 'vote:list_for_voter',
  description: 'List ballots a single voter has cast (across all rounds/proposals).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      voterAgentId: { type: 'string' },
    },
    required: ['token', 'voterAgentId'],
  },
  handler: async (args: { token: string; voterAgentId: string }) => {
    await requireOrgPrincipal(args.token, args, 'vote:list_for_voter')
    const rows = db.select().from(proposalVotes)
      .where(eq(proposalVotes.voterAgentId, args.voterAgentId.toLowerCase()))
      .all()
    return mcpText({ votes: rows })
  },
}

interface TallyEntry {
  proposalId: string
  approves: number
  rejects: number
  abstains: number
  totalWeight: number  // sum of approve weights (for non-flat strategies later)
  passes: boolean      // approves >= round.votingThreshold
}

const tallyForRoundTool = {
  name: 'vote:tally_for_round',
  description:
    'Compute the per-proposal tally for a round. Returns approve/reject/abstain counts and a `passes` flag derived from the round\'s votingThreshold.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'vote:tally_for_round')
    const round = db.select().from(rounds)
      .where(eq(rounds.id, args.roundId)).all()[0]
    if (!round) return mcpText({ tally: [], threshold: 0, strategy: null })
    const submitted = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.roundId, args.roundId))
      .all()
      .filter((p) => p.status !== 'draft')
    const ballots = db.select().from(proposalVotes)
      .where(eq(proposalVotes.roundId, args.roundId))
      .all()
    const byProposal = new Map<string, TallyEntry>()
    for (const p of submitted) {
      byProposal.set(p.id, {
        proposalId: p.id,
        approves: 0,
        rejects: 0,
        abstains: 0,
        totalWeight: 0,
        passes: false,
      })
    }
    for (const b of ballots) {
      const entry = byProposal.get(b.proposalId)
      if (!entry) continue
      if (b.vote === 'approve') {
        entry.approves += 1
        entry.totalWeight += b.weight
      } else if (b.vote === 'reject') {
        entry.rejects += 1
      } else if (b.vote === 'abstain') {
        entry.abstains += 1
      }
    }
    for (const e of byProposal.values()) {
      e.passes = e.approves >= round.votingThreshold
    }
    return mcpText({
      tally: Array.from(byProposal.values()),
      threshold: round.votingThreshold,
      strategy: round.votingStrategy,
      windowStartsAt: round.votingWindowStartsAt,
      windowEndsAt: round.votingWindowEndsAt,
    })
  },
}

export const proposalVotesTools = {
  'vote:cast': castVoteTool,
  'vote:list_for_round': listForRoundTool,
  'vote:list_for_proposal': listForProposalTool,
  'vote:list_for_voter': listForVoterTool,
  'vote:tally_for_round': tallyForRoundTool,
}
