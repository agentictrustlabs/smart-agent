'use server'

import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'
import { getTrackedMembers, setTrackedMembers, type TrackedMember } from '@/lib/agent-resolver'
import { callMcp } from '@/lib/clients/mcp-client'

// ─── Detached members (on-chain agent metadata; unchanged) ─────────

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

// ─── Pinned items (now in person-mcp) ──────────────────────────────

interface PinnedRow {
  id: string
  principal: string
  itemType: string
  itemRef: string
  displayOrder: number
  createdAt: string
}

export async function pinItem(data: { itemType: 'node' | 'org'; itemId: string }): Promise<{ id: string }> {
  await requireSession()
  const { item } = await callMcp<{ item: PinnedRow }>(
    'person', 'pin_item',
    { itemType: data.itemType, itemRef: data.itemId },
  )
  return { id: item.id }
}

export async function unpinItem(itemId: string): Promise<void> {
  await requireSession()
  await callMcp('person', 'unpin_item', { itemRef: itemId })
}

export async function getPinnedItems(_userId?: string): Promise<PinnedRow[]> {
  await requireSession()
  const { items } = await callMcp<{ items: PinnedRow[] }>('person', 'list_pinned_items', {})
  return items ?? []
}
