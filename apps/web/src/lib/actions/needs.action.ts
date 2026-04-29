'use server'

/**
 * Needs + Resource-Offering server actions.
 *
 * Discover layer entry points that don't run a match by themselves —
 * those live in `discover.action.ts`. This file handles CRUD on the
 * `needs` and `resource_offerings` tables and the simple list/get
 * operations the UI uses.
 *
 * T-Box: docs/ontology/tbox/needs.ttl + resources.ttl.
 * Schema: db/schema.ts (`needs`, `resourceOfferings` tables).
 */

import { randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { and, eq, desc, inArray } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, getOrgsForPersonAgent } from '@/lib/agent-registry'

export interface NeedRequirements {
  role?: string
  skill?: string
  geo?: string
  timeWindow?: { start?: string; end?: string; recurrence?: string }
  capacity?: { unit: string; amount: number }
  credential?: string
}

export interface CreateNeedInput {
  needType: string
  needTypeLabel: string
  neededByAgent: string
  hubId: string
  title: string
  detail?: string
  priority?: 'critical' | 'high' | 'normal' | 'low'
  requirements?: NeedRequirements
  validUntil?: string
}

export async function createNeed(input: CreateNeedInput): Promise<{ id: string } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const id = randomUUID()
  const now = new Date().toISOString()
  try {
    db.insert(schema.needs).values({
      id,
      needType: input.needType,
      needTypeLabel: input.needTypeLabel,
      neededByAgent: input.neededByAgent.toLowerCase(),
      neededByUserId: me.id,
      hubId: input.hubId,
      title: input.title,
      detail: input.detail ?? null,
      priority: input.priority ?? 'normal',
      status: 'open',
      requirements: input.requirements ? JSON.stringify(input.requirements) : null,
      validUntil: input.validUntil ?? null,
      createdBy: me.id,
      createdAt: now,
      updatedAt: now,
    }).run()
    return { id }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export interface OfferingCapability {
  skill?: string
  role?: string
  level?: 'beginner' | 'intermediate' | 'experienced' | 'expert'
  evidence?: string
}

export interface CreateOfferingInput {
  offeredByAgent: string
  hubId: string
  resourceType: string
  resourceTypeLabel: string
  title: string
  detail?: string
  capacity?: { unit: string; amount: number }
  geo?: string
  timeWindow?: { start?: string; end?: string; recurrence?: string }
  capabilities?: OfferingCapability[]
  validUntil?: string
}

export async function createOffering(input: CreateOfferingInput): Promise<{ id: string } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const id = randomUUID()
  try {
    db.insert(schema.resourceOfferings).values({
      id,
      offeredByAgent: input.offeredByAgent.toLowerCase(),
      offeredByUserId: me.id,
      hubId: input.hubId,
      resourceType: input.resourceType,
      resourceTypeLabel: input.resourceTypeLabel,
      title: input.title,
      detail: input.detail ?? null,
      status: 'available',
      capacity: input.capacity ? JSON.stringify(input.capacity) : null,
      geo: input.geo ?? null,
      timeWindow: input.timeWindow ? JSON.stringify(input.timeWindow) : null,
      capabilities: input.capabilities ? JSON.stringify(input.capabilities) : null,
      validUntil: input.validUntil ?? null,
    }).run()
    return { id }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

// ─── List + get ─────────────────────────────────────────────────────

export interface NeedRow {
  id: string
  needType: string
  needTypeLabel: string
  neededByAgent: string
  hubId: string
  title: string
  detail: string | null
  priority: 'critical' | 'high' | 'normal' | 'low'
  status: 'open' | 'in-progress' | 'met' | 'cancelled' | 'expired'
  requirements: NeedRequirements | null
  validUntil: string | null
  createdAt: string
  updatedAt: string
}

export interface OfferingRow {
  id: string
  offeredByAgent: string
  hubId: string
  resourceType: string
  resourceTypeLabel: string
  title: string
  detail: string | null
  status: 'available' | 'reserved' | 'saturated' | 'paused' | 'withdrawn'
  capacity: { unit: string; amount: number } | null
  geo: string | null
  timeWindow: { start?: string; end?: string; recurrence?: string } | null
  capabilities: OfferingCapability[]
  validUntil: string | null
  createdAt: string
}

function rowToNeed(r: typeof schema.needs.$inferSelect): NeedRow {
  return {
    id: r.id,
    needType: r.needType,
    needTypeLabel: r.needTypeLabel,
    neededByAgent: r.neededByAgent,
    hubId: r.hubId,
    title: r.title,
    detail: r.detail,
    priority: r.priority,
    status: r.status,
    requirements: r.requirements ? safeJsonParse(r.requirements) : null,
    validUntil: r.validUntil,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function rowToOffering(r: typeof schema.resourceOfferings.$inferSelect): OfferingRow {
  return {
    id: r.id,
    offeredByAgent: r.offeredByAgent,
    hubId: r.hubId,
    resourceType: r.resourceType,
    resourceTypeLabel: r.resourceTypeLabel,
    title: r.title,
    detail: r.detail,
    status: r.status,
    capacity: r.capacity ? safeJsonParse(r.capacity) : null,
    geo: r.geo,
    timeWindow: r.timeWindow ? safeJsonParse(r.timeWindow) : null,
    capabilities: r.capabilities ? safeJsonParse(r.capabilities) ?? [] : [],
    validUntil: r.validUntil,
    createdAt: r.createdAt,
  }
}

function safeJsonParse<T = unknown>(s: string): T | null {
  try { return JSON.parse(s) as T } catch { return null }
}

export interface ListNeedsOptions {
  hubId?: string
  status?: NeedRow['status']
  neededByAgent?: string
  limit?: number
}

export async function listNeeds(opts: ListNeedsOptions = {}): Promise<NeedRow[]> {
  const filters = []
  if (opts.hubId) filters.push(eq(schema.needs.hubId, opts.hubId))
  if (opts.status) filters.push(eq(schema.needs.status, opts.status))
  if (opts.neededByAgent) filters.push(eq(schema.needs.neededByAgent, opts.neededByAgent.toLowerCase()))
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters)
  const rows = where
    ? await db.select().from(schema.needs).where(where).orderBy(desc(schema.needs.updatedAt)).limit(opts.limit ?? 100)
    : await db.select().from(schema.needs).orderBy(desc(schema.needs.updatedAt)).limit(opts.limit ?? 100)
  return rows.map(rowToNeed)
}

export async function getNeed(id: string): Promise<NeedRow | null> {
  const row = await db.select().from(schema.needs).where(eq(schema.needs.id, id)).limit(1).then(r => r[0])
  return row ? rowToNeed(row) : null
}

export interface ListOfferingsOptions {
  hubId?: string
  resourceType?: string
  offeredByAgent?: string
  status?: OfferingRow['status']
  limit?: number
}

export async function listOfferings(opts: ListOfferingsOptions = {}): Promise<OfferingRow[]> {
  const filters = []
  if (opts.hubId) filters.push(eq(schema.resourceOfferings.hubId, opts.hubId))
  if (opts.resourceType) filters.push(eq(schema.resourceOfferings.resourceType, opts.resourceType))
  if (opts.offeredByAgent) filters.push(eq(schema.resourceOfferings.offeredByAgent, opts.offeredByAgent.toLowerCase()))
  if (opts.status) filters.push(eq(schema.resourceOfferings.status, opts.status))
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters)
  const rows = where
    ? await db.select().from(schema.resourceOfferings).where(where).orderBy(desc(schema.resourceOfferings.createdAt)).limit(opts.limit ?? 100)
    : await db.select().from(schema.resourceOfferings).orderBy(desc(schema.resourceOfferings.createdAt)).limit(opts.limit ?? 100)
  return rows.map(rowToOffering)
}

export async function getOffering(id: string): Promise<OfferingRow | null> {
  const row = await db.select().from(schema.resourceOfferings).where(eq(schema.resourceOfferings.id, id)).limit(1).then(r => r[0])
  return row ? rowToOffering(row) : null
}

// ─── My needs / offerings ───────────────────────────────────────────

export async function listMyNeeds(): Promise<NeedRow[]> {
  const me = await getCurrentUser()
  if (!me) return []
  const personAgent = await getPersonAgentForUser(me.id) as `0x${string}` | null
  const orgs = personAgent ? await getOrgsForPersonAgent(personAgent) : []
  const ownedAgents = [
    ...(personAgent ? [personAgent.toLowerCase()] : []),
    ...orgs.map(o => o.address.toLowerCase()),
  ]
  if (ownedAgents.length === 0) return []
  const rows = await db.select().from(schema.needs)
    .where(inArray(schema.needs.neededByAgent, ownedAgents))
    .orderBy(desc(schema.needs.updatedAt))
    .limit(100)
  return rows.map(rowToNeed)
}

export async function listMyOfferings(): Promise<OfferingRow[]> {
  const me = await getCurrentUser()
  if (!me) return []
  const personAgent = await getPersonAgentForUser(me.id) as `0x${string}` | null
  if (!personAgent) return []
  const rows = await db.select().from(schema.resourceOfferings)
    .where(eq(schema.resourceOfferings.offeredByAgent, personAgent.toLowerCase()))
    .orderBy(desc(schema.resourceOfferings.createdAt))
    .limit(100)
  return rows.map(rowToOffering)
}

// ─── Status transitions ─────────────────────────────────────────────

export async function setNeedStatus(needId: string, status: NeedRow['status']): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  try {
    db.update(schema.needs)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(schema.needs.id, needId))
      .run()
    return { ok: true }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export async function setOfferingStatus(offeringId: string, status: OfferingRow['status']): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  try {
    db.update(schema.resourceOfferings)
      .set({ status })
      .where(eq(schema.resourceOfferings.id, offeringId))
      .run()
    return { ok: true }
  } catch (err) {
    return { error: (err as Error).message }
  }
}
