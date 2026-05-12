'use server'

import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
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
  /** PROV chain — closes the marketplace→fulfillment chain. When set,
   *  the action backfills `fulfillsNeedId` and `fulfillsIntentId` from
   *  the entitlement's links and drives capacity decrement + cascade. */
  fulfillsEntitlementId?: string
  /** Optional: how much capacity this activity consumes (default 1).
   *  Used by funding entitlements to record tranche dollar amount, etc. */
  capacityConsumed?: number
  /** Optional: explicit "this achieves the outcome" flag — fast-path to
   *  fulfilled even before capacity hits zero (e.g. a single
   *  information-transfer answers a one-shot info intent). */
  achievesOutcome?: boolean
  /** PROV chain — does this activity draw on a specific resource offering? */
  usesOfferingId?: string
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.walletAddress, session.walletAddress ?? '')).limit(1)
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

  // Activity is now persisted on-chain (org agent metadata) — that's the
  // canonical record. The redundant web SQL cache + entitlement/need
  // cascades have moved to person-mcp / org-mcp activity_log_entries +
  // engagement_*_state. Cascade rewires are Phase-5 work; for now logging
  // an activity just emits it on-chain, which is the privacy-preserving
  // source of truth.
  void data.fulfillsEntitlementId
  void data.fulfillsNeedId
  void data.capacityConsumed
  void data.achievesOutcome

  return { id }
}

// Need-status cascade (web-SQL-backed) removed. Needs moved to MCPs;
// fulfillment cascades will be re-implemented as on-chain assertion
// emits + MCP listeners in Phase 5.

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
