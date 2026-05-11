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
import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from 'viem'
import { randomUUID } from 'node:crypto'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import {
  FundRegistryClient,
  fundRegistryAbi,
  roundSubjectFor,
  type RoundStatus,
} from '@smart-agent/sdk'
import { requireFundRegistryAddress, getPublicClient } from '../lib/contracts.js'
import { callA2aRedeem, callA2aRedeemSubDelegated } from '../lib/a2a-client.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

// Phase 2 — A2A task identifiers bind a sub-delegation to a single task
// lifecycle. The web action layer SHOULD pass a proper A2A taskId
// downstream; until that's wired we synthesize one from (mcpCallId, time)
// so each call still gets a unique task hash for the audit trail.
function generateTaskId(mcpCallId: string): string {
  return `a2a-task:${mcpCallId}:${Date.now()}`
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

/** Spec 004 R10 — voting strategy concept hashes. The on-chain attr
 *  stores keccak256(curie); decode back to the human label for the API. */
const VOTING_STRATEGY_CONCEPT: Record<string, string> = {
  'steward-quorum':   'sa:VotingStewardQuorum',
  'member-approval':  'sa:VotingMemberApproval',
  quadratic:          'sa:VotingQuadratic',
  'ranked-choice':    'sa:VotingRankedChoice',
}
const VOTING_STRATEGY_BY_HASH: Map<string, string> = new Map(
  Object.entries(VOTING_STRATEGY_CONCEPT).map(([label, curie]) => [
    keccak256(toHex(curie)).toLowerCase(),
    label,
  ]),
)
function votingStrategyLabel(hash: `0x${string}`): string {
  return VOTING_STRATEGY_BY_HASH.get(hash.toLowerCase()) ?? 'steward-quorum'
}

const DEFAULT_VOTING_STRATEGY = 'steward-quorum'
const DEFAULT_VOTING_THRESHOLD = 2

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
    "Read the voting config (strategy / threshold / window) for a round. Spec 004 R10 — config now lives on chain in FundRegistry attrs; eligibility is enforced by the RoundVoterCredential AnonCreds check at vote:cast time (not a separate field).",
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
    const cfg = await readVotingConfigFromChain(args.roundId)
    return mcpText({
      config: {
        id: args.roundId,
        votingStrategy: cfg.votingStrategy,
        votingThreshold: cfg.votingThreshold,
        votingWindowStartsAt: cfg.votingWindowStartsAt,
        votingWindowEndsAt: cfg.votingWindowEndsAt,
        // R10 — `eligible_voters` field dropped; eligibility flows through
        // the RoundVoterCredential issuance set (the round admin chooses
        // who gets a cred). Surfacing a kind=`anoncreds-credential` for
        // back-compat with the existing UI shape.
        eligibleVoters: { kind: 'anoncreds-credential' as const },
        proposalsReceived: getProposalsReceived(args.roundId),
      },
    })
  },
}

/** Read voting config from FundRegistry, applying defaults when unset. */
export async function readVotingConfigFromChain(roundIdOrSubject: string): Promise<{
  votingStrategy: string
  votingThreshold: number
  votingWindowStartsAt: string | null
  votingWindowEndsAt: string | null
}> {
  const slug = roundSlug(roundIdOrSubject)
  const subject = roundSubjectFor(slug)
  const client = getPublicClient()
  const [strategyHash, threshold, startsAt, endsAt] = await client.readContract({
    address: requireFundRegistryAddress(),
    abi: fundRegistryAbi,
    functionName: 'getRoundVotingConfig',
    args: [subject],
  }) as [`0x${string}`, bigint, bigint, bigint]
  const strategy =
    strategyHash === '0x0000000000000000000000000000000000000000000000000000000000000000'
      ? DEFAULT_VOTING_STRATEGY
      : votingStrategyLabel(strategyHash)
  return {
    votingStrategy: strategy,
    votingThreshold: threshold === 0n ? DEFAULT_VOTING_THRESHOLD : Number(threshold),
    votingWindowStartsAt: startsAt === 0n ? null : new Date(Number(startsAt) * 1000).toISOString(),
    votingWindowEndsAt:   endsAt === 0n ? null : new Date(Number(endsAt) * 1000).toISOString(),
  }
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
  /** Deprecated — R10 drops the dedicated eligibility field; the round
   *  admin issues RoundVoterCredentials to whoever can vote. Kept for
   *  ABI back-compat but ignored. */
  eligibleVoters?: Record<string, unknown>
  _a2aSessionId?: string
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
    const sessionId = requireA2aSessionId(args)
    const subject = roundSubjectFor(roundSlug(args.roundId))

    // Read current config so we can fall back to the on-chain defaults
    // for any field the caller didn't pass.
    const current = await readVotingConfigFromChain(args.roundId)
    const strategyLabel = args.votingStrategy ?? current.votingStrategy
    const strategyCurie = VOTING_STRATEGY_CONCEPT[strategyLabel] ?? VOTING_STRATEGY_CONCEPT[DEFAULT_VOTING_STRATEGY]
    const strategyHash = keccak256(toHex(strategyCurie))
    const threshold = BigInt(args.votingThreshold ?? current.votingThreshold)
    const startsAt = args.votingWindowStartsAt
      ? BigInt(Math.floor(Date.parse(args.votingWindowStartsAt) / 1000))
      : current.votingWindowStartsAt
        ? BigInt(Math.floor(Date.parse(current.votingWindowStartsAt) / 1000))
        : 0n
    const endsAt = args.votingWindowEndsAt
      ? BigInt(Math.floor(Date.parse(args.votingWindowEndsAt) / 1000))
      : current.votingWindowEndsAt
        ? BigInt(Math.floor(Date.parse(current.votingWindowEndsAt) / 1000))
        : 0n
    void args.eligibleVoters  // R10 dropped — eligibility flows via RoundVoterCredential

    const data = encodeFunctionData({
      abi: fundRegistryAbi,
      functionName: 'setRoundVotingConfig',
      args: [subject, strategyHash, threshold, startsAt, endsAt],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'round:update_voting_config',
      mcpCallId: randomUUID(),
      target: requireFundRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({ roundId: args.roundId, ok: true, txHash: r.txHash })
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
