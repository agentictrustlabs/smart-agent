'use server'

/**
 * Sessions — Cadence-shape engagement primary surface.
 *
 * Sessions can be:
 *   • scheduled  → `scheduledFor` set, `occurredAt` null
 *   • occurred   → `occurredAt` set
 *   • cancelled  → marked manually
 *
 * Logging a session also creates an activity_log row + thread `activity` entry
 * so the existing PROV chain (capacity → outcome → cascade) stays intact. The
 * timeline is the surface; activities remain the audit truth.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §6 R10
 */

import { randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'

export type SessionStatus = 'scheduled' | 'occurred' | 'cancelled'

export interface SessionRow {
  id: string
  engagementId: string
  scheduledFor: string | null
  occurredAt: string | null
  notes: string | null
  loggedBy: string | null
  sourceActivityId: string | null
  status: SessionStatus
  createdAt: string
}

function rowToSession(r: typeof schema.engagementSessions.$inferSelect): SessionRow {
  return {
    id: r.id,
    engagementId: r.engagementId,
    scheduledFor: r.scheduledFor,
    occurredAt: r.occurredAt,
    notes: r.notes,
    loggedBy: r.loggedBy,
    sourceActivityId: r.sourceActivityId,
    status: r.status,
    createdAt: r.createdAt,
  }
}

async function authorizeParty(engagementId: string): Promise<
  { ok: true; agent: string; engagement: typeof schema.entitlements.$inferSelect }
  | { error: string }
> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const agentAddr = await getPersonAgentForUser(me.id)
  if (!agentAddr) return { error: 'no-person-agent' }
  const lower = agentAddr.toLowerCase()
  let ent: any = [] as any[]
  try { ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, engagementId)).get()
   } catch { /* entitlements table dropped */ }if (!ent) return { error: 'engagement-not-found' }
  if (ent.holderAgent !== lower && ent.providerAgent !== lower) {
    return { error: 'not-a-party' }
  }
  return { ok: true, agent: lower, engagement: ent }
}

// ─── Mutators ──────────────────────────────────────────────────────

export async function scheduleSession(input: {
  engagementId: string
  scheduledFor: string
  notes?: string
}): Promise<{ ok: true; id: string } | { error: string }> {
  const auth = await authorizeParty(input.engagementId)
  if ('error' in auth) return auth
  const id = randomUUID()
  try { db.insert(schema.engagementSessions).values({
    id,
    engagementId: input.engagementId,
    scheduledFor: input.scheduledFor,
    occurredAt: null,
    notes: input.notes ?? null,
    loggedBy: auth.agent,
    sourceActivityId: null,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
  }).run()
   } catch { /* engagementSessions table dropped */ }return { ok: true, id }
}

export async function cancelSession(sessionId: string): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  let row: any = [] as any[]
  try { row = db.select().from(schema.engagementSessions)
    .where(eq(schema.engagementSessions.id, sessionId)).get()
   } catch { /* engagementSessions table dropped */ }if (!row) return { error: 'session-not-found' }
  const auth = await authorizeParty(row.engagementId)
  if ('error' in auth) return auth
  if (row.status === 'occurred') return { error: 'already-occurred' }
  try { db.update(schema.engagementSessions)
    .set({ status: 'cancelled' })
    .where(eq(schema.engagementSessions.id, sessionId))
    .run()
   } catch { /* engagementSessions table dropped */ }return { ok: true }
}

/**
 * Log a session that occurred. Optionally fold an activity log entry +
 * thread emit + capacity-consume in one shot — passing through to the
 * existing logActivity flow. If no activity is wanted (e.g. quiet-mode
 * sensitive engagement), pass `withActivity=false`.
 */
export async function logSession(input: {
  engagementId: string
  occurredAt?: string
  notes?: string
  /** Optional pre-existing scheduled session to mark as occurred. */
  scheduledSessionId?: string
  /** Whether to also log an activity_logs row + cascade. Default true. */
  withActivity?: boolean
  /** Optional capacity to consume (default 1). */
  capacityConsumed?: number
  /** Optional title for the activity log row. */
  activityTitle?: string
  /** Optional org address — required for activity logging. */
  orgAddress?: string
}): Promise<{ ok: true; sessionId: string; activityId?: string } | { error: string }> {
  const auth = await authorizeParty(input.engagementId)
  if ('error' in auth) return auth

  const occurredAt = input.occurredAt ?? new Date().toISOString()
  let sessionId: string
  let activityId: string | undefined

  // Optionally log an activity (drives capacity cascade + thread entry).
  if (input.withActivity !== false && input.orgAddress) {
    const { logActivity } = await import('@/lib/actions/activity.action')
    const counterRole = auth.engagement.holderAgent === auth.agent ? 'provider' : 'holder'
    const activityRes = await logActivity({
      orgAddress: input.orgAddress,
      activityType: 'coaching',
      title: input.activityTitle ?? `Session with ${counterRole}`,
      description: input.notes,
      participants: 2,
      activityDate: occurredAt.split('T')[0],
      fulfillsEntitlementId: input.engagementId,
      capacityConsumed: input.capacityConsumed,
    })
    activityId = activityRes.id
  }

  // Mark an existing scheduled session as occurred, or create a new one.
  if (input.scheduledSessionId) {
    let existing: any = [] as any[]
    try { existing = db.select().from(schema.engagementSessions)
      .where(eq(schema.engagementSessions.id, input.scheduledSessionId)).get()
     } catch { /* engagementSessions table dropped */ }if (!existing) return { error: 'session-not-found' }
    if (existing.engagementId !== input.engagementId) return { error: 'wrong-engagement' }
    try { db.update(schema.engagementSessions)
      .set({
        occurredAt,
        notes: input.notes ?? existing.notes,
        loggedBy: auth.agent,
        sourceActivityId: activityId ?? existing.sourceActivityId,
        status: 'occurred',
      })
      .where(eq(schema.engagementSessions.id, input.scheduledSessionId))
      .run()
     } catch { /* engagementSessions table dropped */ }sessionId = input.scheduledSessionId
  } else {
    sessionId = randomUUID()
    try { db.insert(schema.engagementSessions).values({
      id: sessionId,
      engagementId: input.engagementId,
      scheduledFor: null,
      occurredAt,
      notes: input.notes ?? null,
      loggedBy: auth.agent,
      sourceActivityId: activityId ?? null,
      status: 'occurred',
      createdAt: new Date().toISOString(),
    }).run()
   } catch { /* engagementSessions table dropped */ }}

  return { ok: true, sessionId, activityId }
}

// ─── Reads ─────────────────────────────────────────────────────────

export interface SessionTimelineView {
  upcoming: SessionRow[]
  past: SessionRow[]
  totalOccurred: number
  totalScheduled: number
}

export async function listSessionsForEngagement(engagementId: string): Promise<SessionTimelineView> {
  // Idempotent backfill: project activities that don't yet have a session row.
  await backfillSessionsFromActivities(engagementId)

  let allRows: any = [] as any[]
  try { allRows = await db.select().from(schema.engagementSessions)
    .where(eq(schema.engagementSessions.engagementId, engagementId))
    .all()

   } catch { /* engagementSessions table dropped */ }const upcoming: SessionRow[] = []
  const past: SessionRow[] = []
  let totalOccurred = 0
  let totalScheduled = 0
  for (const r of allRows) {
    const view = rowToSession(r)
    if (view.status === 'cancelled') continue
    if (view.occurredAt) {
      past.push(view)
      totalOccurred++
    } else if (view.scheduledFor) {
      upcoming.push(view)
      totalScheduled++
    }
  }
  upcoming.sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
  past.sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))
  return { upcoming, past, totalOccurred, totalScheduled }
}

/**
 * Project any activity_logs row tagged with this engagement into a session row
 * (idempotent — keyed on `source_activity_id`). Lets existing engagements
 * show their session history immediately when the Cadence shape goes live.
 */
async function backfillSessionsFromActivities(engagementId: string): Promise<void> {
  let activities: any[] = []
  try { activities = db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.fulfillsEntitlementId, engagementId))
    .all() } catch { /* activityLogs table dropped */ }
  if (activities.length === 0) return
  let existing: any = [] as any[]
  try { existing = db.select().from(schema.engagementSessions)
    .where(and(
      eq(schema.engagementSessions.engagementId, engagementId),
      isNotNull(schema.engagementSessions.sourceActivityId),
    ))
    .all()
   } catch { /* engagementSessions table dropped */ }const seen = new Set(existing.map((e: any) => e.sourceActivityId).filter(Boolean) as string[])
  const toInsert: typeof schema.engagementSessions.$inferInsert[] = []
  for (const a of activities) {
    if (seen.has(a.id)) continue
    toInsert.push({
      id: randomUUID(),
      engagementId,
      scheduledFor: null,
      occurredAt: a.activityDate ? new Date(a.activityDate).toISOString() : null,
      notes: a.description ?? null,
      loggedBy: null,
      sourceActivityId: a.id,
      status: 'occurred',
      createdAt: a.activityDate ?? new Date().toISOString(),
    })
  }
  if (toInsert.length > 0) {
    try { db.insert(schema.engagementSessions).values(toInsert).run()
   } catch { /* engagementSessions table dropped */ }}
}

/** Next upcoming session for this engagement, or null if none scheduled. */
export async function nextScheduledSession(engagementId: string): Promise<SessionRow | null> {
  let row: any = [] as any[]
  try { row = db.select().from(schema.engagementSessions)
    .where(and(
      eq(schema.engagementSessions.engagementId, engagementId),
      eq(schema.engagementSessions.status, 'scheduled'),
      isNotNull(schema.engagementSessions.scheduledFor),
      isNull(schema.engagementSessions.occurredAt),
    ))
    .orderBy(asc(schema.engagementSessions.scheduledFor))
    .get()
   } catch { /* engagementSessions table dropped */ }return row ? rowToSession(row) : null
}

/** Most recent occurred session for this engagement. */
export async function latestOccurredSession(engagementId: string): Promise<SessionRow | null> {
  let row: any = [] as any[]
  try { row = db.select().from(schema.engagementSessions)
    .where(and(
      eq(schema.engagementSessions.engagementId, engagementId),
      isNotNull(schema.engagementSessions.occurredAt),
    ))
    .orderBy(desc(schema.engagementSessions.occurredAt))
    .get()
   } catch { /* engagementSessions table dropped */ }return row ? rowToSession(row) : null
}
