'use server'

import { requireSession } from '@/lib/auth/session'
import { callMcp } from '@/lib/clients/mcp-client'

// All oikos data lives in person-mcp. The principal is derived from the
// signed delegation token minted by a2a-agent — userId is no longer the key.

interface OikosContact {
  id: string
  principal: string
  personName: string
  proximity: string | null
  spiritualResponseState: string | null
  lastContactAt: string | null
  plannedConversation: number
  notes: string | null
  tags: string | null
  createdAt: string
  updatedAt: string
}

export async function getOikosContacts(_userId?: string): Promise<OikosContact[]> {
  await requireSession()
  const { contacts } = await callMcp<{ contacts: OikosContact[] }>(
    'person', 'list_oikos_contacts', {},
  )
  return contacts ?? []
}

/** @deprecated Use getOikosContacts */
export const getCircles = getOikosContacts

export async function addOikosPerson(data: {
  name: string
  proximity: number | string
  response: string
  notes?: string
  plannedConversation?: boolean
  tags?: string
}): Promise<{ id: string }> {
  await requireSession()
  const { contact } = await callMcp<{ contact: OikosContact }>(
    'person', 'add_oikos_contact',
    {
      personName: data.name,
      proximity: String(data.proximity),
      spiritualResponseState: data.response,
      notes: data.notes,
      plannedConversation: data.plannedConversation,
      tags: data.tags,
    },
  )
  return { id: contact.id }
}

/** @deprecated Use addOikosPerson */
export const addCirclePerson = addOikosPerson

export async function updateOikosPerson(
  id: string,
  data: {
    name?: string
    proximity?: number | string
    response?: string
    notes?: string
    plannedConversation?: boolean
    tags?: string
  },
): Promise<void> {
  await requireSession()
  await callMcp('person', 'update_oikos_contact', {
    id,
    personName: data.name,
    proximity: data.proximity !== undefined ? String(data.proximity) : undefined,
    spiritualResponseState: data.response,
    notes: data.notes,
    plannedConversation: data.plannedConversation,
    tags: data.tags,
  })
}

/** @deprecated Use updateOikosPerson */
export const updateCirclePerson = updateOikosPerson

export async function deleteOikosPerson(id: string): Promise<void> {
  await requireSession()
  await callMcp('person', 'delete_oikos_contact', { id })
}

/** @deprecated Use deleteOikosPerson */
export const deleteCirclePerson = deleteOikosPerson

export async function togglePlannedConversation(id: string): Promise<void> {
  await requireSession()
  await callMcp('person', 'toggle_planned_conversation', { id })
}
