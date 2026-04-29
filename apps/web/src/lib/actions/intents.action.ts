'use server'

/**
 * Intent server actions — the unifying entry point above Need / Offering.
 *
 *   expressIntent    — create + project (writes intents row AND, if applicable,
 *                      a needs row or resource_offerings row keyed by direction)
 *   acknowledgeIntent — flip status expressed → acknowledged (no commitment yet)
 *   withdrawIntent   — flip to withdrawn (only allowed by expresser)
 *   listIntents      — query by hub / direction / status / addressedTo
 *   getIntent        — single + outcome + orchestration plan
 *   backfillIntentsFromLegacy — promotes existing needs / offerings into the
 *                      intents table; idempotent, safe to re-run.
 *
 * The matcher (in `discover.action.ts`) reads `direction` + `object` and never
 * branches on `intentType`. UI labels come from `intentType` + `intentTypeLabel`.
 */

import { randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { and, eq, desc, isNull } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export type IntentDirection = 'receive' | 'give'
export type IntentStatus = 'drafted' | 'expressed' | 'acknowledged' | 'in-progress' | 'fulfilled' | 'withdrawn' | 'abandoned'
export type IntentVisibility = 'public' | 'public-coarse' | 'private' | 'off-chain'

export interface IntentRequirements {
  role?: string
  skill?: string
  geo?: string
  timeWindow?: { start?: string; end?: string; recurrence?: string }
  capacity?: { unit: string; amount: number }
  credential?: string
}

export interface OutcomeMetric {
  kind: 'count' | 'boolean' | 'date' | 'narrative'
  target?: number | string | boolean
  observed?: number | string | boolean
}

export interface ExpressIntentInput {
  direction: IntentDirection
  object: string                   // 'resourceType:Money' etc.
  topic?: string
  intentType: string               // 'intentType:NeedCoaching' etc.
  intentTypeLabel: string
  expressedByAgent: string
  addressedTo: string              // 'agent:0x…' | 'hub:catalyst' | 'self'
  hubId: string
  title: string
  detail?: string
  payload?: IntentRequirements & Record<string, unknown>
  priority?: 'critical' | 'high' | 'normal' | 'low'
  visibility?: IntentVisibility
  expectedOutcome?: { description: string; metric: OutcomeMetric }
  validUntil?: string
}

export interface IntentRow {
  id: string
  direction: IntentDirection
  object: string
  topic: string | null
  intentType: string
  intentTypeLabel: string
  expressedByAgent: string
  expressedByUserId: string | null
  addressedTo: string
  hubId: string
  title: string
  detail: string | null
  payload: (IntentRequirements & Record<string, unknown>) | null
  status: IntentStatus
  priority: 'critical' | 'high' | 'normal' | 'low'
  visibility: IntentVisibility
  expectedOutcome: { description: string; metric: OutcomeMetric } | null
  projectionRef: string | null
  validUntil: string | null
  createdAt: string
  updatedAt: string
}

function safeJsonParse<T = unknown>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}

function rowToIntent(r: typeof schema.intents.$inferSelect): IntentRow {
  return {
    id: r.id,
    direction: r.direction,
    object: r.object,
    topic: r.topic,
    intentType: r.intentType,
    intentTypeLabel: r.intentTypeLabel,
    expressedByAgent: r.expressedByAgent,
    expressedByUserId: r.expressedByUserId,
    addressedTo: r.addressedTo,
    hubId: r.hubId,
    title: r.title,
    detail: r.detail,
    payload: safeJsonParse<IntentRow['payload']>(r.payload),
    status: r.status,
    priority: r.priority,
    visibility: r.visibility,
    expectedOutcome: safeJsonParse<IntentRow['expectedOutcome']>(r.expectedOutcome),
    projectionRef: r.projectionRef,
    validUntil: r.validUntil,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

// ─── Express ────────────────────────────────────────────────────────

export async function expressIntent(input: ExpressIntentInput): Promise<{ id: string; projectionRef?: string } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const id = randomUUID()
  const now = new Date().toISOString()

  // Project to legacy table when shape fits.
  let projectionRef: string | null = null
  try {
    if (input.direction === 'receive') {
      const projId = randomUUID()
      db.insert(schema.needs).values({
        id: projId,
        needType: input.intentType,
        needTypeLabel: input.intentTypeLabel,
        neededByAgent: input.expressedByAgent.toLowerCase(),
        neededByUserId: me.id,
        hubId: input.hubId,
        title: input.title,
        detail: input.detail ?? null,
        priority: input.priority ?? 'normal',
        status: 'open',
        requirements: input.payload ? JSON.stringify(input.payload) : null,
        validUntil: input.validUntil ?? null,
        createdBy: me.id,
        createdAt: now,
        updatedAt: now,
      }).run()
      projectionRef = projId
    } else if (input.direction === 'give') {
      const projId = randomUUID()
      db.insert(schema.resourceOfferings).values({
        id: projId,
        offeredByAgent: input.expressedByAgent.toLowerCase(),
        offeredByUserId: me.id,
        hubId: input.hubId,
        resourceType: input.object,
        resourceTypeLabel: input.intentTypeLabel,
        title: input.title,
        detail: input.detail ?? null,
        status: 'available',
        capacity: input.payload?.capacity ? JSON.stringify(input.payload.capacity) : null,
        geo: typeof input.payload?.geo === 'string' ? input.payload.geo : null,
        timeWindow: input.payload?.timeWindow ? JSON.stringify(input.payload.timeWindow) : null,
        capabilities: null,
        validUntil: input.validUntil ?? null,
      }).run()
      projectionRef = projId
    }
  } catch (err) {
    console.warn('[intents] projection failed (non-fatal):', (err as Error).message)
  }

  // Insert the canonical intents row.
  db.insert(schema.intents).values({
    id,
    direction: input.direction,
    object: input.object,
    topic: input.topic ?? null,
    intentType: input.intentType,
    intentTypeLabel: input.intentTypeLabel,
    expressedByAgent: input.expressedByAgent.toLowerCase(),
    expressedByUserId: me.id,
    addressedTo: input.addressedTo,
    hubId: input.hubId,
    title: input.title,
    detail: input.detail ?? null,
    payload: input.payload ? JSON.stringify(input.payload) : null,
    status: 'expressed',
    priority: input.priority ?? 'normal',
    visibility: input.visibility ?? 'public',
    expectedOutcome: input.expectedOutcome ? JSON.stringify(input.expectedOutcome) : null,
    projectionRef,
    validUntil: input.validUntil ?? null,
    createdAt: now,
    updatedAt: now,
  }).run()

  // If we have a structured outcome, mint an outcomes row too so the
  // observation pipeline (Activity.achievesOutcomeId) has a target.
  if (input.expectedOutcome) {
    db.insert(schema.outcomes).values({
      id: randomUUID(),
      intentId: id,
      description: input.expectedOutcome.description,
      metric: JSON.stringify(input.expectedOutcome.metric),
      status: 'pending',
      observedAt: null,
      observedBy: null,
      createdAt: now,
    }).run()
  }

  return { id, projectionRef: projectionRef ?? undefined }
}

// ─── Status transitions ─────────────────────────────────────────────

export async function acknowledgeIntent(intentId: string): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  db.update(schema.intents)
    .set({ status: 'acknowledged', updatedAt: new Date().toISOString() })
    .where(and(eq(schema.intents.id, intentId), eq(schema.intents.status, 'expressed')))
    .run()
  return { ok: true }
}

export async function withdrawIntent(intentId: string): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  // Withdrawer must be the expresser.
  const row = db.select().from(schema.intents).where(eq(schema.intents.id, intentId)).get()
  if (!row) return { error: 'intent-not-found' }
  if (row.expressedByUserId !== me.id) return { error: 'not-authorized' }
  db.update(schema.intents)
    .set({ status: 'withdrawn', updatedAt: new Date().toISOString() })
    .where(eq(schema.intents.id, intentId))
    .run()
  // Cascade: close the legacy projection too.
  if (row.projectionRef) {
    if (row.direction === 'receive') {
      db.update(schema.needs)
        .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
        .where(eq(schema.needs.id, row.projectionRef))
        .run()
    } else {
      db.update(schema.resourceOfferings)
        .set({ status: 'withdrawn' })
        .where(eq(schema.resourceOfferings.id, row.projectionRef))
        .run()
    }
  }
  return { ok: true }
}

// ─── Reads ──────────────────────────────────────────────────────────

export interface ListIntentsOptions {
  hubId?: string
  direction?: IntentDirection
  status?: IntentStatus
  addressedTo?: string
  expressedBy?: string
  limit?: number
}

export async function listIntents(opts: ListIntentsOptions = {}): Promise<IntentRow[]> {
  const filters = []
  if (opts.hubId) filters.push(eq(schema.intents.hubId, opts.hubId))
  if (opts.direction) filters.push(eq(schema.intents.direction, opts.direction))
  if (opts.status) filters.push(eq(schema.intents.status, opts.status))
  if (opts.addressedTo) filters.push(eq(schema.intents.addressedTo, opts.addressedTo))
  if (opts.expressedBy) filters.push(eq(schema.intents.expressedByAgent, opts.expressedBy.toLowerCase()))
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters)
  const rows = where
    ? await db.select().from(schema.intents).where(where).orderBy(desc(schema.intents.updatedAt)).limit(opts.limit ?? 100)
    : await db.select().from(schema.intents).orderBy(desc(schema.intents.updatedAt)).limit(opts.limit ?? 100)
  return rows.map(rowToIntent)
}

export interface IntentDetail extends IntentRow {
  outcome: { id: string; description: string; metric: OutcomeMetric; status: string } | null
}

export async function getIntent(id: string): Promise<IntentDetail | null> {
  const row = db.select().from(schema.intents).where(eq(schema.intents.id, id)).get()
  if (!row) return null
  const intent = rowToIntent(row)
  const outcomeRow = db.select().from(schema.outcomes).where(eq(schema.outcomes.intentId, id)).get()
  const outcome = outcomeRow
    ? {
        id: outcomeRow.id,
        description: outcomeRow.description,
        metric: safeJsonParse<OutcomeMetric>(outcomeRow.metric) ?? { kind: 'narrative' },
        status: outcomeRow.status,
      }
    : null
  return { ...intent, outcome }
}

export async function getIntentForLegacyNeed(needId: string): Promise<IntentRow | null> {
  const row = db.select().from(schema.intents)
    .where(and(eq(schema.intents.projectionRef, needId), eq(schema.intents.direction, 'receive')))
    .get()
  return row ? rowToIntent(row) : null
}

export async function getIntentForLegacyOffering(offeringId: string): Promise<IntentRow | null> {
  const row = db.select().from(schema.intents)
    .where(and(eq(schema.intents.projectionRef, offeringId), eq(schema.intents.direction, 'give')))
    .get()
  return row ? rowToIntent(row) : null
}

// ─── Backfill from legacy tables ────────────────────────────────────
//
// Promotes every existing needs / resource_offerings row into intents.
// Idempotent — keyed on `(projectionRef, direction)` uniqueness.

export async function backfillIntentsFromLegacy(): Promise<{ needsBackfilled: number; offeringsBackfilled: number }> {
  let needsBackfilled = 0
  let offeringsBackfilled = 0
  const now = new Date().toISOString()

  // Receive-shaped: every needs row.
  const allNeeds = db.select().from(schema.needs).all()
  for (const n of allNeeds) {
    const existing = db.select().from(schema.intents)
      .where(and(eq(schema.intents.projectionRef, n.id), eq(schema.intents.direction, 'receive')))
      .get()
    if (existing) continue
    // Map the need's status to an intent status.
    const intentStatus: IntentStatus = n.status === 'open' ? 'expressed'
      : n.status === 'in-progress' ? 'in-progress'
      : n.status === 'met' ? 'fulfilled'
      : n.status === 'cancelled' ? 'withdrawn'
      : n.status === 'expired' ? 'abandoned'
      : 'expressed'
    // Object inferred from the need-type → resource-type mapping table.
    const inferredObject = inferObjectFromNeedType(n.needType)
    db.insert(schema.intents).values({
      id: randomUUID(),
      direction: 'receive',
      object: inferredObject,
      topic: null,
      intentType: n.needType,
      intentTypeLabel: n.needTypeLabel,
      expressedByAgent: n.neededByAgent,
      expressedByUserId: n.neededByUserId,
      addressedTo: `hub:${n.hubId}`,
      hubId: n.hubId,
      title: n.title,
      detail: n.detail,
      payload: n.requirements,
      status: intentStatus,
      priority: n.priority,
      visibility: 'public',
      expectedOutcome: null,
      projectionRef: n.id,
      validUntil: n.validUntil,
      createdAt: n.createdAt,
      updatedAt: now,
    }).run()
    needsBackfilled++
  }

  // Give-shaped: every resource_offerings row.
  const allOfferings = db.select().from(schema.resourceOfferings).all()
  for (const o of allOfferings) {
    const existing = db.select().from(schema.intents)
      .where(and(eq(schema.intents.projectionRef, o.id), eq(schema.intents.direction, 'give')))
      .get()
    if (existing) continue
    const intentStatus: IntentStatus = o.status === 'available' ? 'expressed'
      : o.status === 'reserved' ? 'in-progress'
      : o.status === 'saturated' ? 'fulfilled'
      : o.status === 'paused' ? 'expressed'
      : o.status === 'withdrawn' ? 'withdrawn'
      : 'expressed'
    db.insert(schema.intents).values({
      id: randomUUID(),
      direction: 'give',
      object: o.resourceType,
      topic: null,
      intentType: inferGiveIntentType(o.resourceType),
      intentTypeLabel: o.resourceTypeLabel,
      expressedByAgent: o.offeredByAgent,
      expressedByUserId: o.offeredByUserId,
      addressedTo: `hub:${o.hubId}`,
      hubId: o.hubId,
      title: o.title,
      detail: o.detail,
      payload: o.capabilities ? `{"capabilities":${o.capabilities}}` : null,
      status: intentStatus,
      priority: 'normal',
      visibility: 'public',
      expectedOutcome: null,
      projectionRef: o.id,
      validUntil: o.validUntil,
      createdAt: o.createdAt,
      updatedAt: now,
    }).run()
    offeringsBackfilled++
  }
  return { needsBackfilled, offeringsBackfilled }
}

// Need-type → resource-type. Mirrors NEED_TYPE_TO_RESOURCE_TYPES in the
// scorer (lib/discover/scorer.ts) but picks the *primary* match — we only
// store one object per intent.
function inferObjectFromNeedType(needType: string): string {
  const map: Record<string, string> = {
    'needType:CircleCoachNeeded':      'resourceType:Worker',
    'needType:GroupLeaderApprentice':  'resourceType:Worker',
    'needType:Treasurer':              'resourceType:Worker',
    'needType:PrayerPartner':          'resourceType:Prayer',
    'needType:ConnectorToFunder':      'resourceType:Connector',
    'needType:HeartLanguageScripture': 'resourceType:Scripture',
    'needType:TrainerForT4T':          'resourceType:Worker',
    'needType:VenueForGathering':      'resourceType:Venue',
    'needType:TraumaInformedCare':     'resourceType:Worker',
    'intentType:NeedFunding':          'resourceType:Money',
    'intentType:NeedInformation':      'resourceType:Data',
    'intentType:NeedSafePlace':        'resourceType:Venue',
  }
  return map[needType] ?? 'resourceType:Worker'  // safe default
}

function inferGiveIntentType(resourceType: string): string {
  const map: Record<string, string> = {
    'resourceType:Skill':        'intentType:OfferSkill',
    'resourceType:Money':        'intentType:OfferFunding',
    'resourceType:Data':         'intentType:OfferInformation',
    'resourceType:Prayer':       'intentType:OfferPrayer',
    'resourceType:Worker':       'intentType:WantToContribute',
    'resourceType:Scripture':    'intentType:OfferTeaching',
    'resourceType:Connector':    'intentType:OfferIntroduction',
    'resourceType:Venue':        'intentType:OfferVenue',
    'resourceType:Curriculum':   'intentType:OfferTeaching',
  }
  return map[resourceType] ?? 'intentType:WantToContribute'
}

// ─── Hub summary (drives the home strip) ────────────────────────────

export interface HubIntentSummary {
  receiveCount: number
  giveCount: number
  topReceive: IntentRow[]
  topGive: IntentRow[]
}

export async function getHubIntentSummary(hubId: string): Promise<HubIntentSummary> {
  // Single sorted scan capped at 60 — enough to cover the top-3 of each
  // direction even when the hub is busy. Index on (hub_id, status) makes
  // this O(matched-rows) regardless of overall table size.
  const rows = db.select().from(schema.intents)
    .where(and(eq(schema.intents.hubId, hubId), eq(schema.intents.status, 'expressed')))
    .orderBy(desc(schema.intents.updatedAt))
    .limit(60)
    .all()
  let receiveCount = 0
  let giveCount = 0
  const recv: IntentRow[] = []
  const give: IntentRow[] = []
  const PRIO: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 }
  for (const r of rows) {
    if (r.direction === 'receive') { receiveCount++; recv.push(rowToIntent(r)) }
    else                            { giveCount++;    give.push(rowToIntent(r)) }
  }
  const sortByPrio = (a: IntentRow, b: IntentRow) => {
    const pa = PRIO[a.priority] ?? 4
    const pb = PRIO[b.priority] ?? 4
    if (pa !== pb) return pa - pb
    return b.updatedAt.localeCompare(a.updatedAt)
  }
  return {
    receiveCount,
    giveCount,
    topReceive: recv.sort(sortByPrio).slice(0, 3),
    topGive: give.sort(sortByPrio).slice(0, 3),
  }
}

// Intentionally unused but kept as a placeholder for the future
// "list intents that have no projection" use-case (free-form intents).
export async function _listFreeFormIntents(): Promise<IntentRow[]> {
  const rows = db.select().from(schema.intents)
    .where(isNull(schema.intents.projectionRef))
    .all()
  return rows.map(rowToIntent)
}
