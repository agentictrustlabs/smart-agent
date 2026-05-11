/**
 * Spec 002 — Intent Marketplace (Pool Lane). PoolPledge MCP tools.
 *
 * org-mcp side: org donors. Twins person-mcp's poolPledges.ts.
 *
 * Tools registered (each tool name === scope name):
 *   - pool_pledge:submit
 *   - pool_pledge:amend
 *   - pool_pledge:stop
 *   - pool_pledge:auto_stop   (system-delegation from pool steward)
 *   - pool_pledge:read_self
 *   - pool_pledge:read_pool_counters  (derived from pool_pledges sums)
 *
 * Persistence: `pool_pledges` table per IA § 2.2 (org-mcp tenancy column =
 * `principal`, NOT `org_principal`, per the IA classification doc).
 *
 * POST-PHASE-7: pool BODY (acceptedUnits, restrictions, capacityCeiling,
 * visibility, addressedMembers, stewards) lives ON-CHAIN in PoolRegistry.
 * The action layer pre-validates against DiscoveryService.getPoolDetail()
 * BEFORE invoking pool_pledge:submit. The MCP layer no longer body-validates
 * — it persists the pledge as-is and trusts the action-layer gate. Counters
 * (pledgedTotal / allocatedTotal / availableTotal) are DERIVED from
 * `pool_pledges` rows at read time via `pool_pledge:read_pool_counters`.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { keccak256, toHex } from 'viem'
import { db } from '../db/index.js'
import { poolPledges, orgCrossDelegationGrants } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

type Cadence = 'one-time' | 'monthly' | 'annual'
type StoryPermission = 'public' | 'shareWithSupportTeam' | 'anonymous'
type PledgeStatus = 'active' | 'waitlisted' | 'stopped' | 'auto-stopped' | 'fulfilled'
type Visibility = 'public' | 'public-coarse' | 'private'

interface PledgeRestrictions {
  kinds?: string[]
  geoRoots?: string[]
  notForAdmin?: boolean
  notForDiscretionary?: boolean
}

interface PledgeAmendment {
  kind: 'amount' | 'cadence' | 'duration'
  prevValue: number | string
  newValue: number | string
  amendedAt: string
  windowResetAt?: string
}

type SubmitErrorKind =
  | { kind: 'validation'; messages: string[] }

function err(error: SubmitErrorKind) {
  return mcpText({ ok: false as const, error })
}

function nowIso(): string {
  return new Date().toISOString()
}

function safeJson<T>(raw: string | null | undefined, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T } catch { return fb }
}

function cadenceAwareTotal(p: { cadence: Cadence; amount: number; duration?: number | null }): number {
  if (p.cadence === 'one-time') return p.amount
  const dur = p.duration ?? 1
  return p.amount * Math.max(1, dur)
}

/**
 * Derive a pool's counters from `pool_pledges` rows.
 *
 *   pledgedTotal   = SUM(cadence-aware amount * duration)
 *                    over rows WHERE pool_agent_id = ? AND status = 'active'
 *   allocatedTotal = 0   (allocation tracking deferred to a future spec)
 *   availableTotal = pledgedTotal - allocatedTotal
 *
 * No source-of-truth columns exist anymore; this is the only counter read.
 */
export function getPoolCounters(poolAgentId: string): {
  pledgedTotal: number
  allocatedTotal: number
  availableTotal: number
} {
  const rows = db.select({
    cadence: poolPledges.cadence,
    amount: poolPledges.amount,
    duration: poolPledges.duration,
  }).from(poolPledges)
    .where(and(
      eq(poolPledges.poolAgentId, poolAgentId),
      eq(poolPledges.status, 'active'),
    ))
    .all()
  let pledgedTotal = 0
  for (const r of rows) {
    pledgedTotal += cadenceAwareTotal({
      cadence: r.cadence as Cadence,
      amount: r.amount,
      duration: r.duration,
    })
  }
  const allocatedTotal = 0
  return {
    pledgedTotal,
    allocatedTotal,
    availableTotal: Math.max(0, pledgedTotal - allocatedTotal),
  }
}

function deriveVisibility(
  poolVisibility: 'public' | 'private',
  story: StoryPermission,
): Visibility {
  if (poolVisibility === 'private') return 'private'
  if (story === 'public') return 'public'
  if (story === 'shareWithSupportTeam') return 'public-coarse'
  return 'private'
}

function issueReadPledgeGrant(opts: {
  donorPrincipal: string
  poolAgentId: string
  pledgeId: string
}): void {
  const scope = `pool:read_pledge:${opts.poolAgentId}:${opts.pledgeId}`
  db.insert(orgCrossDelegationGrants).values({
    id: randomUUID(),
    orgPrincipal: opts.donorPrincipal,
    granteeAgent: opts.poolAgentId.toLowerCase(),
    scope: JSON.stringify({ scope, pledgeId: opts.pledgeId }),
    validFrom: nowIso(),
    validUntil: null,
    caveatTerms: null,
    createdAt: nowIso(),
    revokedAt: null,
  }).run()
}

interface SubmitArgs {
  token: string
  poolAgentId: string
  cadence: Cadence
  unit: string
  amount: number
  duration?: number | null
  restrictions?: PledgeRestrictions
  storyPermissions: StoryPermission
  /** Pool visibility ('public' | 'private') passed by the action layer
   *  (it has already validated against DiscoveryService.getPoolDetail).
   *  Used here only to derive the row's `visibility` cascade. Defaults to
   *  'public' when omitted. */
  poolVisibility?: 'public' | 'private'
}

const submitTool = {
  name: 'pool_pledge:submit',
  description:
    "Persist a PoolPledge row. Pool body validation (acceptedUnits, restrictions, capacityCeiling, visibility) is the action layer's responsibility — it pre-validates against DiscoveryService.getPoolDetail before calling this tool. Cascades pool:read_pledge cross-delegation (when non-anonymous).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
      cadence: { type: 'string', enum: ['one-time', 'monthly', 'annual'] },
      unit: { type: 'string' },
      amount: { type: 'number' },
      duration: { type: 'number' },
      restrictions: { type: 'object' },
      storyPermissions: { type: 'string', enum: ['public', 'shareWithSupportTeam', 'anonymous'] },
      poolVisibility: { type: 'string', enum: ['public', 'private'] },
    },
    required: ['token', 'poolAgentId', 'cadence', 'unit', 'amount', 'storyPermissions'],
  },
  handler: async (args: SubmitArgs) => {
    const principal = await requireOrgPrincipal(args.token, args, 'pool_pledge:submit')

    if (!args.poolAgentId || !args.cadence || !args.unit || typeof args.amount !== 'number' || !args.storyPermissions) {
      return err({ kind: 'validation', messages: ['missing required fields'] })
    }
    if (args.amount <= 0) {
      return err({ kind: 'validation', messages: ['amount must be > 0'] })
    }
    if ((args.cadence === 'monthly' || args.cadence === 'annual') && (!args.duration || args.duration <= 0)) {
      return err({ kind: 'validation', messages: ['recurring pledges require duration > 0'] })
    }

    const poolVisibility: 'public' | 'private' = args.poolVisibility ?? 'public'
    const visibility: Visibility = deriveVisibility(poolVisibility, args.storyPermissions)

    const id = randomUUID()
    const now = nowIso()
    const row = {
      id,
      principal,
      poolAgentId: args.poolAgentId,
      cadence: args.cadence,
      unit: args.unit,
      amount: args.amount,
      duration: args.duration ?? null,
      restrictions: args.restrictions ? JSON.stringify(args.restrictions) : null,
      storyPermissions: args.storyPermissions,
      pledgedAt: now,
      stoppedAt: null,
      status: 'active' as PledgeStatus,
      history: '[]',
      visibility,
      onChainAssertionId: null,
      createdAt: now,
      updatedAt: now,
    }
    db.insert(poolPledges).values(row).run()

    if (args.storyPermissions !== 'anonymous') {
      try {
        issueReadPledgeGrant({ donorPrincipal: principal, poolAgentId: args.poolAgentId, pledgeId: id })
      } catch (e) {
        console.warn(
          `[org-mcp/poolPledges] read_pledge grant failed: ${e instanceof Error ? e.message : e}`,
        )
      }
    }

    return mcpText({ ok: true as const, pledge: row, status: row.status })
  },
}

interface AmendArgs {
  token: string
  pledgeId: string
  change:
    | { kind: 'amount'; newValue: number }
    | { kind: 'cadence'; newValue: Cadence }
    | { kind: 'duration'; newValue: number }
}

const amendTool = {
  name: 'pool_pledge:amend',
  description:
    "Amend a recurring PoolPledge (amount/cadence/duration). Appends to history; window-reset semantics per spec.md Q4. Pool counters are derived — no separate counter write.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      pledgeId: { type: 'string' },
      change: { type: 'object' },
    },
    required: ['token', 'pledgeId', 'change'],
  },
  handler: async (args: AmendArgs) => {
    const principal = await requireOrgPrincipal(args.token, args, 'pool_pledge:amend')
    const existing = db.select().from(poolPledges)
      .where(and(
        eq(poolPledges.id, args.pledgeId),
        eq(poolPledges.principal, principal),
      ))
      .all()[0]
    if (!existing) {
      throw new Error(`pledge ${args.pledgeId} not found for principal`)
    }
    if (existing.status !== 'active' && existing.status !== 'waitlisted') {
      throw new Error(`pledge ${args.pledgeId} is not amendable (status=${existing.status})`)
    }

    const now = nowIso()
    const history = safeJson<PledgeAmendment[]>(existing.history, [])

    let nextAmount = existing.amount
    let nextCadence = existing.cadence as Cadence
    let nextDuration = existing.duration

    const amendment: PledgeAmendment = {
      kind: args.change.kind,
      prevValue: 0,
      newValue: 0,
      amendedAt: now,
    }

    if (args.change.kind === 'amount') {
      amendment.prevValue = existing.amount
      amendment.newValue = args.change.newValue
      nextAmount = args.change.newValue
    } else if (args.change.kind === 'cadence') {
      amendment.prevValue = existing.cadence as Cadence
      amendment.newValue = args.change.newValue
      amendment.windowResetAt = now
      nextCadence = args.change.newValue
    } else if (args.change.kind === 'duration') {
      amendment.prevValue = existing.duration ?? 0
      amendment.newValue = args.change.newValue
      amendment.windowResetAt = now
      nextDuration = args.change.newValue
    }
    history.push(amendment)

    db.update(poolPledges)
      .set({
        amount: nextAmount,
        cadence: nextCadence,
        duration: nextDuration,
        history: JSON.stringify(history),
        updatedAt: now,
      })
      .where(eq(poolPledges.id, args.pledgeId))
      .run()

    const updated = db.select().from(poolPledges).where(eq(poolPledges.id, args.pledgeId)).all()[0]
    return mcpText({ ok: true as const, pledge: updated })
  },
}

const stopTool = {
  name: 'pool_pledge:stop',
  description:
    "Stop a PoolPledge (sets stoppedAt, status='stopped'). Bright line for downstream allocation/disbursement decisions per spec.md Q5.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      pledgeId: { type: 'string' },
    },
    required: ['token', 'pledgeId'],
  },
  handler: async (args: { token: string; pledgeId: string }) => {
    const principal = await requireOrgPrincipal(args.token, args, 'pool_pledge:stop')
    const existing = db.select().from(poolPledges)
      .where(and(
        eq(poolPledges.id, args.pledgeId),
        eq(poolPledges.principal, principal),
      ))
      .all()[0]
    if (!existing) {
      throw new Error(`pledge ${args.pledgeId} not found for principal`)
    }
    if (existing.status === 'stopped' || existing.status === 'auto-stopped' || existing.status === 'fulfilled') {
      throw new Error(`pledge ${args.pledgeId} is already terminal (status=${existing.status})`)
    }
    const now = nowIso()
    db.update(poolPledges)
      .set({ status: 'stopped', stoppedAt: now, updatedAt: now })
      .where(eq(poolPledges.id, args.pledgeId))
      .run()
    const updated = db.select().from(poolPledges).where(eq(poolPledges.id, args.pledgeId)).all()[0]
    return mcpText({ ok: true as const, pledge: updated })
  },
}

const autoStopTool = {
  name: 'pool_pledge:auto_stop',
  description:
    "System-delegation: mark pledges on a (now closed/withdrawn) pool as auto-stopped. Issued by the pool steward's MCP.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      pledgeId: { type: 'string' },
    },
    required: ['token', 'pledgeId'],
  },
  handler: async (args: { token: string; pledgeId: string }) => {
    await requireOrgPrincipal(args.token, args, 'pool_pledge:auto_stop')
    const existing = db.select().from(poolPledges).where(eq(poolPledges.id, args.pledgeId)).all()[0]
    if (!existing) {
      throw new Error(`pledge ${args.pledgeId} not found`)
    }
    if (existing.status !== 'active' && existing.status !== 'waitlisted') {
      return mcpText({ ok: true as const, pledge: existing, noOp: true })
    }
    const now = nowIso()
    db.update(poolPledges)
      .set({ status: 'auto-stopped', stoppedAt: now, updatedAt: now })
      .where(eq(poolPledges.id, args.pledgeId))
      .run()
    const updated = db.select().from(poolPledges).where(eq(poolPledges.id, args.pledgeId)).all()[0]
    return mcpText({ ok: true as const, pledge: updated })
  },
}

const readSelfTool = {
  name: 'pool_pledge:read_self',
  description: "List all PoolPledges owned by the authenticated principal.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      status: { type: 'string' },
      poolAgentId: { type: 'string' },
    },
    required: ['token'],
  },
  handler: async (args: { token: string; status?: string; poolAgentId?: string }) => {
    const principal = await requireOrgPrincipal(args.token, args, 'pool_pledge:read_self')
    let rows = db.select().from(poolPledges)
      .where(eq(poolPledges.principal, principal))
      .all()
    if (args.status) rows = rows.filter(r => r.status === args.status)
    if (args.poolAgentId) rows = rows.filter(r => r.poolAgentId === args.poolAgentId)
    return mcpText({ pledges: rows })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool_pledge:read_pool_counters
// ───────────────────────────────────────────────────────────────────────
//
// Returns the derived pledged/allocated/available totals for a pool, summed
// from `pool_pledges` rows. Replaces the dropped `pool:read_counters` tool.
// `allocatedTotal` is always 0 in v1 (no pledge-side allocation tracking).
const readPoolCountersTool = {
  name: 'pool_pledge:read_pool_counters',
  description:
    "Read the derived pledged/allocated/available totals for a pool. Computed at read time as SUM(cadence-aware amount) over pool_pledges WHERE pool_agent_id = ? AND status = 'active'.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
    },
    required: ['token', 'poolAgentId'],
  },
  handler: async (args: { token: string; poolAgentId: string }) => {
    await requireOrgPrincipal(args.token, args, 'pool_pledge:read_pool_counters')
    const counters = getPoolCounters(args.poolAgentId)
    return mcpText({ poolAgentId: args.poolAgentId, ...counters })
  },
}

// `sql` is imported above for future raw-aggregate use; reference here so
// strict TS doesn't flag the import as unused while we keep it documented.
void sql

// ───────────────────────────────────────────────────────────────────────
// Tool: pool_pledge:list_for_pool
// ───────────────────────────────────────────────────────────────────────
//
// Public-ish read: returns the visible pledges for a pool so the pool
// detail page can render "Recent pledges". Individual pledger identity
// is gated by each pledge's `story_permissions` — pledges that opted to
// anonymize the donor name expose only the principal-hash prefix instead
// of the raw principal. Amount is always exposed (matches the aggregate
// totals shown elsewhere on the same page).
//
// Auth: any authenticated org-principal. Use the result only to render
// the pool's public surface; don't fan out per-pledge actions from this
// list — for those, the pledger themselves uses `pool_pledge:read_self`.
const listForPoolTool = {
  name: 'pool_pledge:list_for_pool',
  description:
    "Return pledges for a pool with story_permissions applied. Used by the pool detail page to render the Recent pledges section.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['token', 'poolAgentId'],
  },
  handler: async (args: { token: string; poolAgentId: string; limit?: number }) => {
    await requireOrgPrincipal(args.token, args, 'pool_pledge:list_for_pool')
    // Match either form the row may have been stored as: URN
    // (urn:smart-agent:pool:<slug>) or treasury hex address. Some legacy
    // rows used one, others the other; both refer to the same pool.
    const candidates = [args.poolAgentId, args.poolAgentId.toLowerCase()]
    const rows = db.select().from(poolPledges)
      .where(inArray(poolPledges.poolAgentId, Array.from(new Set(candidates))))
      .all()
    const visible = rows
      .filter(r => r.status === 'active')
      .sort((a, b) => (b.pledgedAt ?? '').localeCompare(a.pledgedAt ?? ''))
      .slice(0, args.limit && args.limit > 0 ? args.limit : 20)
      .map(r => {
        // Honor story_permissions when stored as JSON.
        let showName = true
        try {
          const sp = JSON.parse(r.storyPermissions ?? '{}') as { showName?: boolean }
          if (sp.showName === false) showName = false
        } catch { /* malformed; default to safe */ showName = false }
        const principalDisplay = showName
          ? r.principal
          : `anon:${r.principal.slice(0, 8)}…`
        return {
          id: r.id,
          poolAgentId: r.poolAgentId,
          principalDisplay,
          amount: r.amount,
          // Convert unit concept hash (keccak256(label)) back to the
          // human label. Legacy rows stored the hash from the pool's
          // acceptedUnits list; new ones may store the label directly.
          unit: unitHashToLabel(r.unit),
          cadence: r.cadence,
          pledgedAt: r.pledgedAt,
          status: r.status,
        }
      })
    return mcpText({ pledges: visible })
  },
}

// Reverse-map of common unit concept hashes → labels. Keep in sync with
// the same set in `apps/web/src/lib/ontology/graphdb-sync.ts` CONCEPT_LABEL.
const UNIT_LABELS: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const u of ['USD', 'EUR', 'prayer-minutes', 'loaves', 'hours', 'minutes', 'meals', 'coaching-hours']) {
    m[keccak256(toHex(u)).toLowerCase()] = u
  }
  return m
})()
function unitHashToLabel(unit: string): string {
  if (!unit) return unit
  const lc = unit.toLowerCase()
  return UNIT_LABELS[lc] ?? unit
}

export const poolPledgesTools = {
  'pool_pledge:submit': submitTool,
  'pool_pledge:list_for_pool': listForPoolTool,
  'pool_pledge:amend': amendTool,
  'pool_pledge:stop': stopTool,
  'pool_pledge:auto_stop': autoStopTool,
  'pool_pledge:read_self': readSelfTool,
  'pool_pledge:read_pool_counters': readPoolCountersTool,
}
