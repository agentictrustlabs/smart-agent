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

  return { id }
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
