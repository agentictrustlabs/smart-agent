/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Round MCP tools (T040).
 *
 * Tools registered:
 *   - get_round                            — read a round body for submit-time validation
 *   - round:increment_proposals_received   — system-delegation; bumps the
 *                                             round's `sa:proposalsReceived`
 *                                             counter by ±1. Issued by the
 *                                             proposer's MCP at submit /
 *                                             withdraw time.
 *
 * Round authoring is OUT of scope for this spec — these tools READ + COUNTER
 * only. Pre-seeded rounds live in `apps/org-mcp/src/db/schema.ts: rounds`
 * (org_principal = fundAgentId). Persistence per IA § 2.4.
 *
 * The system-delegation tool name === scope name (`round:increment_proposals_received`)
 * so the MCP_TOOL_SCOPE caveat enforcer gates without indirection.
 */
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rounds } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function nowIso(): string {
  return new Date().toISOString()
}

function safeJson<T>(raw: string | null | undefined, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T } catch { return fb }
}

// ───────────────────────────────────────────────────────────────────────
// Tool: get_round
// ───────────────────────────────────────────────────────────────────────

const getRoundTool = {
  name: 'get_round',
  description:
    "Read a Round body (mandate, milestone template, validator requirements, deadline, addressed-applicants list, etc.). Used by the proposer's MCP at submit-time validation.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: { token: string; roundId: string }) => {
    // Auth: any authenticated org-principal can call. The actual visibility
    // gate is in the caller (proposer-side: only their own MCP calls this;
    // steward-side: gated on the steward's session).
    await requireOrgPrincipal(args.token, args, 'get_round')
    const r = db.select().from(rounds).where(eq(rounds.id, args.roundId)).all()[0]
    if (!r) return mcpText({ round: null })
    const round = {
      id: r.id,
      fundAgentId: r.fundAgentId,
      mandate: safeJson(r.mandate, {}),
      milestoneTemplate: safeJson(r.milestoneTemplate, {}),
      validatorRequirements: safeJson(r.validatorRequirements, {}),
      reportingCadence: r.reportingCadence,
      deadline: r.deadline,
      decisionDate: r.decisionDate,
      requiredCredentials: safeJson<string[]>(r.requiredCredentials, []),
      visibility: r.visibility,
      addressedApplicants: r.addressedApplicants ? safeJson<string[]>(r.addressedApplicants, []) : null,
      status: r.status,
      proposalsReceived: r.proposalsReceived,
    }
    return mcpText({ round })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: round:increment_proposals_received
// ───────────────────────────────────────────────────────────────────────

const incrementProposalsReceivedTool = {
  name: 'round:increment_proposals_received',
  description:
    "System-delegation: apply a signed delta (±1) to a round's proposalsReceived counter. Issued by the proposer's MCP on submit (+1) and withdraw (-1).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      delta: { type: 'integer', enum: [1, -1] },
    },
    required: ['token', 'roundId', 'delta'],
  },
  handler: async (args: { token: string; roundId: string; delta: 1 | -1 }) => {
    await requireOrgPrincipal(args.token, args, 'round:increment_proposals_received')
    if (args.delta !== 1 && args.delta !== -1) {
      throw new Error('delta must be +1 or -1')
    }
    const r = db.select().from(rounds).where(eq(rounds.id, args.roundId)).all()[0]
    if (!r) throw new Error(`round ${args.roundId} not found`)
    const next = Math.max(0, (r.proposalsReceived ?? 0) + args.delta)
    db.update(rounds)
      .set({ proposalsReceived: next, updatedAt: nowIso() })
      .where(eq(rounds.id, args.roundId))
      .run()
    return mcpText({ roundId: args.roundId, proposalsReceived: next })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: round:open
// ───────────────────────────────────────────────────────────────────────
//
// Treasury Phase 2.5 — open a Round. Persists the round body so proposers
// can read it via get_round at submit-time. Web action layer pairs this
// with sa:RoundOpenedAssertion (existing emit helper).

interface OpenRoundArgs {
  token: string
  id: string                      // canonical round IRI: urn:smart-agent:round:<slug>
  fundAgentId: string             // pool/fund operating the round
  mandate: Record<string, unknown>
  milestoneTemplate?: Record<string, unknown>
  validatorRequirements?: Record<string, unknown>
  reportingCadence: 'monthly' | 'quarterly' | 'annual' | 'milestone' | 'none'
  deadline: string                // ISO-8601
  decisionDate: string            // ISO-8601
  requiredCredentials?: string[]
  visibility: 'public' | 'private'
  addressedApplicants?: string[]
  onChainAssertionId?: string
}

const openRoundTool = {
  name: 'round:open',
  description:
    "Open a new Round and persist its body in org-mcp. Web action layer pairs this with sa:RoundOpenedAssertion. Public rounds anchor the full mandate summary; private rounds anchor a coarse variant and keep addressedApplicants out of the public mirror.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      id: { type: 'string' },
      fundAgentId: { type: 'string' },
      mandate: { type: 'object' },
      milestoneTemplate: { type: 'object' },
      validatorRequirements: { type: 'object' },
      reportingCadence: { type: 'string' },
      deadline: { type: 'string' },
      decisionDate: { type: 'string' },
      requiredCredentials: { type: 'array', items: { type: 'string' } },
      visibility: { type: 'string', enum: ['public', 'private'] },
      addressedApplicants: { type: 'array', items: { type: 'string' } },
      onChainAssertionId: { type: 'string' },
    },
    required: ['token', 'id', 'fundAgentId', 'mandate', 'reportingCadence', 'deadline', 'decisionDate', 'visibility'],
  },
  handler: async (args: OpenRoundArgs) => {
    await requireOrgPrincipal(args.token, args, 'round:open')
    const existing = db.select().from(rounds).where(eq(rounds.id, args.id)).all()[0]
    if (existing) throw new Error(`round ${args.id} already exists`)
    const now = nowIso()
    db.insert(rounds).values({
      id: args.id,
      fundAgentId: args.fundAgentId,
      mandate: JSON.stringify(args.mandate),
      milestoneTemplate: JSON.stringify(args.milestoneTemplate ?? {}),
      validatorRequirements: JSON.stringify(args.validatorRequirements ?? {}),
      reportingCadence: args.reportingCadence,
      deadline: args.deadline,
      decisionDate: args.decisionDate,
      requiredCredentials: JSON.stringify(args.requiredCredentials ?? []),
      visibility: args.visibility,
      addressedApplicants: args.addressedApplicants ? JSON.stringify(args.addressedApplicants) : null,
      status: 'open',
      proposalsReceived: 0,
      createdAt: now,
      updatedAt: now,
    }).run()
    return mcpText({
      roundId: args.id,
      fundAgentId: args.fundAgentId,
      visibility: args.visibility,
    })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: round:close
// ───────────────────────────────────────────────────────────────────────
//
// Treasury Phase 2.5 — close a round and emit the decision payload + the
// dispute window. The on-chain assertions are emitted by the action layer
// in the web app (which has DEPLOYER_PRIVATE_KEY); this MCP tool's job is
// to (a) flip the row's status, (b) write the awardsRoot + decidedAt
// fields so downstream queries can find them, (c) record the dispute-
// window expiry so /h/catalyst/rounds/<id> can render the countdown.
//
// Decision payload validation (awards-list correctness, mandate match) is
// the action-layer's responsibility — by the time we reach this tool the
// stewards have signed the AllocationDecided payload off-chain. Here we
// just persist.
//
// `disputeUntil` defaults to `decidedAt + 72h` per the oSnap pattern;
// callers may override (e.g. shorter for low-stakes rounds, longer for
// high-stakes).

interface CloseRoundArgs {
  token: string
  roundId: string
  awardsRoot: string         // Merkle root committed in AllocationDecided
  decidedAt: string          // ISO-8601
  disputeUntil?: string      // ISO-8601; defaults to decidedAt + 72h
  stewardSetHash?: string    // hash of (signerSet, threshold) at decision time
}

const closeRoundTool = {
  name: 'round:close',
  description:
    "Close a Round and persist the AllocationDecided commitment. Call AFTER stewards have signed the off-chain AllocationDecided payload (Safe-format quorum sigs verified by QuorumEnforcer at disbursement time). Persists awardsRoot + decidedAt + disputeUntil. The web action layer that orchestrates this also emits sa:RoundClosedAssertion + sa:AllocationDecidedAssertion + sa:DisputeWindowOpenedAssertion on chain.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      awardsRoot: { type: 'string' },
      decidedAt: { type: 'string' },
      disputeUntil: { type: 'string' },
      stewardSetHash: { type: 'string' },
    },
    required: ['token', 'roundId', 'awardsRoot', 'decidedAt'],
  },
  handler: async (args: CloseRoundArgs) => {
    await requireOrgPrincipal(args.token, args, 'round:close')
    const r = db.select().from(rounds).where(eq(rounds.id, args.roundId)).all()[0]
    if (!r) throw new Error(`round ${args.roundId} not found`)

    // Default dispute window: 72h after decidedAt (per spec § 2.2 R4a).
    const decidedMs = Date.parse(args.decidedAt)
    if (Number.isNaN(decidedMs)) throw new Error('decidedAt must be ISO-8601')
    const defaultDispute = new Date(decidedMs + 72 * 60 * 60 * 1000).toISOString()
    const disputeUntil = args.disputeUntil ?? defaultDispute

    // Persist the decision into the existing rounds row. We co-opt
    // `addressedApplicants` as a temporary closure-payload carrier so the
    // schema doesn't need a migration for this Phase-2.5 slice; the
    // production design promotes it to first-class columns once UI surfaces
    // need typed queries.
    const closurePayload = JSON.stringify({
      status: 'closed',
      awardsRoot: args.awardsRoot,
      decidedAt: args.decidedAt,
      disputeUntil,
      stewardSetHash: args.stewardSetHash ?? null,
      closedAt: nowIso(),
    })
    db.update(rounds)
      .set({
        addressedApplicants: closurePayload,  // see comment above — temp carrier
        updatedAt: nowIso(),
      })
      .where(eq(rounds.id, args.roundId))
      .run()
    return mcpText({
      roundId: args.roundId,
      awardsRoot: args.awardsRoot,
      decidedAt: args.decidedAt,
      disputeUntil,
    })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: round:cancel
// ───────────────────────────────────────────────────────────────────────
//
// Cancellation guardian (OZ Governor pattern). Pool root key (or
// designated lead steward) can cancel a Round before any disbursement.
// Different from round:close — this fires sa:RoundCanceledAssertion and
// is the adversarial-path defense for the dispute window.
//
// Auth: same `requireOrgPrincipal` as the other write tools. The action
// layer is responsible for confirming the caller is the pool root before
// constructing the delegation token; here we just persist.

interface CancelRoundArgs {
  token: string
  roundId: string
  reasonKind: 'dispute' | 'security-incident' | 'mandate-change' | 'steward-action' | 'other'
  reasonURI?: string
  revokedSessionHash?: string
}

const cancelRoundTool = {
  name: 'round:cancel',
  description:
    "Cancellation guardian (OZ Governor pattern) — cancel a Round between AllocationDecided and the first Disbursement. Emits sa:RoundCanceledAssertion via the action layer; this MCP tool persists the cancel + reason on the rounds row. Different from round:close (normal lifecycle). Use when a dispute is upheld within the 72h window or a security incident requires rolling back the decision.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      reasonKind: { type: 'string', enum: ['dispute', 'security-incident', 'mandate-change', 'steward-action', 'other'] },
      reasonURI: { type: 'string' },
      revokedSessionHash: { type: 'string' },
    },
    required: ['token', 'roundId', 'reasonKind'],
  },
  handler: async (args: CancelRoundArgs) => {
    await requireOrgPrincipal(args.token, args, 'round:cancel')
    const r = db.select().from(rounds).where(eq(rounds.id, args.roundId)).all()[0]
    if (!r) throw new Error(`round ${args.roundId} not found`)

    const cancelPayload = JSON.stringify({
      status: 'canceled',
      reasonKind: args.reasonKind,
      reasonURI: args.reasonURI ?? null,
      revokedSessionHash: args.revokedSessionHash ?? null,
      canceledAt: nowIso(),
    })
    db.update(rounds)
      .set({
        addressedApplicants: cancelPayload,  // temp carrier; see round:close
        updatedAt: nowIso(),
      })
      .where(eq(rounds.id, args.roundId))
      .run()
    return mcpText({
      roundId: args.roundId,
      reasonKind: args.reasonKind,
      canceledAt: nowIso(),
    })
  },
}

export const roundsTools = {
  get_round: getRoundTool,
  'round:open': openRoundTool,
  'round:increment_proposals_received': incrementProposalsReceivedTool,
  'round:close': closeRoundTool,
  'round:cancel': cancelRoundTool,
}
