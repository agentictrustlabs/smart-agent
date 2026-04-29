'use server'

/**
 * Entitlement & Fulfillment server actions.
 *
 *   mintEntitlement              — called by acceptMatch; one shot per accepted match
 *   listEntitlements             — query by holder/provider/status/hub
 *   listMyEntitlements           — convenience: where I'm holder OR provider
 *   getEntitlement               — single + work items + recent activities
 *   listMyFulfillmentWorkItems   — work items where I'm the assignee
 *   markEntitlementFulfilled     — manual close-out (or called from cascade)
 *   pauseEntitlement / resumeEntitlement / revokeEntitlement
 *   consumeEntitlementCapacity   — internal helper, called by logActivity
 *   resolveWorkItem              — internal helper; closes a work item
 *
 * The `intent → match → entitlement → activity → outcome` chain
 * cascades automatically: when an entitlement reaches `fulfilled`,
 * the source match flips to `fulfilled`. When ALL the holder
 * intent's accepted entitlements are fulfilled (per the design call —
 * close on ALL, not any), the holder intent flips to `fulfilled`.
 */

import { randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { and, eq, desc, inArray, or } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { capacityDefaultFor } from '@/lib/discover/capacity-defaults'

export type EntitlementStatus = 'granted' | 'active' | 'paused' | 'suspended' | 'fulfilled' | 'revoked' | 'expired'
export type WorkItemStatus = 'open' | 'in-progress' | 'done' | 'skipped'
export type WorkItemCadence = 'one-shot' | 'recurring'

export interface EntitlementTerms {
  object: string
  topic?: string
  role?: string
  skill?: string
  geo?: string
  scope?: string
  conditions?: string[]
}

export interface EntitlementRow {
  id: string
  sourceMatchId: string
  holderIntentId: string
  providerIntentId: string
  holderAgent: string
  providerAgent: string
  hubId: string
  terms: EntitlementTerms
  capacityUnit: string
  capacityGranted: number
  capacityRemaining: number
  cadence: 'one-shot' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'on-demand'
  linkedOutcomeId: string | null
  status: EntitlementStatus
  validFrom: string
  validUntil: string | null
  createdAt: string
  updatedAt: string
}

export interface FulfillmentWorkItemRow {
  id: string
  entitlementId: string
  assigneeAgent: string
  taskKind: string
  title: string
  detail: string | null
  cadence: WorkItemCadence
  dueAt: string | null
  resolvedByActivityId: string | null
  status: WorkItemStatus
  createdAt: string
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}

function rowToEnt(r: typeof schema.entitlements.$inferSelect): EntitlementRow {
  return {
    id: r.id,
    sourceMatchId: r.sourceMatchId,
    holderIntentId: r.holderIntentId,
    providerIntentId: r.providerIntentId,
    holderAgent: r.holderAgent,
    providerAgent: r.providerAgent,
    hubId: r.hubId,
    terms: safeParse<EntitlementTerms>(r.terms) ?? { object: '' },
    capacityUnit: r.capacityUnit,
    capacityGranted: r.capacityGranted,
    capacityRemaining: r.capacityRemaining,
    cadence: r.cadence,
    linkedOutcomeId: r.linkedOutcomeId,
    status: r.status,
    validFrom: r.validFrom,
    validUntil: r.validUntil,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function rowToWorkItem(r: typeof schema.fulfillmentWorkItems.$inferSelect): FulfillmentWorkItemRow {
  return {
    id: r.id,
    entitlementId: r.entitlementId,
    assigneeAgent: r.assigneeAgent,
    taskKind: r.taskKind,
    title: r.title,
    detail: r.detail,
    cadence: r.cadence,
    dueAt: r.dueAt,
    resolvedByActivityId: r.resolvedByActivityId,
    status: r.status,
    createdAt: r.createdAt,
  }
}

// ─── Mint ────────────────────────────────────────────────────────────

export interface MintEntitlementInput {
  sourceMatchId: string
  holderIntentId: string
  providerIntentId: string
  holderAgent: string
  providerAgent: string
  hubId: string
  resourceType: string
  /** Optional override of defaults from capacity-defaults table. */
  capacityOverride?: { unit?: string; granted?: number }
  /** JSON terms — typically derived from match.satisfies + offering.payload. */
  terms: EntitlementTerms
  /** Optional outcome row to link. */
  linkedOutcomeId?: string
  /** Optional cadence override; otherwise from capacity-defaults. */
  cadenceOverride?: 'one-shot' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'on-demand'
  /** Optional explicit validity end. Default = validFrom + capacity-defaults.defaultValidityDays. */
  validUntil?: string
}

/**
 * Idempotent: an entitlement already minted for `sourceMatchId` is
 * returned as-is rather than duplicated.
 */
export async function mintEntitlement(input: MintEntitlementInput): Promise<{ id: string; created: boolean } | { error: string }> {
  const existing = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.sourceMatchId, input.sourceMatchId))
    .get()
  if (existing) return { id: existing.id, created: false }

  const defaults = capacityDefaultFor(input.resourceType)
  const unit = input.capacityOverride?.unit ?? defaults.unit
  const granted = input.capacityOverride?.granted ?? defaults.defaultGranted
  const cadence = input.cadenceOverride ?? defaults.cadence
  const now = new Date().toISOString()
  const validUntil = input.validUntil
    ?? new Date(Date.now() + defaults.defaultValidityDays * 86_400_000).toISOString()

  const id = randomUUID()
  try {
    db.insert(schema.entitlements).values({
      id,
      sourceMatchId: input.sourceMatchId,
      holderIntentId: input.holderIntentId,
      providerIntentId: input.providerIntentId,
      holderAgent: input.holderAgent.toLowerCase(),
      providerAgent: input.providerAgent.toLowerCase(),
      hubId: input.hubId,
      terms: JSON.stringify(input.terms),
      capacityUnit: unit,
      capacityGranted: granted,
      capacityRemaining: granted,
      cadence,
      linkedOutcomeId: input.linkedOutcomeId ?? null,
      status: 'granted',
      validFrom: now,
      validUntil,
      createdAt: now,
      updatedAt: now,
    }).run()
    return { id, created: true }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

// ─── Initial work-item generation ───────────────────────────────────

/**
 * Auto-generates the *first* shared FulfillmentWorkItem for an entitlement.
 * Either party can resolve it; we pick the *primary actor* by direction:
 * the provider gets the first action (schedule / disburse / send) because
 * they're the value-source. The holder's confirmation comes via subsequent
 * activities or recurring check-ins.
 *
 * Cadence-driven: one-shot resources get a single "wrap up" item; recurring
 * resources get an "ongoing" item that respawns when resolved.
 */
export async function seedInitialWorkItem(entitlementId: string): Promise<{ id: string } | { error: string }> {
  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, entitlementId)).get()
  if (!ent) return { error: 'entitlement-not-found' }

  // Idempotent: don't seed if any work item already exists.
  const existing = db.select().from(schema.fulfillmentWorkItems)
    .where(eq(schema.fulfillmentWorkItems.entitlementId, entitlementId)).get()
  if (existing) return { id: existing.id }

  const terms = safeParse<EntitlementTerms>(ent.terms) ?? { object: '' }
  const objectLeaf = terms.object.split(':').pop() ?? terms.object

  // Pick a sensible first task based on cadence + capacity-unit.
  let taskKind = 'taskKind:ScheduleSession'
  let title = `First step on this engagement`
  let detail = `Reach out to start the ${objectLeaf} engagement.`
  const isRecurring = ent.cadence !== 'one-shot' && ent.cadence !== 'on-demand'
  const isFunding = ent.capacityUnit === 'capacityUnit:Dollars'
  const isInfo = ent.capacityUnit === 'capacityUnit:YesNo'

  if (isFunding) {
    taskKind = 'taskKind:ProvideUpdate'
    title = 'Send disbursement plan'
    detail = `Deliver the disbursement plan and tranche schedule to the holder. ${terms.topic ? `Project: ${terms.topic}.` : ''}`
  } else if (isInfo) {
    taskKind = 'taskKind:ProvideUpdate'
    title = 'Share the requested information'
    detail = `Send the requested information directly to the holder. One-shot — closes when delivered.`
  } else if (ent.capacityUnit === 'capacityUnit:Introductions') {
    taskKind = 'taskKind:ProvideUpdate'
    title = 'Make first introduction'
    detail = `Connect the holder to a relevant counterparty. ${terms.topic ?? ''}`
  } else if (isRecurring) {
    taskKind = 'taskKind:ScheduleSession'
    title = 'Schedule the first session'
    detail = `Pick a time for the first ${ent.cadence} session. ${terms.topic ? `Topic: ${terms.topic}.` : ''}`
  }

  const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
  const id = randomUUID()
  db.insert(schema.fulfillmentWorkItems).values({
    id,
    entitlementId,
    assigneeAgent: ent.providerAgent,   // primary actor; either party may resolve
    taskKind,
    title,
    detail,
    cadence: isRecurring ? 'recurring' : 'one-shot',
    dueAt,
    resolvedByActivityId: null,
    status: 'open',
    createdAt: new Date().toISOString(),
  }).run()
  return { id }
}

// ─── Status transitions ─────────────────────────────────────────────

export async function pauseEntitlement(id: string): Promise<{ ok: true } | { error: string }> {
  return setEntStatus(id, 'paused', ['granted', 'active'])
}

export async function resumeEntitlement(id: string): Promise<{ ok: true } | { error: string }> {
  return setEntStatus(id, 'active', ['paused', 'suspended'])
}

export async function revokeEntitlement(id: string): Promise<{ ok: true } | { error: string }> {
  return setEntStatus(id, 'revoked', ['granted', 'active', 'paused', 'suspended'])
}

export async function markEntitlementFulfilled(id: string): Promise<{ ok: true } | { error: string }> {
  const r = await setEntStatus(id, 'fulfilled', ['granted', 'active'])
  if ('error' in r) return r
  await cascadeFulfillment(id)
  return { ok: true }
}

async function setEntStatus(id: string, next: EntitlementStatus, allowedFrom: EntitlementStatus[]): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const row = db.select().from(schema.entitlements).where(eq(schema.entitlements.id, id)).get()
  if (!row) return { error: 'entitlement-not-found' }
  if (!allowedFrom.includes(row.status)) return { error: `cannot-transition-from-${row.status}` }
  db.update(schema.entitlements)
    .set({ status: next, updatedAt: new Date().toISOString() })
    .where(eq(schema.entitlements.id, id))
    .run()
  return { ok: true }
}

// ─── Capacity consumption + work-item resolution + cascade ──────────

/**
 * Internal helper invoked by `logActivity` when an activity carries
 * `fulfillsEntitlementId`. Steps:
 *   1. Decrement capacity (clamped to zero)
 *   2. Auto-flip status: granted → active on first activity
 *   3. Resolve the oldest open work item on this entitlement (whichever
 *      cadence) by setting its `resolvedByActivityId`
 *   4. If recurring + the resolved item was recurring, spawn the next
 *      instance with `dueAt = now + cadence-interval`
 *   5. If capacity reached zero, treat as outcome-achieved → mark
 *      entitlement fulfilled → cascade up
 */
export async function consumeEntitlementCapacity(args: {
  entitlementId: string
  activityId: string
  /** Optional: how much capacity this activity consumes. Default 1. */
  amount?: number
  /** Optional: explicit "this achieves the outcome" flag. */
  achievesOutcome?: boolean
}): Promise<{ ok: true; cascade: 'none' | 'fulfilled' } | { error: string }> {
  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, args.entitlementId)).get()
  if (!ent) return { error: 'entitlement-not-found' }
  if (ent.status === 'fulfilled' || ent.status === 'revoked' || ent.status === 'expired') {
    return { ok: true, cascade: 'none' }
  }

  const consumed = Math.max(1, args.amount ?? 1)
  const remaining = Math.max(0, ent.capacityRemaining - consumed)
  const now = new Date().toISOString()

  // 1+2. Decrement + transition.
  const newStatus: EntitlementStatus =
    args.achievesOutcome === true || remaining === 0 ? 'fulfilled'
    : ent.status === 'granted' ? 'active'
    : ent.status
  db.update(schema.entitlements)
    .set({ capacityRemaining: remaining, status: newStatus, updatedAt: now })
    .where(eq(schema.entitlements.id, args.entitlementId))
    .run()

  // 3. Resolve oldest open work item.
  const openItem = db.select().from(schema.fulfillmentWorkItems)
    .where(and(
      eq(schema.fulfillmentWorkItems.entitlementId, args.entitlementId),
      eq(schema.fulfillmentWorkItems.status, 'open'),
    ))
    .orderBy(schema.fulfillmentWorkItems.createdAt)
    .get()
  if (openItem) {
    db.update(schema.fulfillmentWorkItems)
      .set({ status: 'done', resolvedByActivityId: args.activityId })
      .where(eq(schema.fulfillmentWorkItems.id, openItem.id))
      .run()

    // 4. Recurring → spawn next instance.
    if (openItem.cadence === 'recurring' && newStatus !== 'fulfilled') {
      const cadenceMs: Record<string, number> = {
        weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, 'on-demand': 30, 'one-shot': 0,
      }
      const days = cadenceMs[ent.cadence] ?? 14
      db.insert(schema.fulfillmentWorkItems).values({
        id: randomUUID(),
        entitlementId: args.entitlementId,
        assigneeAgent: openItem.assigneeAgent,
        taskKind: openItem.taskKind,
        title: openItem.title,
        detail: openItem.detail,
        cadence: 'recurring',
        dueAt: new Date(Date.now() + days * 86_400_000).toISOString(),
        resolvedByActivityId: null,
        status: 'open',
        createdAt: now,
      }).run()
    }
  }

  // 5. Cascade.
  if (newStatus === 'fulfilled') {
    await cascadeFulfillment(args.entitlementId)
    return { ok: true, cascade: 'fulfilled' }
  }
  return { ok: true, cascade: 'none' }
}

/**
 * Cascade fulfillment up the chain.
 *   • Match: if the entitlement's source match isn't fulfilled, mark it.
 *   • Holder Intent: only flips to `fulfilled` when ALL accepted
 *     entitlements for that intent are fulfilled (design call: close
 *     on ALL, not any).
 *   • Linked Outcome: status flips to `achieved`.
 */
async function cascadeFulfillment(entitlementId: string): Promise<void> {
  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, entitlementId)).get()
  if (!ent) return
  const now = new Date().toISOString()

  // Outcome.
  if (ent.linkedOutcomeId) {
    db.update(schema.outcomes)
      .set({ status: 'achieved', observedAt: now, observedBy: ent.holderAgent })
      .where(eq(schema.outcomes.id, ent.linkedOutcomeId))
      .run()
  }

  // Source match.
  db.update(schema.needResourceMatches)
    .set({ status: 'fulfilled', updatedAt: now })
    .where(eq(schema.needResourceMatches.id, ent.sourceMatchId))
    .run()

  // Holder intent — close on ALL accepted entitlements.
  const allEnts = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.holderIntentId, ent.holderIntentId))
    .all()
  const everyFulfilled = allEnts.length > 0 && allEnts.every(e => e.status === 'fulfilled')
  if (everyFulfilled) {
    db.update(schema.intents)
      .set({ status: 'fulfilled', updatedAt: now })
      .where(eq(schema.intents.id, ent.holderIntentId))
      .run()
    // Also close the legacy `needs` projection if present.
    const intent = db.select().from(schema.intents)
      .where(eq(schema.intents.id, ent.holderIntentId)).get()
    if (intent?.projectionRef) {
      db.update(schema.needs)
        .set({ status: 'met', updatedAt: now })
        .where(eq(schema.needs.id, intent.projectionRef))
        .run()
    }
  }
}

// ─── Reads ──────────────────────────────────────────────────────────

export interface ListEntitlementsOptions {
  hubId?: string
  holderAgent?: string
  providerAgent?: string
  status?: EntitlementStatus
  limit?: number
}

export async function listEntitlements(opts: ListEntitlementsOptions = {}): Promise<EntitlementRow[]> {
  const filters = []
  if (opts.hubId) filters.push(eq(schema.entitlements.hubId, opts.hubId))
  if (opts.holderAgent) filters.push(eq(schema.entitlements.holderAgent, opts.holderAgent.toLowerCase()))
  if (opts.providerAgent) filters.push(eq(schema.entitlements.providerAgent, opts.providerAgent.toLowerCase()))
  if (opts.status) filters.push(eq(schema.entitlements.status, opts.status))
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters)
  const rows = where
    ? await db.select().from(schema.entitlements).where(where).orderBy(desc(schema.entitlements.updatedAt)).limit(opts.limit ?? 50)
    : await db.select().from(schema.entitlements).orderBy(desc(schema.entitlements.updatedAt)).limit(opts.limit ?? 50)
  return rows.map(rowToEnt)
}

/** Entitlements where the user is holder OR provider — the "Active fulfillments" surface. */
export async function listMyEntitlements(opts: { hubId?: string; status?: EntitlementStatus | EntitlementStatus[]; limit?: number } = {}): Promise<EntitlementRow[]> {
  const me = await getCurrentUser()
  if (!me) return []
  const { getPersonAgentForUser } = await import('@/lib/agent-registry')
  const myAgent = await getPersonAgentForUser(me.id) as `0x${string}` | null
  if (!myAgent) return []
  const lower = myAgent.toLowerCase()

  const statusFilter = Array.isArray(opts.status) ? opts.status : opts.status ? [opts.status] : undefined
  const eitherSide = or(
    eq(schema.entitlements.holderAgent, lower),
    eq(schema.entitlements.providerAgent, lower),
  )
  const filters = [eitherSide]
  if (opts.hubId) filters.push(eq(schema.entitlements.hubId, opts.hubId))
  if (statusFilter && statusFilter.length === 1) {
    filters.push(eq(schema.entitlements.status, statusFilter[0]))
  } else if (statusFilter && statusFilter.length > 1) {
    filters.push(inArray(schema.entitlements.status, statusFilter))
  }
  const where = filters.length === 1 ? filters[0] : and(...filters)
  const rows = await db.select().from(schema.entitlements)
    .where(where)
    .orderBy(desc(schema.entitlements.updatedAt))
    .limit(opts.limit ?? 25)
  return rows.map(rowToEnt)
}

export interface EntitlementDetail extends EntitlementRow {
  workItems: FulfillmentWorkItemRow[]
  recentActivities: Array<{
    id: string
    title: string
    activityType: string
    activityDate: string
    userId: string
  }>
}

export async function getEntitlement(id: string): Promise<EntitlementDetail | null> {
  const row = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, id)).get()
  if (!row) return null
  const ent = rowToEnt(row)
  const workItems = db.select().from(schema.fulfillmentWorkItems)
    .where(eq(schema.fulfillmentWorkItems.entitlementId, id))
    .orderBy(schema.fulfillmentWorkItems.createdAt)
    .all()
    .map(rowToWorkItem)
  const recent = db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.fulfillsEntitlementId, id))
    .orderBy(desc(schema.activityLogs.activityDate))
    .limit(20)
    .all()
    .map(a => ({
      id: a.id,
      title: a.title,
      activityType: a.activityType,
      activityDate: a.activityDate,
      userId: a.userId,
    }))
  return { ...ent, workItems, recentActivities: recent }
}

export async function listMyFulfillmentWorkItems(): Promise<FulfillmentWorkItemRow[]> {
  const me = await getCurrentUser()
  if (!me) return []
  const { getPersonAgentForUser } = await import('@/lib/agent-registry')
  const myAgent = await getPersonAgentForUser(me.id) as `0x${string}` | null
  if (!myAgent) return []
  const rows = await db.select().from(schema.fulfillmentWorkItems)
    .where(and(
      eq(schema.fulfillmentWorkItems.assigneeAgent, myAgent.toLowerCase()),
      inArray(schema.fulfillmentWorkItems.status, ['open', 'in-progress']),
    ))
    .orderBy(schema.fulfillmentWorkItems.dueAt)
    .limit(20)
  return rows.map(rowToWorkItem)
}
