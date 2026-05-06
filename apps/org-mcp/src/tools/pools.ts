/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pool MCP tools.
 *
 * Pool authoring is OUT of scope for this spec — these tools READ and
 * provide the system-delegation handler for `pool:contribute_to_total`.
 * Pre-seeded pools live in `apps/org-mcp/src/db/schema.ts: pools`
 * (org_principal = pool's own agent). Persistence per IA § 2.2.
 *
 * Tools registered (each tool name === scope name):
 *   - pool:read                       — read a Pool body (used by donor
 *                                        MCPs for v1 same-DB validation).
 *   - pool:contribute_to_total        — system-delegation handler that
 *                                        bumps pledgedTotal + recomputes
 *                                        availableTotal.
 */
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { pools } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function nowIso(): string {
  return new Date().toISOString()
}

function safeJson<T>(raw: string | null | undefined, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T } catch { return fb }
}

const readPoolTool = {
  name: 'pool:read',
  description:
    "Read a Pool body (mandate, accepted units/restrictions, capacity, ceiling policy, etc.). Used by the donor's MCP at submit-time validation.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
    },
    required: ['token', 'poolAgentId'],
  },
  handler: async (args: { token: string; poolAgentId: string }) => {
    await requireOrgPrincipal(args.token, args, 'pool:read')
    const r = db.select().from(pools).where(eq(pools.id, args.poolAgentId)).all()[0]
    if (!r) return mcpText({ pool: null })
    const pool = {
      id: r.id,
      orgPrincipal: r.orgPrincipal,
      name: r.name,
      domain: r.domain,
      mandate: safeJson(r.mandate, {}),
      governanceModel: r.governanceModel,
      acceptedRestrictions: safeJson(r.acceptedRestrictions, {}),
      acceptedUnits: safeJson<string[]>(r.acceptedUnits, []),
      capacityCeiling: r.capacityCeiling,
      ceilingPolicy: r.ceilingPolicy,
      addressedTo: r.addressedTo,
      addressedMembers: r.addressedMembers ? safeJson<string[]>(r.addressedMembers, []) : null,
      visibility: r.visibility,
      stewardshipAgent: r.stewardshipAgent,
      stewards: safeJson<string[]>(r.stewards, []),
      acceptsOpenCalls: r.acceptsOpenCalls,
      pledgedTotal: r.pledgedTotal,
      allocatedTotal: r.allocatedTotal,
      availableTotal: r.availableTotal,
      onChainAssertionId: r.onChainAssertionId,
    }
    return mcpText({ pool })
  },
}

const contributeToTotalTool = {
  name: 'pool:contribute_to_total',
  description:
    "System-delegation: apply a signed delta to a pool's pledgedTotal aggregate. Recomputes availableTotal = pledgedTotal − allocatedTotal. Issued by donor's MCP on submit / amend / stop.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
      delta: { type: 'integer' },
    },
    required: ['token', 'poolAgentId', 'delta'],
  },
  handler: async (args: { token: string; poolAgentId: string; delta: number }) => {
    await requireOrgPrincipal(args.token, args, 'pool:contribute_to_total')
    if (typeof args.delta !== 'number') {
      throw new Error('delta must be a number')
    }
    const r = db.select().from(pools).where(eq(pools.id, args.poolAgentId)).all()[0]
    if (!r) throw new Error(`pool ${args.poolAgentId} not found`)
    const next = Math.max(0, (r.pledgedTotal ?? 0) + args.delta)
    const allocated = r.allocatedTotal ?? 0
    const available = Math.max(0, next - allocated)
    db.update(pools)
      .set({ pledgedTotal: next, availableTotal: available, updatedAt: nowIso() })
      .where(eq(pools.id, args.poolAgentId))
      .run()
    return mcpText({ poolAgentId: args.poolAgentId, pledgedTotal: next, availableTotal: available })
  },
}

export const poolsTools = {
  'pool:read': readPoolTool,
  'pool:contribute_to_total': contributeToTotalTool,
}
