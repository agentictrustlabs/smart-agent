'use server'

import { db, schema } from '@/db'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'

export async function createDetachedMember(data: {
  orgAddress: string
  name: string
  assignedNodeId?: string
  role?: string
  notes?: string
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  const id = randomUUID()
  await db.insert(schema.detachedMembers).values({
    id,
    orgAddress: data.orgAddress.toLowerCase(),
    name: data.name,
    assignedNodeId: data.assignedNodeId ?? null,
    role: data.role ?? null,
    notes: data.notes ?? null,
    createdBy: user[0].id,
  })
  return { id }
}

export async function getDetachedMembers(orgAddress: string) {
  return db.select().from(schema.detachedMembers)
    .where(eq(schema.detachedMembers.orgAddress, orgAddress.toLowerCase()))
}

export async function deleteDetachedMember(id: string) {
  await requireSession()
  await db.delete(schema.detachedMembers).where(eq(schema.detachedMembers.id, id))
}

export async function pinItem(data: { itemType: 'node' | 'org'; itemId: string }) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  // Check if already pinned
  const existing = await db.select().from(schema.pinnedItems)
    .where(and(eq(schema.pinnedItems.userId, user[0].id), eq(schema.pinnedItems.itemId, data.itemId)))
  if (existing.length > 0) return { id: existing[0].id }

  const id = randomUUID()
  await db.insert(schema.pinnedItems).values({
    id, userId: user[0].id, itemType: data.itemType, itemId: data.itemId,
  })
  return { id }
}

export async function unpinItem(itemId: string) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')
  await db.delete(schema.pinnedItems)
    .where(and(eq(schema.pinnedItems.userId, user[0].id), eq(schema.pinnedItems.itemId, itemId)))
}

export async function getPinnedItems(userId: string) {
  return db.select().from(schema.pinnedItems).where(eq(schema.pinnedItems.userId, userId))
}
