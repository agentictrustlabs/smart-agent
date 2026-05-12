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
import {
  listIntentsViaMcp,
  getIntentViaMcp,
  expressIntentViaMcp,
  withdrawIntentViaMcp,
  type IntentRowFromMcp,
} from '@/lib/intents/router'

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

/** Map the MCP federation helper's row into the web's IntentRow shape.
 *  The two shapes are nearly identical; this is mostly a type cast plus
 *  filling in fields the MCP doesn't carry (hubId defaults to the
 *  caller's filter or empty string). */
function mcpRowToWebIntent(r: IntentRowFromMcp, hubIdFallback?: string): IntentRow {
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
    hubId: r.hubId || hubIdFallback || '',
    title: r.title,
    detail: r.detail,
    payload: r.payload as IntentRow['payload'],
    status: r.status,
    priority: r.priority,
    visibility: r.visibility,
    expectedOutcome: r.expectedOutcome as IntentRow['expectedOutcome'],
    projectionRef: r.projectionRef,
    validUntil: r.validUntil,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
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

  // R16 — every intent must declare its beneficiary explicitly.
  // For 'give' intents, beneficiary = self (the giver). For 'receive' intents,
  // beneficiary defaults to the expressing user's person agent IF the caller
  // didn't specify one; for org-as-expressed intents the caller MUST pass
  // payload.beneficiaryAgent — no fallback.
  const incomingPayload: Record<string, unknown> = input.payload
    ? { ...(input.payload as Record<string, unknown>) }
    : {}
  if (incomingPayload.beneficiaryAgent === undefined || incomingPayload.beneficiaryAgent === null) {
    if (input.direction === 'give') {
      incomingPayload.beneficiaryAgent = input.expressedByAgent.toLowerCase()
    } else {
      // Receive-direction without explicit beneficiary: only valid when the
      // expressing agent is the same as the beneficiary (personal intent).
      // The caller must set beneficiaryAgent for org-expressed intents.
      const myPerson = await resolvePersonAgentForUser(me.id)
      if (!myPerson) {
        return { error: 'beneficiary-required: caller has no person agent and no payload.beneficiaryAgent was provided' }
      }
      // Only auto-set when expressing agent matches the user's person agent
      // (pure personal intent). Otherwise — org-expressed — require explicit.
      if (input.expressedByAgent.toLowerCase() === myPerson) {
        incomingPayload.beneficiaryAgent = myPerson
      } else {
        return { error: 'beneficiary-required: org-expressed intents must include payload.beneficiaryAgent (no fallback)' }
      }
    }
  }
  const payloadJson = JSON.stringify(incomingPayload)

  // (needs/resourceOfferings tables dropped — no legacy projection)
  const projectionRef: string | null = null

  // Insert the canonical intents row.
  try { db.insert(schema.intents).values({
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
    payload: payloadJson,
    status: 'expressed',
    priority: input.priority ?? 'normal',
    visibility: input.visibility ?? 'public',
    expectedOutcome: input.expectedOutcome ? JSON.stringify(input.expectedOutcome) : null,
    projectionRef,
    validUntil: input.validUntil ?? null,
    createdAt: now,
    updatedAt: now,
  }).run() } catch { /* intents table dropped */ }

  // Spec 004 — also write to the owner's MCP so the eventual
  // schema.intents drop doesn't break this flow. Determine which MCP
  // owns this intent: person-mcp when the expressing agent IS the
  // user's person agent; org-mcp otherwise (org-as-expresser).
  //
  // The MCP assigns its own id. When the SQL `intents` table is dropped
  // (the canonical state for stateless users), the SQL insert above is a
  // no-op and the MCP id IS the canonical id. We swap our returned `id`
  // to match — otherwise the caller (e.g. the intent detail page) routes
  // to a non-existent id and 404s.
  let canonicalId: string = id
  try {
    const myPersonAgent = await resolvePersonAgentForUser(me.id)
    const source: 'person' | 'org' =
      myPersonAgent && input.expressedByAgent.toLowerCase() === myPersonAgent.toLowerCase()
        ? 'person'
        : 'org'
    const result = await expressIntentViaMcp({
      direction: input.direction,
      object: input.object,
      title: input.title,
      detail: input.detail ?? null,
      intentType: input.intentType,
      intentTypeLabel: input.intentTypeLabel,
      topic: input.topic ?? null,
      hubId: input.hubId,
      payload: incomingPayload,
      expectedOutcome: input.expectedOutcome,
      priority: input.priority ?? 'normal',
      visibility: input.visibility ?? 'public',
      addressedTo: input.addressedTo,
      validUntil: input.validUntil ?? null,
      source,
    })
    if (result.ok && result.id) canonicalId = result.id
  } catch (err) {
    console.warn('[intents] MCP mirror failed (non-fatal):', err instanceof Error ? err.message : err)
  }

  // (outcomes table dropped — observation pipeline target stored in MCP going forward)

  return { id: canonicalId, projectionRef: projectionRef ?? undefined }
}

// ─── Status transitions ─────────────────────────────────────────────

export async function acknowledgeIntent(intentId: string): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  try { db.update(schema.intents)
    .set({ status: 'acknowledged', updatedAt: new Date().toISOString() })
    .where(and(eq(schema.intents.id, intentId), eq(schema.intents.status, 'expressed')))
    .run() } catch { /* intents table dropped */ }
  return { ok: true }
}

export async function withdrawIntent(intentId: string): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  // Withdrawer must be the expresser.
  let row: any = undefined
  try { row = db.select().from(schema.intents).where(eq(schema.intents.id, intentId)).get() } catch { /* intents table dropped */ }
  // Post-drop authorization happens at the MCP — the owner MCP only
  // exposes withdraw to a token bound to the principal. So when SQL
  // has no row, defer the auth check to the MCP withdraw call.
  if (row && row.expressedByUserId !== me.id) return { error: 'not-authorized' }
  try { db.update(schema.intents)
    .set({ status: 'withdrawn', updatedAt: new Date().toISOString() })
    .where(eq(schema.intents.id, intentId))
    .run() } catch { /* intents table dropped */ }

  // Spec 004 — also withdraw at the owner MCP. Try person-mcp first;
  // if no person-side row, fall through to org-mcp.
  try {
    const personRes = await withdrawIntentViaMcp(intentId, 'person')
    if (!personRes.ok) await withdrawIntentViaMcp(intentId, 'org')
  } catch (err) {
    console.warn('[intents] MCP withdraw mirror failed (non-fatal):', err instanceof Error ? err.message : err)
  }
  // (needs/resourceOfferings tables dropped — no legacy projection cascade)
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
  // ─── Spec 001 (US1 / US5) ─────────────────────────────────────────
  /** Filter by intentType IRI (e.g. "intentType:NeedCoaching"). FR-002. */
  intentType?: string
  /** Filter by priority. FR-002. */
  priority?: 'critical' | 'high' | 'normal' | 'low'
  /** Substring filter applied across title, topic, detail. FR-003. */
  search?: string
  /** Filter by `payload.geo` substring. FR-002. */
  geo?: string
  /**
   * Spec 001 US5 (FR-022 / FR-023). 'hub' = only `hub:<hubId>`-addressed
   * intents; 'network' = also include `network:<hubId>`. Defaults to 'hub'.
   * Visibility never crosses the issuing hub boundary in v1.
   */
  scope?: 'hub' | 'network'
}

export async function listIntents(opts: ListIntentsOptions = {}): Promise<IntentRow[]> {
  const filters = []
  if (opts.hubId) filters.push(eq(schema.intents.hubId, opts.hubId))
  if (opts.direction) filters.push(eq(schema.intents.direction, opts.direction))
  if (opts.status) filters.push(eq(schema.intents.status, opts.status))
  if (opts.addressedTo) filters.push(eq(schema.intents.addressedTo, opts.addressedTo))
  if (opts.expressedBy) filters.push(eq(schema.intents.expressedByAgent, opts.expressedBy.toLowerCase()))
  if (opts.intentType) filters.push(eq(schema.intents.intentType, opts.intentType))
  if (opts.priority) filters.push(eq(schema.intents.priority, opts.priority))
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters)
  let rows: any[] = []
  try {
    rows = where
      ? await db.select().from(schema.intents).where(where).orderBy(desc(schema.intents.updatedAt)).limit(opts.limit ?? 100)
      : await db.select().from(schema.intents).orderBy(desc(schema.intents.updatedAt)).limit(opts.limit ?? 100)
  } catch { /* intents table dropped */ }
  let intents: IntentRow[] = rows.map(rowToIntent)

  // Spec 004 fallback — when the SQL table is empty (or dropped), pull
  // the viewer's intents from their owner MCP. Both person-mcp and
  // org-mcp are queried; results are merged + de-duped by id.
  if (intents.length === 0) {
    const fromPerson = await listIntentsViaMcp({
      direction: opts.direction,
      status: opts.status,
      source: 'person',
    })
    const fromOrg = await listIntentsViaMcp({
      direction: opts.direction,
      status: opts.status,
      source: 'org',
    })
    const seen = new Set<string>()
    const merged: IntentRow[] = []
    for (const r of [...fromPerson, ...fromOrg]) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      merged.push(mcpRowToWebIntent(r, opts.hubId))
    }
    intents = merged
  }

  // Post-filter: scope toggle (FR-022/FR-023). When 'hub', drop network-only
  // intents; when 'network', allow both.
  if (opts.hubId && opts.scope === 'hub' && !opts.addressedTo) {
    intents = intents.filter((i) =>
      i.addressedTo === `hub:${opts.hubId}` || i.addressedTo.startsWith('agent:') || i.addressedTo === 'self',
    )
  }
  if (opts.hubId && opts.scope === 'network' && !opts.addressedTo) {
    intents = intents.filter((i) =>
      i.addressedTo === `hub:${opts.hubId}` ||
      i.addressedTo === `network:${opts.hubId}` ||
      i.addressedTo.startsWith('agent:') ||
      i.addressedTo === 'self',
    )
  }

  // Post-filter: free-text search (FR-003) across title/topic/detail.
  if (opts.search) {
    const q = opts.search.toLowerCase()
    intents = intents.filter((i) =>
      (i.title ?? '').toLowerCase().includes(q) ||
      (i.topic ?? '').toLowerCase().includes(q) ||
      (i.detail ?? '').toLowerCase().includes(q),
    )
  }

  // Post-filter: geo (FR-002) — applied against payload.geo if present.
  if (opts.geo) {
    const g = opts.geo.toLowerCase()
    intents = intents.filter((i) => {
      const pg = typeof i.payload?.geo === 'string' ? i.payload.geo.toLowerCase() : ''
      return pg.includes(g)
    })
  }

  return intents
}

export interface IntentDetail extends IntentRow {
  outcome: { id: string; description: string; metric: OutcomeMetric; status: string } | null
}

export async function getIntent(id: string): Promise<IntentDetail | null> {
  let row: any = undefined
  try { row = db.select().from(schema.intents).where(eq(schema.intents.id, id)).get() } catch { /* intents table dropped */ }

  let intent: IntentRow | null = row ? rowToIntent(row) : null

  // Spec 004 fallback — when the SQL table is empty (or dropped), look
  // the intent up in the viewer's MCPs.
  if (!intent) {
    const fromPerson = await getIntentViaMcp(id, 'person')
    const fromOrg = fromPerson ? null : await getIntentViaMcp(id, 'org')
    const mcp = fromPerson ?? fromOrg
    if (!mcp) return null
    intent = mcpRowToWebIntent(mcp)
  }

  // outcomes table dropped — outcome lookup moved to MCP
  const outcome = null
  return { ...intent, outcome }
}

export async function getIntentForLegacyNeed(needId: string): Promise<IntentRow | null> {
  let row: any = undefined
  try { row = db.select().from(schema.intents)
    .where(and(eq(schema.intents.projectionRef, needId), eq(schema.intents.direction, 'receive')))
    .get() } catch { /* intents table dropped */ }
  return row ? rowToIntent(row) : null
}

export async function getIntentForLegacyOffering(offeringId: string): Promise<IntentRow | null> {
  let row: any = undefined
  try { row = db.select().from(schema.intents)
    .where(and(eq(schema.intents.projectionRef, offeringId), eq(schema.intents.direction, 'give')))
    .get() } catch { /* intents table dropped */ }
  return row ? rowToIntent(row) : null
}

// ─── Backfill from legacy tables ────────────────────────────────────
//
// Promotes every existing needs / resource_offerings row into intents.
// Idempotent — keyed on `(projectionRef, direction)` uniqueness.

/** @deprecated Spec 004 — schema.intents is dropped; needs/offerings
 *  no longer back-fill into a web SQL `intents` table. Kept as a
 *  no-op for back-compat with any caller that imports it. */
export async function backfillIntentsFromLegacy(): Promise<{ needsBackfilled: number; offeringsBackfilled: number }> {
  return { needsBackfilled: 0, offeringsBackfilled: 0 }
}
// Legacy backfill removed — needs/resourceOfferings tables dropped.

// R16/R17 helpers ──────────────────────────────────────────────────────

async function resolvePersonAgentForUser(userId: string): Promise<string | null> {
  const { getPersonAgentForUser } = await import('@/lib/agent-registry')
  const a = await getPersonAgentForUser(userId)
  return a ? a.toLowerCase() : null
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
  let rows: any[] = []
  try { rows = db.select().from(schema.intents)
    .where(and(eq(schema.intents.hubId, hubId), eq(schema.intents.status, 'expressed')))
    .orderBy(desc(schema.intents.updatedAt))
    .limit(60)
    .all() } catch { /* intents table dropped */ }
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
  let rows: any[] = []
  try { rows = db.select().from(schema.intents)
    .where(isNull(schema.intents.projectionRef))
    .all() } catch { /* intents table dropped */ }
  return rows.map(rowToIntent)
}
