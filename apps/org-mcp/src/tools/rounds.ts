/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Round MCP tools (slim).
 *
 * POST-PHASE-7: Round body (mandate, milestoneTemplate, validatorRequirements,
 * reportingCadence, deadline, decisionDate, requiredCredentials, visibility,
 * status, fundAgentId, slug) lives ON-CHAIN in FundRegistry. Read it via
 * `FundRegistryClient` (in `@smart-agent/sdk`) or `DiscoveryService.getRoundDetail`.
 * The on-chain → GraphDB sync mirrors public-tier rounds.
 *
 * The slim `rounds` table holds ONLY off-chain DAO voting config keyed by
 * round id. The proposalsReceived counter is DERIVED at read time from
 * COUNT(proposal_submissions WHERE round_id = ?).
 *
 * Tools registered:
 *   - round:get_voting_config             — read voting config row (slim)
 *   - round:update_voting_config          — write voting config row (slim)
 *   - round:increment_proposals_received  — KEPT as no-op for delegation-scope
 *                                            stability; counter is derived now.
 *
 * Removed (action layer writes directly to FundRegistry / reads via DiscoveryService):
 *   - get_round                  — use DiscoveryService.getRoundDetail
 *   - round:open                 — action layer calls FundRegistry.openRound
 *   - round:close                — action layer calls FundRegistry.setRoundAwardsRoot + setRoundStatus('decided')
 *   - round:cancel               — action layer calls FundRegistry.setRoundStatus('canceled')
 *   - round:update_status        — action layer calls FundRegistry.setRoundStatus
 */
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rounds, proposalSubmissions } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function nowIso(): string {
  return new Date().toISOString()
}

function safeJson<T>(raw: string | null | undefined, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T } catch { return fb }
}

/**
 * Derive the proposalsReceived counter at read time. Always counts the
 * submitted/withdrawn/awarded/declined statuses — drafts are excluded.
 * (Per IA, drafts never carry a roundId.)
 */
export function getProposalsReceived(roundId: string): number {
  const rows = db.select({ id: proposalSubmissions.id })
    .from(proposalSubmissions)
    .where(eq(proposalSubmissions.roundId, roundId))
    .all()
  return rows.length
}

// ───────────────────────────────────────────────────────────────────────
// Tool: round:get_voting_config
// ───────────────────────────────────────────────────────────────────────

const getVotingConfigTool = {
  name: 'round:get_voting_config',
  description:
    "Read the off-chain voting config (strategy / threshold / window / eligible voters) for a round. Body fields (mandate, deadline, status, etc.) live ON CHAIN — read those via FundRegistry or DiscoveryService.getRoundDetail.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'round:get_voting_config')
    const r = db.select().from(rounds).where(eq(rounds.id, args.roundId)).all()[0]
    if (!r) return mcpText({ config: null })
    return mcpText({
      config: {
        id: r.id,
        votingStrategy: r.votingStrategy,
        votingThreshold: r.votingThreshold,
        votingWindowStartsAt: r.votingWindowStartsAt,
        votingWindowEndsAt: r.votingWindowEndsAt,
        eligibleVoters: safeJson<Record<string, unknown>>(r.eligibleVoters, { kind: 'stewards' }),
        proposalsReceived: getProposalsReceived(r.id),
      },
    })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: round:increment_proposals_received  (no-op)
// ───────────────────────────────────────────────────────────────────────
//
// Kept as a no-op so existing SDK delegation scopes (marketplace-scopes.ts:
// `round_increment_proposals_received`) continue to resolve. Counter is now
// DERIVED from COUNT(proposal_submissions WHERE round_id = ?).
const incrementProposalsReceivedTool = {
  name: 'round:increment_proposals_received',
  description:
    "DEPRECATED no-op. The proposalsReceived counter is derived from COUNT(proposal_submissions). Returns the current derived count.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      delta: { type: 'integer', enum: [1, -1] },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: { token: string; roundId: string; delta?: 1 | -1 }) => {
    await requireOrgPrincipal(args.token, args, 'round:increment_proposals_received')
    return mcpText({ roundId: args.roundId, proposalsReceived: getProposalsReceived(args.roundId), noOp: true })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: round:update_voting_config (Sprint B — round admin)
// ───────────────────────────────────────────────────────────────────────
interface UpdateVotingArgs {
  token: string
  roundId: string
  votingStrategy?: 'steward-quorum' | 'member-approval' | 'quadratic' | 'ranked-choice'
  votingThreshold?: number
  votingWindowStartsAt?: string
  votingWindowEndsAt?: string
  eligibleVoters?: Record<string, unknown>
}

const updateVotingConfigTool = {
  name: 'round:update_voting_config',
  description:
    "Update the round's off-chain voting config (strategy, threshold, window, eligible voters). Auto-creates the slim row on first call (rounds are pre-seeded on chain; SQL row only materializes when voting config is first set). Strategy result is committed on chain via FundRegistry.setRoundAwardsRoot at finalize.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      votingStrategy: { type: 'string', enum: ['steward-quorum', 'member-approval', 'quadratic', 'ranked-choice'] },
      votingThreshold: { type: 'integer' },
      votingWindowStartsAt: { type: 'string' },
      votingWindowEndsAt: { type: 'string' },
      eligibleVoters: { type: 'object' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: UpdateVotingArgs) => {
    await requireOrgPrincipal(args.token, args, 'round:update_voting_config')
    const now = nowIso()
    const r = db.select().from(rounds).where(eq(rounds.id, args.roundId)).all()[0]
    if (!r) {
      // Auto-create on first set. Round body lives on chain; this row is
      // pure off-chain voting config.
      db.insert(rounds).values({
        id: args.roundId,
        votingStrategy: args.votingStrategy ?? 'steward-quorum',
        votingThreshold: args.votingThreshold ?? 2,
        votingWindowStartsAt: args.votingWindowStartsAt ?? null,
        votingWindowEndsAt: args.votingWindowEndsAt ?? null,
        eligibleVoters: JSON.stringify(args.eligibleVoters ?? { kind: 'stewards' }),
        updatedAt: now,
      }).run()
      return mcpText({ roundId: args.roundId, ok: true, created: true })
    }
    const update: Record<string, unknown> = { updatedAt: now }
    if (args.votingStrategy !== undefined)        update.votingStrategy = args.votingStrategy
    if (args.votingThreshold !== undefined)       update.votingThreshold = args.votingThreshold
    if (args.votingWindowStartsAt !== undefined)  update.votingWindowStartsAt = args.votingWindowStartsAt
    if (args.votingWindowEndsAt !== undefined)    update.votingWindowEndsAt = args.votingWindowEndsAt
    if (args.eligibleVoters !== undefined)        update.eligibleVoters = JSON.stringify(args.eligibleVoters)
    db.update(rounds).set(update).where(eq(rounds.id, args.roundId)).run()
    return mcpText({ roundId: args.roundId, ok: true })
  },
}

export const roundsTools = {
  'round:get_voting_config': getVotingConfigTool,
  'round:increment_proposals_received': incrementProposalsReceivedTool,
  'round:update_voting_config': updateVotingConfigTool,
}
