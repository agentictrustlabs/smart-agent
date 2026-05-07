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

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:create
// ───────────────────────────────────────────────────────────────────────
//
// Treasury Phase 2 — persist a Pool body. The actual on-chain artifacts
// (AgentAccountFactory.createAccount, MandateRegistry.setMandate,
// StewardEligibilityRegistry.setSteward × N, initial STEWARDSHIP_DELEGATION
// mint, sa:PoolOpenedAssertion emit) are orchestrated by the web action
// layer (apps/web/src/lib/actions/poolCreate.action.ts) which has the
// DEPLOYER_PRIVATE_KEY. By the time this MCP tool is called, `treasuryAddress`
// is already deployed; this tool just records the org-mcp body.
//
// The tool is callable by any org principal — pool ownership is enforced
// downstream via the on-chain steward set, not here.

interface CreatePoolArgs {
  token: string
  id: string                          // canonical pool IRI: urn:smart-agent:pool:<slug>
  name: string
  domain: string
  mandate: Record<string, unknown>
  governanceModel: 'fund' | 'coaching-network' | 'prayer-chain' | 'skills-bench' | 'hospitality-network'
  acceptedRestrictions: Record<string, unknown>
  acceptedUnits: string[]
  capacityCeiling?: number | null
  ceilingPolicy: 'block' | 'waitlist' | 'accept'
  visibility: 'public' | 'private'
  treasuryAddress: string             // already-deployed pool AgentAccount
  stewardshipAgent?: string
  stewards?: string[]
  acceptsOpenCalls?: boolean
  addressedTo?: string
  addressedMembers?: string[]
  onChainAssertionId?: string
}

const createPoolTool = {
  name: 'pool:create',
  description:
    "Persist a new Pool body in org-mcp. Treasury contracts (AgentAccount, registries, STEWARDSHIP_DELEGATION) are deployed and mounted by the web action layer BEFORE this tool is called; the on-chain treasuryAddress is passed in. Emits sa:PoolOpenedAssertion via the action layer.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      domain: { type: 'string' },
      mandate: { type: 'object' },
      governanceModel: { type: 'string' },
      acceptedRestrictions: { type: 'object' },
      acceptedUnits: { type: 'array', items: { type: 'string' } },
      capacityCeiling: { type: 'number' },
      ceilingPolicy: { type: 'string', enum: ['block', 'waitlist', 'accept'] },
      visibility: { type: 'string', enum: ['public', 'private'] },
      treasuryAddress: { type: 'string' },
      stewardshipAgent: { type: 'string' },
      stewards: { type: 'array', items: { type: 'string' } },
      acceptsOpenCalls: { type: 'boolean' },
      addressedTo: { type: 'string' },
      addressedMembers: { type: 'array', items: { type: 'string' } },
      onChainAssertionId: { type: 'string' },
    },
    required: ['token', 'id', 'name', 'domain', 'mandate', 'governanceModel', 'acceptedRestrictions', 'acceptedUnits', 'ceilingPolicy', 'visibility', 'treasuryAddress'],
  },
  handler: async (args: CreatePoolArgs) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'pool:create')
    const existing = db.select().from(pools).where(eq(pools.id, args.id)).all()[0]
    if (existing) throw new Error(`pool ${args.id} already exists`)
    const now = nowIso()
    db.insert(pools).values({
      id: args.id,
      orgPrincipal,
      name: args.name,
      domain: args.domain,
      mandate: JSON.stringify(args.mandate),
      governanceModel: args.governanceModel,
      acceptedRestrictions: JSON.stringify(args.acceptedRestrictions),
      acceptedUnits: JSON.stringify(args.acceptedUnits),
      capacityCeiling: args.capacityCeiling ?? null,
      ceilingPolicy: args.ceilingPolicy,
      addressedTo: args.addressedTo ?? `hub:${orgPrincipal}`,
      addressedMembers: args.addressedMembers ? JSON.stringify(args.addressedMembers) : null,
      visibility: args.visibility,
      stewardshipAgent: args.stewardshipAgent ?? args.treasuryAddress,
      stewards: JSON.stringify(args.stewards ?? [args.treasuryAddress]),
      acceptsOpenCalls: args.acceptsOpenCalls !== false,
      pledgedTotal: 0,
      allocatedTotal: 0,
      availableTotal: 0,
      onChainAssertionId: args.onChainAssertionId ?? null,
      createdAt: now,
      updatedAt: now,
    }).run()
    return mcpText({ poolAgentId: args.id, treasuryAddress: args.treasuryAddress })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:rotate_stewards
// ───────────────────────────────────────────────────────────────────────
//
// Hats-style rotation. The on-chain authority change is a single
// `StewardEligibilityRegistry.setSteward(...)` per mutation (handled by
// the web action layer); this tool keeps the MCP-side `pools.stewards`
// JSON in sync so off-chain queries (steward UI, dashboards) see the
// current set without reading the registry. Per
// output/dao-pool-round-best-practices.md § 3 Q3 — *no* STEWARDSHIP_DELEGATION
// re-mint required.

interface RotateStewardsArgs {
  token: string
  poolAgentId: string
  added?: string[]                  // newly-eligible steward agent IRIs
  removed?: string[]                // newly-ineligible steward agent IRIs
  threshold?: number                // optional new N-of-M
}

const rotateStewardsTool = {
  name: 'pool:rotate_stewards',
  description:
    "Update the off-chain steward roster snapshot for a Pool after the web action layer has called StewardEligibilityRegistry.setSteward on chain. Hats-style: NO STEWARDSHIP_DELEGATION re-mint; the registry write cascades automatically through StewardEligibilityEnforcer at the next redeem. Emits sa:StewardSetUpdatedAssertion via the action layer.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
      added: { type: 'array', items: { type: 'string' } },
      removed: { type: 'array', items: { type: 'string' } },
      threshold: { type: 'integer' },
    },
    required: ['token', 'poolAgentId'],
  },
  handler: async (args: RotateStewardsArgs) => {
    await requireOrgPrincipal(args.token, args, 'pool:rotate_stewards')
    const r = db.select().from(pools).where(eq(pools.id, args.poolAgentId)).all()[0]
    if (!r) throw new Error(`pool ${args.poolAgentId} not found`)
    const current = new Set(safeJson<string[]>(r.stewards, []))
    for (const a of args.added ?? []) current.add(a)
    for (const removed of args.removed ?? []) current.delete(removed)
    const next = Array.from(current)
    db.update(pools)
      .set({ stewards: JSON.stringify(next), updatedAt: nowIso() })
      .where(eq(pools.id, args.poolAgentId))
      .run()
    return mcpText({
      poolAgentId: args.poolAgentId,
      stewards: next,
      threshold: args.threshold ?? null,
    })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:update_mandate
// ───────────────────────────────────────────────────────────────────────
//
// Persists the new mandate JSON. Web action layer also calls
// MandateRegistry.setMandate(pool, kindsRoot, geoRoot) on chain and
// emits sa:PoolMandateUpdatedAssertion; this tool keeps the MCP-side
// body in sync.

interface UpdateMandateArgs {
  token: string
  poolAgentId: string
  mandate: Record<string, unknown>
  acceptedRestrictions?: Record<string, unknown>
}

const updateMandateTool = {
  name: 'pool:update_mandate',
  description:
    "Persist a Pool's new mandate JSON. Web action layer pairs this with MandateRegistry.setMandate (on-chain authority) + sa:PoolMandateUpdatedAssertion (public mirror). Stewards approve the mandate change via STEWARDSHIP_DELEGATION redemption.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
      mandate: { type: 'object' },
      acceptedRestrictions: { type: 'object' },
    },
    required: ['token', 'poolAgentId', 'mandate'],
  },
  handler: async (args: UpdateMandateArgs) => {
    await requireOrgPrincipal(args.token, args, 'pool:update_mandate')
    const r = db.select().from(pools).where(eq(pools.id, args.poolAgentId)).all()[0]
    if (!r) throw new Error(`pool ${args.poolAgentId} not found`)
    const update: Record<string, unknown> = {
      mandate: JSON.stringify(args.mandate),
      updatedAt: nowIso(),
    }
    if (args.acceptedRestrictions) {
      update.acceptedRestrictions = JSON.stringify(args.acceptedRestrictions)
    }
    db.update(pools).set(update).where(eq(pools.id, args.poolAgentId)).run()
    return mcpText({ poolAgentId: args.poolAgentId, mandate: args.mandate })
  },
}

export const poolsTools = {
  'pool:read': readPoolTool,
  'pool:contribute_to_total': contributeToTotalTool,
  'pool:create': createPoolTool,
  'pool:rotate_stewards': rotateStewardsTool,
  'pool:update_mandate': updateMandateTool,
}
