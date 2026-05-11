/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Round MCP tools.
 *
 * POST-PHASE-7: Round body (mandate, milestoneTemplate, validatorRequirements,
 * reportingCadence, deadline, decisionDate, requiredCredentials, visibility,
 * status, fundAgentId, slug) lives ON-CHAIN in FundRegistry. Read it via
 * `FundRegistryClient` (in `@smart-agent/sdk`) or `DiscoveryService.getRoundDetail`.
 *
 * Phase 1 (delegation refactor) — every on-chain mutation forwards to
 * a2a-agent's `/session/:id/redeem-tx` endpoint. The org-mcp wallet was
 * retired in this phase; the user's signed root delegation is redeemed by
 * a2a-agent's session EOA. See `callA2aRedeem` for the wire format.
 */
import { eq } from 'drizzle-orm'
import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from 'viem'
import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import { rounds } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import {
  FundRegistryClient,
  fundRegistryAbi,
  roundSubjectFor,
  type RoundStatus,
} from '@smart-agent/sdk'
import { requireFundRegistryAddress } from '../lib/contracts.js'
import { callA2aRedeem, callA2aRedeemSubDelegated } from '../lib/a2a-client.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

// Phase 2 — A2A task identifiers bind a sub-delegation to a single task
// lifecycle. The web action layer SHOULD pass a proper A2A taskId
// downstream; until that's wired we synthesize one from (mcpCallId, time)
// so each call still gets a unique task hash for the audit trail.
function generateTaskId(mcpCallId: string): string {
  return `a2a-task:${mcpCallId}:${Date.now()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function safeJson<T>(raw: string | null | undefined, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T } catch { return fb }
}

function requireA2aSessionId(args: { _a2aSessionId?: string }): string {
  const id = args._a2aSessionId
  if (!id || typeof id !== 'string') {
    throw new Error('missing _a2aSessionId — Phase 1 requires routing through a2a-agent mcp-proxy')
  }
  return id
}

/** keccak256 of a CURIE — matches FundRegistry's `concept(...)` helper. */
function concept(curie: string): Hex {
  return keccak256(toHex(curie))
}

const STATUS_CONCEPT: Record<RoundStatus, string> = {
  open: 'sa:RoundOpen',
  review: 'sa:RoundReview',
  decided: 'sa:RoundDecided',
  closed: 'sa:RoundClosed',
  canceled: 'sa:RoundCanceled',
}

/**
 * Spec 004 — `proposal_submissions` SQL table dropped; submitted proposals
 * live on chain in `GrantProposalRegistry`. Returns 0 until the on-chain
 * → GraphDB sync (R8) lands so this can scan the registry's events.
 */
export function getProposalsReceived(roundId: string): number {
  void roundId
  return 0
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

// ───────────────────────────────────────────────────────────────────────
// Phase 1 — On-chain round writes (a2a-agent stateless-redeem path)
// ───────────────────────────────────────────────────────────────────────

const CADENCE_CONCEPT: Record<string, string> = {
  monthly: 'sa:CadenceMonthly',
  quarterly: 'sa:CadenceQuarterly',
  annual: 'sa:CadenceAnnual',
  milestone: 'sa:CadenceMilestone',
  none: 'sa:CadenceNone',
}

/**
 * Strip an optional `urn:smart-agent:round:` prefix; return the bare slug.
 */
function roundSlug(roundId: string): string {
  return roundId.startsWith('urn:smart-agent:round:')
    ? roundId.slice('urn:smart-agent:round:'.length)
    : roundId
}

// ─── Tool: round:open ──────────────────────────────────────────────────

interface RoundOpenArgs {
  token: string
  roundId: string
  fundAgent: Address
  /** Optional pool agent that operates this round. */
  poolAgent?: Address
  /** Unix seconds. */
  deadline: number
  /** Unix seconds. */
  decisionDate: number
  reportingCadence: 'monthly' | 'quarterly' | 'annual' | 'milestone' | 'none'
  requiredCredentials?: string[]
  visibility: 'public' | 'private'
  initialStatus?: RoundStatus
  /** JSON-encoded body fields. The SDK passes them through to the registry. */
  mandate?: string
  milestoneTemplate?: string
  validatorRequirements?: string
  _a2aSessionId?: string
}

const openRoundTool = {
  name: 'round:open',
  description:
    "Open a round on chain via FundRegistry.openRound, redeemed through a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      fundAgent: { type: 'string' },
      poolAgent: { type: 'string' },
      deadline: { type: 'number' },
      decisionDate: { type: 'number' },
      reportingCadence: { type: 'string', enum: ['monthly', 'quarterly', 'annual', 'milestone', 'none'] },
      requiredCredentials: { type: 'array', items: { type: 'string' } },
      visibility: { type: 'string', enum: ['public', 'private'] },
      initialStatus: { type: 'string' },
      mandate: { type: 'string' },
      milestoneTemplate: { type: 'string' },
      validatorRequirements: { type: 'string' },
    },
    required: [
      'token', 'roundId', 'fundAgent', 'deadline', 'decisionDate',
      'reportingCadence', 'visibility',
    ],
  },
  handler: async (args: RoundOpenArgs) => {
    await requireOrgPrincipal(args.token, args, 'round:open')
    const sessionId = requireA2aSessionId(args)
    const slug = roundSlug(args.roundId)
    const params = FundRegistryClient.buildOpenParams({
      roundId: slug,
      fundAgent: args.fundAgent,
      poolAgent: args.poolAgent,
      deadline: BigInt(args.deadline),
      decisionDate: BigInt(args.decisionDate),
      reportingCadence: CADENCE_CONCEPT[args.reportingCadence] ?? 'sa:CadenceNone',
      requiredCredentials: args.requiredCredentials,
      visibility: args.visibility,
      initialStatus: args.initialStatus ?? 'open',
      mandate: args.mandate,
      milestoneTemplate: args.milestoneTemplate,
      validatorRequirements: args.validatorRequirements,
    })
    const data = encodeFunctionData({
      abi: fundRegistryAbi,
      functionName: 'openRound',
      args: [params],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'round:open',
      mcpCallId: randomUUID(),
      target: requireFundRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({
      ok: true as const,
      roundId: `urn:smart-agent:round:${slug}`,
      roundSubject: params.roundSubject,
      txHash: r.txHash,
    })
  },
}

// ─── Tool: round:set_status ────────────────────────────────────────────

interface SetStatusArgs {
  token: string
  roundId: string
  newStatus: RoundStatus
  _a2aSessionId?: string
}

const setStatusTool = {
  name: 'round:set_status',
  description:
    "Flip a round's status on chain (FundRegistry.setRoundStatus), redeemed via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      newStatus: { type: 'string', enum: ['open', 'review', 'decided', 'closed', 'canceled'] },
    },
    required: ['token', 'roundId', 'newStatus'],
  },
  handler: async (args: SetStatusArgs) => {
    await requireOrgPrincipal(args.token, args, 'round:set_status')
    const sessionId = requireA2aSessionId(args)
    const data = encodeFunctionData({
      abi: fundRegistryAbi,
      functionName: 'setRoundStatus',
      args: [roundSubjectFor(roundSlug(args.roundId)), concept(STATUS_CONCEPT[args.newStatus])],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'round:set_status',
      mcpCallId: randomUUID(),
      target: requireFundRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash, newStatus: args.newStatus })
  },
}

// ─── Tool: round:close ─────────────────────────────────────────────────
//
// Phase 2 — sub-delegated path (ROUND_AWARDS executor family). Per-call
// D_sub bound to (target=FundRegistry, selector=setRoundStatus,
// callData hash, taskId, 60s window) and revoked after submit.

interface CloseRoundArgs {
  token: string
  roundId: string
  a2aTaskId?: string
  _a2aSessionId?: string
}

const closeRoundTool = {
  name: 'round:close',
  description:
    "Close a round on chain (status → 'closed'). Routes via a2a-agent's sub-delegated path: per-call D_sub bound to the calldata hash + 60s window + ROUND_AWARDS executor, revoked after submit.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      a2aTaskId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: CloseRoundArgs) => {
    await requireOrgPrincipal(args.token, args, 'round:close')
    const sessionId = requireA2aSessionId(args)
    const data = encodeFunctionData({
      abi: fundRegistryAbi,
      functionName: 'setRoundStatus',
      args: [roundSubjectFor(roundSlug(args.roundId)), concept(STATUS_CONCEPT.closed)],
    })
    const mcpCallId = randomUUID()
    const r = await callA2aRedeemSubDelegated(sessionId, {
      mcpTool: 'round:close',
      mcpCallId,
      a2aTaskId: args.a2aTaskId ?? generateTaskId(mcpCallId),
      target: requireFundRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash, newStatus: 'closed' as const })
  },
}

// ─── Tool: round:cancel ────────────────────────────────────────────────

interface CancelRoundArgs {
  token: string
  roundId: string
  a2aTaskId?: string
  _a2aSessionId?: string
}

const cancelRoundTool = {
  name: 'round:cancel',
  description:
    "Cancel a round on chain (status → 'canceled'). Routes via a2a-agent's sub-delegated path: per-call D_sub bound to the calldata hash + 60s window + ROUND_AWARDS executor, revoked after submit.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      a2aTaskId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: CancelRoundArgs) => {
    await requireOrgPrincipal(args.token, args, 'round:cancel')
    const sessionId = requireA2aSessionId(args)
    const data = encodeFunctionData({
      abi: fundRegistryAbi,
      functionName: 'setRoundStatus',
      args: [roundSubjectFor(roundSlug(args.roundId)), concept(STATUS_CONCEPT.canceled)],
    })
    const mcpCallId = randomUUID()
    const r = await callA2aRedeemSubDelegated(sessionId, {
      mcpTool: 'round:cancel',
      mcpCallId,
      a2aTaskId: args.a2aTaskId ?? generateTaskId(mcpCallId),
      target: requireFundRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash, newStatus: 'canceled' as const })
  },
}

// ─── Tool: round:set_awards_root ───────────────────────────────────────

interface SetAwardsRootArgs {
  token: string
  roundId: string
  awardsRoot: Hex
  /** Unix seconds for the dispute-window deadline. */
  disputeUntil: number
  a2aTaskId?: string
  _a2aSessionId?: string
}

const setAwardsRootTool = {
  name: 'round:set_awards_root',
  description:
    "Commit the round's awards Merkle root + dispute-window deadline on chain. Routes via a2a-agent's sub-delegated path (sensitive tier): per-call D_sub bound to the calldata hash + 60s window + ROUND_AWARDS executor, revoked after submit.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      awardsRoot: { type: 'string' },
      disputeUntil: { type: 'number' },
      a2aTaskId: { type: 'string' },
    },
    required: ['token', 'roundId', 'awardsRoot', 'disputeUntil'],
  },
  handler: async (args: SetAwardsRootArgs) => {
    await requireOrgPrincipal(args.token, args, 'round:set_awards_root')
    const sessionId = requireA2aSessionId(args)
    const data = encodeFunctionData({
      abi: fundRegistryAbi,
      functionName: 'setRoundAwardsRoot',
      args: [roundSubjectFor(roundSlug(args.roundId)), args.awardsRoot, BigInt(args.disputeUntil)],
    })
    const mcpCallId = randomUUID()
    const r = await callA2aRedeemSubDelegated(sessionId, {
      mcpTool: 'round:set_awards_root',
      mcpCallId,
      a2aTaskId: args.a2aTaskId ?? generateTaskId(mcpCallId),
      target: requireFundRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

export const roundsTools = {
  'round:get_voting_config': getVotingConfigTool,
  'round:increment_proposals_received': incrementProposalsReceivedTool,
  'round:update_voting_config': updateVotingConfigTool,
  'round:open': openRoundTool,
  'round:set_status': setStatusTool,
  'round:close': closeRoundTool,
  'round:cancel': cancelRoundTool,
  'round:set_awards_root': setAwardsRootTool,
}
