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
      fundAgentId: r.orgPrincipal,
      mandate: safeJson(r.mandate, {}),
      milestoneTemplate: safeJson(r.milestoneTemplate, {}),
      validatorRequirements: safeJson(r.validatorRequirements, {}),
      reportingCadence: r.reportingCadence,
      deadline: r.deadline,
      decisionDate: r.decisionDate,
      requiredCredentials: safeJson<string[]>(r.requiredCredentials, []),
      visibility: r.visibility,
      addressedApplicants: r.addressedApplicants ? safeJson<string[]>(r.addressedApplicants, []) : null,
      proposalsReceived: r.proposalsReceived,
      onChainAssertionId: r.onChainAssertionId,
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

export const roundsTools = {
  get_round: getRoundTool,
  'round:increment_proposals_received': incrementProposalsReceivedTool,
}
