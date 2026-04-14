'use server'

import { db, schema } from '@/db'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'

async function getUserId(): Promise<string> {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')
  return user[0].id
}

export async function getCircles(userId: string) {
  return db.select().from(schema.circles).where(eq(schema.circles.userId, userId))
}

export async function addCirclePerson(data: {
  name: string
  proximity: number
  response: 'not-interested' | 'curious' | 'interested' | 'seeking' | 'decided' | 'baptized'
  notes?: string
  plannedConversation?: boolean
  tags?: string
}) {
  const userId = await getUserId()
  const id = randomUUID()
  await db.insert(schema.circles).values({
    id,
    userId,
    personName: data.name,
    proximity: data.proximity,
    response: data.response,
    notes: data.notes ?? null,
    plannedConversation: data.plannedConversation ? 1 : 0,
    tags: data.tags ?? null,
  })
  return { id }
}

export async function updateCirclePerson(
  id: string,
  data: {
    name?: string
    proximity?: number
    response?: 'not-interested' | 'curious' | 'interested' | 'seeking' | 'decided' | 'baptized'
    notes?: string
    plannedConversation?: boolean
    tags?: string
  },
) {
  const userId = await getUserId()
  const updates: Record<string, unknown> = {}
  if (data.name !== undefined) updates.personName = data.name
  if (data.proximity !== undefined) updates.proximity = data.proximity
  if (data.response !== undefined) updates.response = data.response
  if (data.notes !== undefined) updates.notes = data.notes
  if (data.plannedConversation !== undefined) updates.plannedConversation = data.plannedConversation ? 1 : 0
  if (data.tags !== undefined) updates.tags = data.tags

  await db.update(schema.circles)
    .set(updates)
    .where(and(eq(schema.circles.id, id), eq(schema.circles.userId, userId)))
}

export async function deleteCirclePerson(id: string) {
  const userId = await getUserId()
  await db.delete(schema.circles)
    .where(and(eq(schema.circles.id, id), eq(schema.circles.userId, userId)))
}

export async function togglePlannedConversation(id: string) {
  const userId = await getUserId()
  const rows = await db.select().from(schema.circles)
    .where(and(eq(schema.circles.id, id), eq(schema.circles.userId, userId))).limit(1)
  if (!rows[0]) throw new Error('Circle person not found')

  await db.update(schema.circles)
    .set({ plannedConversation: rows[0].plannedConversation ? 0 : 1 })
    .where(eq(schema.circles.id, id))
}
