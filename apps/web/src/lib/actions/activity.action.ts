'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'

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
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  const id = randomUUID()
  await db.insert(schema.activityLogs).values({
    id,
    orgAddress: data.orgAddress.toLowerCase(),
    userId: user[0].id,
    activityType: data.activityType as 'meeting' | 'visit' | 'training' | 'outreach' | 'follow-up' | 'assessment' | 'coaching' | 'prayer' | 'service' | 'other',
    title: data.title,
    description: data.description ?? null,
    participants: data.participants,
    location: data.location ?? null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    durationMinutes: data.durationMinutes ?? null,
    relatedEntity: data.relatedEntity ?? null,
    activityDate: data.activityDate,
  })
  return { id }
}

export async function getActivities(orgAddress: string) {
  return db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.orgAddress, orgAddress.toLowerCase()))
}
