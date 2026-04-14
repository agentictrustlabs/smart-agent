'use server'

import { db, schema } from '@/db'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'
import { getTrackedMembers, setTrackedMembers, type TrackedMember } from '@/lib/agent-resolver'

export async function createDetachedMember(data: {
  orgAddress: string
  name: string
  assignedNodeId?: string
  role?: string
  notes?: string
}) {
  await requireSession()

  const id = randomUUID()
  const existing = await getTrackedMembers(data.orgAddress)

  const newMember: TrackedMember = {
    id,
    name: data.name,
    role: data.role,
    assignedNode: data.assignedNodeId,
    notes: data.notes,
    createdAt: new Date().toISOString(),
  }

  await setTrackedMembers(data.orgAddress, [...existing, newMember])
  return { id }
}

export async function getDetachedMembers(orgAddress: string) {
  const members = await getTrackedMembers(orgAddress)
  // Map to the shape the UI expects
  return members.map(m => ({
    id: m.id,
    name: m.name,
    role: m.role ?? null,
    assignedNodeId: m.assignedNode ?? null,
    notes: m.notes ?? null,
  }))
}

export async function deleteDetachedMember(id: string, orgAddress: string) {
  await requireSession()

  const existing = await getTrackedMembers(orgAddress)
  const filtered = existing.filter(m => m.id !== id)
  await setTrackedMembers(orgAddress, filtered)
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
