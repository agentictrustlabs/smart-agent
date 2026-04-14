'use server'

import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

async function resolveUserId() {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')
  return user[0].id
}

export async function getPrayers(userId: string) {
  return db.select().from(schema.prayers)
    .where(eq(schema.prayers.userId, userId))
}

export async function addPrayer(data: {
  title: string
  notes?: string
  schedule: string
  linkedOikosId?: string
}) {
  const userId = await resolveUserId()

  const id = randomUUID()
  await db.insert(schema.prayers).values({
    id,
    userId,
    title: data.title,
    notes: data.notes ?? null,
    schedule: data.schedule || 'daily',
    linkedOikosId: data.linkedOikosId ?? null,
  })

  revalidatePath('/catalyst/prayer')
  return { id }
}

export async function markPrayed(id: string) {
  await resolveUserId()

  await db.update(schema.prayers)
    .set({ lastPrayed: new Date().toISOString() })
    .where(eq(schema.prayers.id, id))

  revalidatePath('/catalyst/prayer')
}

export async function markAnswered(id: string) {
  await resolveUserId()

  await db.update(schema.prayers)
    .set({ answered: 1, answeredAt: new Date().toISOString() })
    .where(eq(schema.prayers.id, id))

  revalidatePath('/catalyst/prayer')
}

export async function deletePrayer(id: string) {
  await resolveUserId()

  await db.delete(schema.prayers).where(eq(schema.prayers.id, id))

  revalidatePath('/catalyst/prayer')
}
