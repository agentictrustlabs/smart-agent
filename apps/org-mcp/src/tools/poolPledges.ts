/**
 * Spec 002 — Intent Marketplace (Pool Lane). PoolPledge MCP tools.
 *
 * org-mcp side: org donors. Twins person-mcp's poolPledges.ts. See that
 * file for the full design rationale.
 *
 * Tools registered (each tool name === scope name):
 *   - pool_pledge:submit
 *   - pool_pledge:amend
 *   - pool_pledge:stop
 *   - pool_pledge:auto_stop   (system-delegation from pool steward)
 *   - pool_pledge:read_self
 *
 * Persistence: `pool_pledges` table per IA § 2.2 (org-mcp tenancy column =
 * `principal`, NOT `org_principal`, per the IA classification doc).
 *
 * v1 SIMPLIFICATION: pool body reads run against the LOCAL `pools` table
 * (same DB). Cross-MCP federation deferred. // TODO(cross-mcp).
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { poolPledges, pools, orgCrossDelegationGrants } from '../db/schema.js'
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
  | { kind: 'unit-not-accepted'; allowedUnits: string[] }
  | { kind: 'restriction-not-accepted'; allowedRestrictions: PledgeRestrictions }
  | { kind: 'ceiling-blocked'; remainingCapacity: number }
  | { kind: 'private-pool-not-addressed' }
  | { kind: 'validation'; messages: string[] }

interface PoolBody {
  id: string
  orgPrincipal: string
  acceptedRestrictions: PledgeRestrictions
  acceptedUnits: string[]
  capacityCeiling: number | null
  ceilingPolicy: 'block' | 'waitlist' | 'accept'
  visibility: 'public' | 'private'
  addressedMembers: string[] | null
  pledgedTotal: number
  stewards: string[]
}

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

function readLocalPool(poolId: string): PoolBody | null {
  const r = db.select().from(pools).where(eq(pools.id, poolId)).all()[0]
  if (!r) return null
  return {
    id: r.id,
    orgPrincipal: r.orgPrincipal.toLowerCase(),
    acceptedRestrictions: safeJson<PledgeRestrictions>(r.acceptedRestrictions, {}),
    acceptedUnits: safeJson<string[]>(r.acceptedUnits, []),
    capacityCeiling: r.capacityCeiling,
    ceilingPolicy: ((['block', 'waitlist', 'accept'] as const).find(p => p === r.ceilingPolicy) ?? 'accept'),
    visibility: r.visibility === 'private' ? 'private' : 'public',
    addressedMembers: r.addressedMembers ? safeJson<string[]>(r.addressedMembers, []) : null,
    pledgedTotal: r.pledgedTotal ?? 0,
    stewards: safeJson<string[]>(r.stewards, []),
  }
}

function bumpPoolTotal(poolId: string, delta: number): void {
  const r = db.select().from(pools).where(eq(pools.id, poolId)).all()[0]
  if (!r) {
    console.warn(`[org-mcp/poolPledges] pool ${poolId} not local; total bump skipped. // TODO(cross-mcp)`)
    return
  }
  const next = Math.max(0, (r.pledgedTotal ?? 0) + delta)
  const allocated = r.allocatedTotal ?? 0
  const available = Math.max(0, next - allocated)
  db.update(pools)
    .set({ pledgedTotal: next, availableTotal: available, updatedAt: nowIso() })
    .where(eq(pools.id, poolId))
    .run()
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

function restrictionsAccepted(
  donor: PledgeRestrictions | undefined,
  allowed: PledgeRestrictions,
): boolean {
  if (!donor) return true
  if (donor.kinds && donor.kinds.length > 0) {
    const allowedKinds = (allowed.kinds ?? []).map(k => k.toLowerCase())
    if (allowedKinds.length === 0) return false
    for (const k of donor.kinds) {
      if (!allowedKinds.includes(k.toLowerCase())) return false
    }
  }
  if (donor.geoRoots && donor.geoRoots.length > 0) {
    const allowedGeo = (allowed.geoRoots ?? []).map(g => g.toLowerCase())
    if (allowedGeo.length === 0) return false
    for (const g of donor.geoRoots) {
      if (!allowedGeo.includes(g.toLowerCase())) return false
    }
  }
  return true
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
}

const submitTool = {
  name: 'pool_pledge:submit',
  description:
    "Validate a pledge against the target pool and persist the row. Cascades pool:contribute_to_total + sa:PledgeAssertion (when public + non-anonymous) + pool:read_pledge cross-delegation (when non-anonymous).",
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

    const pool = readLocalPool(args.poolAgentId)
    if (!pool) {
      console.warn(
        `[org-mcp/poolPledges] pool ${args.poolAgentId} not local — submit-time validation skipped. // TODO(cross-mcp)`,
      )
    } else {
      if (pool.acceptedUnits.length > 0 && !pool.acceptedUnits.includes(args.unit)) {
        return err({ kind: 'unit-not-accepted', allowedUnits: pool.acceptedUnits })
      }
      if (!restrictionsAccepted(args.restrictions, pool.acceptedRestrictions)) {
        return err({ kind: 'restriction-not-accepted', allowedRestrictions: pool.acceptedRestrictions })
      }
      if (pool.visibility === 'private') {
        const addressed = (pool.addressedMembers ?? []).map(a => a.toLowerCase())
        if (!addressed.includes(principal.toLowerCase())) {
          return err({ kind: 'private-pool-not-addressed' })
        }
      }
    }

    const total = cadenceAwareTotal({ cadence: args.cadence, amount: args.amount, duration: args.duration ?? null })
    let pledgeStatus: PledgeStatus = 'active'
    if (pool && pool.capacityCeiling != null && pool.capacityCeiling > 0) {
      const remaining = Math.max(0, pool.capacityCeiling - pool.pledgedTotal)
      if (pool.pledgedTotal + total > pool.capacityCeiling) {
        if (pool.ceilingPolicy === 'block') {
          return err({ kind: 'ceiling-blocked', remainingCapacity: remaining })
        }
        if (pool.ceilingPolicy === 'waitlist') {
          pledgeStatus = 'waitlisted'
        }
      }
    }

    const visibility: Visibility = pool
      ? deriveVisibility(pool.visibility, args.storyPermissions)
      : deriveVisibility('private', args.storyPermissions)
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
      status: pledgeStatus,
      history: '[]',
      visibility,
      onChainAssertionId: null,
      createdAt: now,
      updatedAt: now,
    }
    db.insert(poolPledges).values(row).run()

    if (pledgeStatus === 'active') {
      bumpPoolTotal(args.poolAgentId, total)
    }
    if (args.storyPermissions !== 'anonymous' && pool) {
      try {
        issueReadPledgeGrant({ donorPrincipal: principal, poolAgentId: args.poolAgentId, pledgeId: id })
      } catch (e) {
        console.warn(
          `[org-mcp/poolPledges] read_pledge grant failed: ${e instanceof Error ? e.message : e}`,
        )
      }
    }

    return mcpText({ ok: true as const, pledge: row, status: pledgeStatus })
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
    "Amend a recurring PoolPledge (amount/cadence/duration). Appends to history; window-reset semantics per spec.md Q4.",
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
    const oldTotal = cadenceAwareTotal({
      cadence: existing.cadence as Cadence,
      amount: existing.amount,
      duration: existing.duration,
    })

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

    if (existing.status === 'active') {
      const newTotal = cadenceAwareTotal({ cadence: nextCadence, amount: nextAmount, duration: nextDuration })
      const delta = newTotal - oldTotal
      if (delta !== 0) bumpPoolTotal(existing.poolAgentId, delta)
    }

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

export const poolPledgesTools = {
  'pool_pledge:submit': submitTool,
  'pool_pledge:amend': amendTool,
  'pool_pledge:stop': stopTool,
  'pool_pledge:auto_stop': autoStopTool,
  'pool_pledge:read_self': readSelfTool,
}
