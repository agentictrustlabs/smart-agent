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
  | { kind: 'validation'; messages: string[] }

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

/**
 * POST-PHASE-7: pool body lives ON-CHAIN in PoolRegistry. The pools table
 * has been DROPPED from org-mcp; counters (pledgedTotal / allocatedTotal /
 * availableTotal) are DERIVED from `pool_pledges` row sums at read time.
 *
 * Pool body validation (acceptedUnits, restrictions, visibility,
 * capacityCeiling) is the action layer's responsibility — it pre-validates
 * against `DiscoveryService.getPoolDetail` BEFORE invoking
 * `pool_pledge:submit`. The MCP layer no longer body-validates and no
 * longer writes counter rows.
 */

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

    // Cross-delegation grant (only when non-anonymous).
    if (args.storyPermissions !== 'anonymous') {
      try {
        issueReadPledgeGrant({ donorPrincipal: principal, poolAgentId: args.poolAgentId, pledgeId: id })
      } catch (e) {
        console.warn(
          `[person-mcp/poolPledges] read_pledge grant failed: ${e instanceof Error ? e.message : e}`,
        )
      }
    }

    return mcpText({ ok: true as const, pledge: row, status: row.status })
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

    // Counters are derived at read time — no separate counter write.
    void nextCadence; void nextAmount; void nextDuration

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
