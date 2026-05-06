/**
 * Spec 002 — Intent Marketplace (Pool Lane). PoolPledge MCP tools.
 *
 * person-mcp side: solo human donors. The org-mcp twin in
 * `apps/org-mcp/src/tools/poolPledges.ts` mirrors this for org donors.
 *
 * Tools registered (each tool name === scope name; the MCP_TOOL_SCOPE
 * caveat enforcer gates on the tool name verbatim):
 *
 *   - pool_pledge:submit       — validate against the target pool, persist
 *                                 the row, fire the `pool:contribute_to_total`
 *                                 system-delegation, and (when public-tier
 *                                 + non-anonymous) emit `sa:PledgeAssertion`.
 *   - pool_pledge:amend        — append to history; mutate top-level fields;
 *                                 re-issue contribute_to_total for the delta.
 *   - pool_pledge:stop         — set stoppedAt/status='stopped'.
 *   - pool_pledge:auto_stop    — system-delegation accepted from pool steward
 *                                 to mark a pledge as auto-stopped.
 *   - pool_pledge:read_self    — list caller's own pledges.
 *
 * Persistence: `pool_pledges` table per IA § 2.2. Visibility cascades from
 * pool visibility + donor's storyPermissions.
 *
 * v1 SIMPLIFICATION: cross-MCP federation is deferred — pool body reads run
 * via a same-DB shortcut against the LOCAL pool_pledges table. When the
 * target pool lives in a different MCP, validation is best-effort and a
 * warning is logged. // TODO(cross-mcp).
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { db } from '../db/index.js'
import { poolPledges, crossDelegationGrants } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

// ───────────────────────────────────────────────────────────────────────
// Types — mirror packages/sdk/src/poolPledges/types.ts (mirrors
// specs/002-intent-marketplace-pool/contracts/pool-pledge.ts).
// ───────────────────────────────────────────────────────────────────────

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

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

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

/** Cadence-aware total — used to derive the contribute_to_total delta. */
function cadenceAwareTotal(p: { cadence: Cadence; amount: number; duration?: number | null }): number {
  if (p.cadence === 'one-time') return p.amount
  const dur = p.duration ?? 1
  return p.amount * Math.max(1, dur)
}

/**
 * Same-DB shortcut: read a pool body from the org-mcp's `pools` table.
 *
 * v1 SIMPLIFICATION (// TODO(cross-mcp)): person-mcp doesn't natively know
 * about org-mcp's database. We resolve it via a sibling-path lookup. When
 * the target pool isn't in the local org-mcp DB, validation degrades to
 * best-effort with a console warning.
 */
let cachedOrgDb: Database.Database | null = null
function getOrgMcpDb(): Database.Database | null {
  if (cachedOrgDb) return cachedOrgDb
  // Try common locations relative to person-mcp's cwd. Reads-only.
  const cwd = process.cwd()
  const candidates = [
    path.resolve(cwd, '../org-mcp/org-mcp.db'),               // when cwd = apps/person-mcp
    path.resolve(cwd, 'apps/org-mcp/org-mcp.db'),             // when cwd = repo root
    path.resolve(cwd, '../../apps/org-mcp/org-mcp.db'),       // pathological
  ]
  const dbPath = candidates.find(p => fs.existsSync(p))
  if (!dbPath) return null
  try {
    cachedOrgDb = new Database(dbPath, { readonly: false })
    return cachedOrgDb
  } catch {
    return null
  }
}

function readPool(poolId: string): PoolBody | null {
  const orgDb = getOrgMcpDb()
  if (!orgDb) {
    console.warn(
      `[person-mcp/poolPledges] org-mcp DB not found — pool ${poolId} validation skipped. // TODO(cross-mcp)`,
    )
    return null
  }
  try {
    const stmt = orgDb.prepare(`
      SELECT id, org_principal, accepted_restrictions, accepted_units,
             capacity_ceiling, ceiling_policy, visibility, addressed_members,
             pledged_total, stewards
      FROM pools WHERE id = ?
    `)
    const r = stmt.get(poolId) as Record<string, unknown> | undefined
    if (!r) return null
    return {
      id: String(r.id),
      orgPrincipal: String(r.org_principal).toLowerCase(),
      acceptedRestrictions: safeJson<PledgeRestrictions>(r.accepted_restrictions as string, {}),
      acceptedUnits: safeJson<string[]>(r.accepted_units as string, []),
      capacityCeiling: r.capacity_ceiling != null ? Number(r.capacity_ceiling) : null,
      ceilingPolicy: ((['block', 'waitlist', 'accept'] as const).find(p => p === r.ceiling_policy) ?? 'accept'),
      visibility: r.visibility === 'private' ? 'private' : 'public',
      addressedMembers: r.addressed_members ? safeJson<string[]>(r.addressed_members as string, []) : null,
      pledgedTotal: Number(r.pledged_total) || 0,
      stewards: safeJson<string[]>(r.stewards as string, []),
    }
  } catch {
    return null
  }
}

/**
 * Bump the pool's pledgedTotal aggregate (issued as the
 * `pool:contribute_to_total` system-delegation). Same-DB shortcut against
 * org-mcp; logs and degrades when target lives elsewhere.
 */
function bumpPoolTotal(poolId: string, delta: number): void {
  const orgDb = getOrgMcpDb()
  if (!orgDb) {
    console.warn(
      `[person-mcp/poolPledges] pool:contribute_to_total skipped — org-mcp DB not found. // TODO(cross-mcp)`,
    )
    return
  }
  try {
    const sel = orgDb.prepare('SELECT pledged_total, allocated_total FROM pools WHERE id = ?').get(poolId) as
      | { pledged_total: number; allocated_total: number }
      | undefined
    if (!sel) {
      console.warn(`[person-mcp/poolPledges] pool ${poolId} not found in org-mcp; total bump skipped. // TODO(cross-mcp)`)
      return
    }
    const next = Math.max(0, (sel.pledged_total ?? 0) + delta)
    const allocated = sel.allocated_total ?? 0
    const available = Math.max(0, next - allocated)
    orgDb.prepare(`
      UPDATE pools SET pledged_total = ?, available_total = ?, updated_at = ?
      WHERE id = ?
    `).run(next, available, nowIso(), poolId)
  } catch (e) {
    console.warn(
      `[person-mcp/poolPledges] pool:contribute_to_total failed: ${e instanceof Error ? e.message : e}`,
    )
  }
}

/** Derive the visibility tier from pool visibility + storyPermissions. */
function deriveVisibility(
  poolVisibility: 'public' | 'private',
  story: StoryPermission,
): Visibility {
  if (poolVisibility === 'private') return 'private'
  if (story === 'public') return 'public'
  if (story === 'shareWithSupportTeam') return 'public-coarse'
  return 'private' // anonymous
}

/**
 * Validate the donor's restrictions against the pool's accepted set.
 * `kinds`/`geoRoots` must be subsets; `notForAdmin`/`notForDiscretionary`
 * are pass-through booleans (donor may toggle them on regardless).
 */
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

/**
 * Issue a `pool:read_pledge` cross-delegation grant from the donor to the
 * pool's stewards (= pool's org_principal). Recorded in
 * `cross_delegation_grants`; the actual on-chain delegation token issuance
 * happens when the steward presents.
 */
function issueReadPledgeGrant(opts: {
  donorPrincipal: string
  poolAgentId: string
  pledgeId: string
}): void {
  const scope = `pool:read_pledge:${opts.poolAgentId}:${opts.pledgeId}`
  db.insert(crossDelegationGrants).values({
    id: randomUUID(),
    principal: opts.donorPrincipal,
    granteeAgent: opts.poolAgentId.toLowerCase(),
    scope: JSON.stringify({ scope, pledgeId: opts.pledgeId }),
    validFrom: nowIso(),
    validUntil: null,
    caveatTerms: null,
    createdAt: nowIso(),
    revokedAt: null,
  }).run()
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool_pledge:submit
// ───────────────────────────────────────────────────────────────────────

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
    const principal = await requirePrincipal(args.token, 'pool_pledge:submit')

    // Required-field presence
    if (!args.poolAgentId || !args.cadence || !args.unit || typeof args.amount !== 'number' || !args.storyPermissions) {
      return err({ kind: 'validation', messages: ['missing required fields'] })
    }
    if (args.amount <= 0) {
      return err({ kind: 'validation', messages: ['amount must be > 0'] })
    }
    if ((args.cadence === 'monthly' || args.cadence === 'annual') && (!args.duration || args.duration <= 0)) {
      return err({ kind: 'validation', messages: ['recurring pledges require duration > 0'] })
    }

    // Read pool — same-DB shortcut.
    const pool = readPool(args.poolAgentId)
    if (!pool) {
      // v1: pool not local — submit anyway with best-effort warning, since
      // cross-MCP federation is deferred.
      console.warn(
        `[person-mcp/poolPledges] pool ${args.poolAgentId} not found locally — submit-time validation skipped. // TODO(cross-mcp)`,
      )
    } else {
      // FR-008: unit must be in pool.acceptedUnits
      if (pool.acceptedUnits.length > 0 && !pool.acceptedUnits.includes(args.unit)) {
        return err({ kind: 'unit-not-accepted', allowedUnits: pool.acceptedUnits })
      }
      // FR-009: restrictions ⊆ pool.acceptedRestrictions
      if (!restrictionsAccepted(args.restrictions, pool.acceptedRestrictions)) {
        return err({ kind: 'restriction-not-accepted', allowedRestrictions: pool.acceptedRestrictions })
      }
      // FR-010: private pools — caller must be in addressedMembers.
      if (pool.visibility === 'private') {
        const addressed = (pool.addressedMembers ?? []).map(a => a.toLowerCase())
        if (!addressed.includes(principal.toLowerCase())) {
          return err({ kind: 'private-pool-not-addressed' })
        }
      }
    }

    // Compute cadence-aware total + ceiling check (FR-012).
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
        // 'accept': proceed normally
      }
    }

    // Insert row.
    const visibility: Visibility = pool
      ? deriveVisibility(pool.visibility, args.storyPermissions)
      : deriveVisibility('private', args.storyPermissions) // safer default when pool unknown
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

    // Side effect 1: pool:contribute_to_total (only when status='active'; waitlisted
    // contributions are NOT yet credited to pledgedTotal until they activate).
    if (pledgeStatus === 'active') {
      bumpPoolTotal(args.poolAgentId, total)
    }

    // Side effect 2: pool:read_pledge cross-delegation (only when non-anonymous).
    if (args.storyPermissions !== 'anonymous' && pool) {
      try {
        issueReadPledgeGrant({ donorPrincipal: principal, poolAgentId: args.poolAgentId, pledgeId: id })
      } catch (e) {
        console.warn(
          `[person-mcp/poolPledges] read_pledge grant failed: ${e instanceof Error ? e.message : e}`,
        )
      }
    }

    // Side effect 3: sa:PledgeAssertion emit is deferred to the action layer
    // (the on-chain emit lives in apps/web; this MCP returns the row and
    // the action layer fires the emit + writes back onChainAssertionId).
    // NOTE: SHACL `sa:AnonymousPledgeNoAnchorShape` and
    // `sa:PrivatePoolPledgeNoAnchorShape` enforce the privacy invariants —
    // callers MUST consult `visibility` to decide whether to anchor.

    return mcpText({ ok: true as const, pledge: row, status: pledgeStatus })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool_pledge:amend
// ───────────────────────────────────────────────────────────────────────

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
    const principal = await requirePrincipal(args.token, 'pool_pledge:amend')
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
      // Q4: amount-only preserves window — no windowResetAt.
    } else if (args.change.kind === 'cadence') {
      amendment.prevValue = existing.cadence as Cadence
      amendment.newValue = args.change.newValue
      amendment.windowResetAt = now // Q4: cadence change starts new window
      nextCadence = args.change.newValue
    } else if (args.change.kind === 'duration') {
      amendment.prevValue = existing.duration ?? 0
      amendment.newValue = args.change.newValue
      amendment.windowResetAt = now // Q4: duration change replaces window
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

    // Re-issue contribute_to_total for the signed delta. Only meaningful when
    // status is 'active' (waitlisted pledges aren't credited yet).
    if (existing.status === 'active') {
      const newTotal = cadenceAwareTotal({ cadence: nextCadence, amount: nextAmount, duration: nextDuration })
      const delta = newTotal - oldTotal
      if (delta !== 0) bumpPoolTotal(existing.poolAgentId, delta)
    }

    const updated = db.select().from(poolPledges).where(eq(poolPledges.id, args.pledgeId)).all()[0]
    return mcpText({ ok: true as const, pledge: updated })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool_pledge:stop
// ───────────────────────────────────────────────────────────────────────

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
    const principal = await requirePrincipal(args.token, 'pool_pledge:stop')
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
    // Note: Q5 — stoppedAt is the bright line; we do NOT decrement the pool's
    // pledgedTotal here. The downstream allocation/disbursement spec reads
    // stoppedAt to decide which scheduled disbursements to cancel.
    const updated = db.select().from(poolPledges).where(eq(poolPledges.id, args.pledgeId)).all()[0]
    return mcpText({ ok: true as const, pledge: updated })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool_pledge:auto_stop (system-delegation from pool steward)
// ───────────────────────────────────────────────────────────────────────

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
    // Auth: any verified caller (the steward's MCP) — the scope is gated by
    // the MCP_TOOL_SCOPE caveat enforcer on `pool_pledge:auto_stop`.
    await requirePrincipal(args.token, 'pool_pledge:auto_stop')
    const existing = db.select().from(poolPledges).where(eq(poolPledges.id, args.pledgeId)).all()[0]
    if (!existing) {
      throw new Error(`pledge ${args.pledgeId} not found`)
    }
    if (existing.status !== 'active' && existing.status !== 'waitlisted') {
      // Already terminal — no-op.
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

// ───────────────────────────────────────────────────────────────────────
// Tool: pool_pledge:read_self
// ───────────────────────────────────────────────────────────────────────

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
    const principal = await requirePrincipal(args.token, 'pool_pledge:read_self')
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
