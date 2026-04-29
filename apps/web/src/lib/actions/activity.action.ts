'use server'

import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { and, eq } from 'drizzle-orm'
import {
  getActivityLog, setActivityLog,
  type ActivityEntry,
} from '@/lib/agent-resolver'

export async function logActivity(data: {
  orgAddress: string
  activityType: string
  title: string
  description?: string
  participants: number
  location?: string
  lat?: string
  lng?: string
  durationMinutes?: number
  relatedEntity?: string
  activityDate: string
  chainedFrom?: string
  peopleGroup?: string
  /** PROV chain — does this activity address an open need? */
  fulfillsNeedId?: string
  /** PROV chain — does this activity draw on a specific resource offering? */
  usesOfferingId?: string
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  const id = randomUUID()
  const entry: ActivityEntry = {
    id,
    type: data.activityType as ActivityEntry['type'],
    title: data.title,
    description: data.description ?? undefined,
    date: data.activityDate,
    duration: data.durationMinutes ?? undefined,
    participants: data.participants,
    location: data.location ?? undefined,
    lat: data.lat ? parseFloat(data.lat) : undefined,
    lng: data.lng ? parseFloat(data.lng) : undefined,
    chainedFrom: data.chainedFrom ?? undefined,
    peopleGroup: data.peopleGroup ?? undefined,
    notes: data.description ?? undefined,
    createdBy: user[0].id,
    createdAt: new Date().toISOString(),
  }

  const activities = await getActivityLog(data.orgAddress)
  activities.push(entry)
  await setActivityLog(data.orgAddress, activities)

  // Also write to DB for dashboard queries
  try {
    await db.insert(schema.activityLogs).values({
      id,
      orgAddress: data.orgAddress,
      userId: user[0].id,
      activityType: data.activityType as typeof schema.activityLogs.$inferInsert['activityType'],
      title: data.title,
      description: data.description || null,
      participants: data.participants,
      location: data.location || null,
      lat: data.lat || null,
      lng: data.lng || null,
      durationMinutes: data.durationMinutes || null,
      relatedEntity: data.relatedEntity || null,
      fulfillsNeedId: data.fulfillsNeedId || null,
      usesOfferingId: data.usesOfferingId || null,
      activityDate: data.activityDate || new Date().toISOString().split('T')[0],
    }).run()
  } catch {
    /* DB write is best-effort — on-chain is the source of truth */
  }

  // PROV-chain side-effect: when an activity is tagged with a need, count
  // the fulfillment activities recorded so far. Crossing the threshold
  // transitions the need's status. Threshold tuned per-need-type:
  //   - prayer / venue / connector → 1 activity is enough
  //   - coach / treasurer / trainer → 3 activities (pattern of fulfillment)
  //   - default                    → 2 activities
  if (data.fulfillsNeedId) {
    try {
      await maybeAdvanceNeedStatus(data.fulfillsNeedId)
    } catch (_e) { /* non-fatal */ }
  }

  return { id }
}

const FULFILLMENT_THRESHOLDS: Record<string, number> = {
  'needType:PrayerPartner': 1,
  'needType:VenueForGathering': 1,
  'needType:ConnectorToFunder': 1,
  'needType:HeartLanguageScripture': 2,
  'needType:CircleCoachNeeded': 3,
  'needType:Treasurer': 3,
  'needType:TrainerForT4T': 3,
  'needType:GroupLeaderApprentice': 3,
  'needType:TraumaInformedCare': 2,
}

async function maybeAdvanceNeedStatus(needId: string): Promise<void> {
  const need = db.select().from(schema.needs).where(eq(schema.needs.id, needId)).get()
  if (!need) return
  if (need.status === 'met' || need.status === 'cancelled' || need.status === 'expired') return
  const fulfilling = db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.fulfillsNeedId, needId)).all()
  const threshold = FULFILLMENT_THRESHOLDS[need.needType] ?? 2
  const now = new Date().toISOString()
  // First activity → flip open → in-progress.
  if (need.status === 'open' && fulfilling.length >= 1) {
    db.update(schema.needs).set({ status: 'in-progress', updatedAt: now }).where(eq(schema.needs.id, needId)).run()
  }
  // Threshold crossed → flip in-progress → met. Also fulfill the
  // accepted match (if any) so the audit chain closes cleanly.
  if (fulfilling.length >= threshold) {
    db.update(schema.needs).set({ status: 'met', updatedAt: now }).where(eq(schema.needs.id, needId)).run()
    // Only flip *accepted* matches to fulfilled — proposed/rejected stay
    // as historical records.
    db.update(schema.needResourceMatches)
      .set({ status: 'fulfilled', updatedAt: now })
      .where(and(
        eq(schema.needResourceMatches.needId, needId),
        eq(schema.needResourceMatches.status, 'accepted'),
      ))
      .run()
  }
}

export async function getActivities(orgAddress: string): Promise<ActivityEntry[]> {
  return getActivityLog(orgAddress)
}

export async function updateActivityOnChain(args: {
  orgAddress: string
  id: string
  title?: string
  description?: string
  participants?: number
  location?: string
  durationMinutes?: number
  activityType?: string
}) {
  const activities = await getActivityLog(args.orgAddress)
  const idx = activities.findIndex(a => a.id === args.id)
  if (idx === -1) throw new Error('Activity not found')

  if (args.title !== undefined) activities[idx].title = args.title
  if (args.description !== undefined) activities[idx].description = args.description
  if (args.participants !== undefined) activities[idx].participants = args.participants
  if (args.location !== undefined) activities[idx].location = args.location
  if (args.durationMinutes !== undefined) activities[idx].duration = args.durationMinutes
  if (args.activityType !== undefined) activities[idx].type = args.activityType as ActivityEntry['type']

  await setActivityLog(args.orgAddress, activities)
}

export async function deleteActivityOnChain(orgAddress: string, activityId: string) {
  const activities = await getActivityLog(orgAddress)
  const filtered = activities.filter(a => a.id !== activityId)
  await setActivityLog(orgAddress, filtered)
}
