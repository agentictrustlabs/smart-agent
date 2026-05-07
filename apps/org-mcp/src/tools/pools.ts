/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pool MCP tools.
 *
 * Phase 0.3 (on-chain attributes): pool *body* lives on chain in the
 * PoolRegistry's own typed-attribute storage. This module manages the
 * aggregate-counter cache (pledged / allocated / available totals) per
 * IA P4 § 8.2 — frequent mutations stay off-chain; the canonical public
 * mirror is the debounced on-chain `sa:PoolPledgedTotalAssertion` event.
 *
 * Tools registered:
 *   - pool:init_counters         — first-time row + initial counters,
 *                                  called by the web action layer after
 *                                  PoolRegistry.open() completes.
 *   - pool:contribute_to_total   — system-delegation: bumps pledgedTotal
 *                                  and recomputes availableTotal.
 *   - pool:read_counters         — read the counter row + name + treasury.
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

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:init_counters
// ───────────────────────────────────────────────────────────────────────
//
// Called by apps/web/src/lib/actions/poolCreate.action.ts AFTER the on-chain
// PoolRegistry.open() succeeds. Idempotent: re-creating the same pool id is
// a no-op (returns existing row).

interface InitCountersArgs {
  token: string
  poolAgentId: string                       // = pool IRI urn:smart-agent:pool:<slug>
  treasuryAddress: string                   // pool agent address
  name: string
  acceptedRestrictions?: Record<string, unknown>
  acceptedUnits?: string[]
  capacityCeiling?: number | null
  ceilingPolicy?: 'block' | 'waitlist' | 'accept'
  visibility?: 'public' | 'private'
  addressedMembers?: string[] | null
  stewards?: string[]
}

const initCountersTool = {
  name: 'pool:init_counters',
  description:
    'Initialize the aggregate-counter row + denormalized body cache for a pool after PoolRegistry.open() completes. Idempotent. Body source-of-truth lives on chain.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
      treasuryAddress: { type: 'string' },
      name: { type: 'string' },
      acceptedRestrictions: { type: 'object' },
      acceptedUnits: { type: 'array', items: { type: 'string' } },
      capacityCeiling: { type: 'number' },
      ceilingPolicy: { type: 'string', enum: ['block', 'waitlist', 'accept'] },
      visibility: { type: 'string', enum: ['public', 'private'] },
      addressedMembers: { type: 'array', items: { type: 'string' } },
      stewards: { type: 'array', items: { type: 'string' } },
    },
    required: ['token', 'poolAgentId', 'treasuryAddress', 'name'],
  },
  handler: async (args: InitCountersArgs) => {
    await requireOrgPrincipal(args.token, args, 'pool:init_counters')
    const existing = db.select().from(pools).where(eq(pools.id, args.poolAgentId)).all()[0]
    if (existing) {
      return mcpText({ poolAgentId: args.poolAgentId, treasuryAddress: existing.treasuryAddress, alreadyExists: true })
    }
    const now = nowIso()
    db.insert(pools).values({
      id: args.poolAgentId,
      treasuryAddress: args.treasuryAddress,
      name: args.name,
      acceptedRestrictions: JSON.stringify(args.acceptedRestrictions ?? {}),
      acceptedUnits: JSON.stringify(args.acceptedUnits ?? []),
      capacityCeiling: args.capacityCeiling ?? null,
      ceilingPolicy: args.ceilingPolicy ?? 'accept',
      visibility: args.visibility ?? 'public',
      addressedMembers: args.addressedMembers ? JSON.stringify(args.addressedMembers) : null,
      stewards: JSON.stringify(args.stewards ?? []),
      pledgedTotal: 0,
      allocatedTotal: 0,
      availableTotal: 0,
      createdAt: now,
      updatedAt: now,
    }).run()
    return mcpText({ poolAgentId: args.poolAgentId, treasuryAddress: args.treasuryAddress })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:read_counters
// ───────────────────────────────────────────────────────────────────────

const readCountersTool = {
  name: 'pool:read_counters',
  description: 'Read the aggregate-counter row for a pool. Body fields live on chain in PoolRegistry.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
    },
    required: ['token', 'poolAgentId'],
  },
  handler: async (args: { token: string; poolAgentId: string }) => {
    await requireOrgPrincipal(args.token, args, 'pool:read_counters')
    const r = db.select().from(pools).where(eq(pools.id, args.poolAgentId)).all()[0]
    if (!r) return mcpText({ pool: null })
    return mcpText({
      pool: {
        id: r.id,
        treasuryAddress: r.treasuryAddress,
        name: r.name,
        addressedMembers: r.addressedMembers ? safeJson<string[]>(r.addressedMembers, []) : null,
        pledgedTotal: r.pledgedTotal,
        allocatedTotal: r.allocatedTotal,
        availableTotal: r.availableTotal,
      },
    })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:contribute_to_total
// ───────────────────────────────────────────────────────────────────────
//
// System-delegation: bump pledgedTotal by `amount` (signed delta). Issued by
// donor's MCP on submit / amend / stop. Recomputes availableTotal.

interface ContributeArgs {
  token: string
  poolAgentId: string
  amountDelta: number
}

const contributeToTotalTool = {
  name: 'pool:contribute_to_total',
  description:
    "System-delegation: apply a signed delta to a pool's pledgedTotal. Recomputes availableTotal = pledgedTotal − allocatedTotal. Issued by donor's MCP on submit/amend/stop.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
      amountDelta: { type: 'integer' },
    },
    required: ['token', 'poolAgentId', 'amountDelta'],
  },
  handler: async (args: ContributeArgs) => {
    await requireOrgPrincipal(args.token, args, 'pool:contribute_to_total')
    const r = db.select().from(pools).where(eq(pools.id, args.poolAgentId)).all()[0]
    if (!r) throw new Error(`pool ${args.poolAgentId} not found`)
    const next = r.pledgedTotal + args.amountDelta
    const available = next - r.allocatedTotal
    db.update(pools)
      .set({ pledgedTotal: next, availableTotal: available, updatedAt: nowIso() })
      .where(eq(pools.id, args.poolAgentId))
      .run()
    return mcpText({ poolAgentId: args.poolAgentId, pledgedTotal: next, availableTotal: available })
  },
}

export const poolsTools = {
  'pool:init_counters': initCountersTool,
  'pool:read_counters': readCountersTool,
  'pool:contribute_to_total': contributeToTotalTool,
}
