'use server'

import { requireSession } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'
import { callMcp } from '@/lib/clients/mcp-client'

interface PrayerRow {
  id: string
  principal: string
  title: string
  content: string | null
  schedule: string | null
  responseState: string | null
  linkedOikosContactId: string | null
  tags: string | null
  lastPrayedAt: string | null
  createdAt: string
  updatedAt: string
}

export async function getPrayers(_userId?: string): Promise<PrayerRow[]> {
  await requireSession()
  try {
    const { prayers } = await callMcp<{ prayers: PrayerRow[] }>('person', 'list_prayers', {})
    return prayers ?? []
  } catch {
    return []
  }
}

export async function addPrayer(data: {
  title: string
  notes?: string
  schedule: string
  linkedOikosId?: string
}): Promise<{ id: string }> {
  await requireSession()
  const result = await callMcp<{ prayer: PrayerRow }>(
    'person', 'upsert_prayer',
    {
      title: data.title,
      content: data.notes,
      schedule: data.schedule || 'daily',
      linkedOikosContactId: data.linkedOikosId,
    },
  )
  revalidatePath('/catalyst/prayer')
  return { id: result.prayer.id }
}

export async function markPrayed(id: string): Promise<void> {
  await requireSession()
  await callMcp('person', 'mark_prayer_response', { id, responseState: 'open' })
  revalidatePath('/catalyst/prayer')
}

export async function markAnswered(id: string): Promise<void> {
  await requireSession()
  await callMcp('person', 'mark_prayer_response', { id, responseState: 'answered' })
  revalidatePath('/catalyst/prayer')
}

export async function deletePrayer(id: string): Promise<void> {
  await requireSession()
  await callMcp('person', 'delete_prayer', { id })
  revalidatePath('/catalyst/prayer')
}
