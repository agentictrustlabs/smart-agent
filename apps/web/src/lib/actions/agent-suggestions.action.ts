'use server'

import { requireSession } from '@/lib/auth/session'
import { callMcp } from '@/lib/clients/mcp-client'

export interface AgentSuggestion {
  id: string
  type: 'prayer' | 'coaching' | 'oikos' | 'training'
  title: string
  description: string
  href: string
  priority: number // 1 = highest
}

interface PrayerRow {
  id: string
  title: string
  schedule: string | null
  responseState: string | null
  lastPrayedAt: string | null
}

interface OikosRow {
  id: string
  personName: string
  plannedConversation: number
}

interface TrainingRow {
  id: string
  status: string
}

/** Fetch suggestions for the current session user */
export async function getMyAgentSuggestions(): Promise<AgentSuggestion[]> {
  return getAgentSuggestions('me')
}

export async function getAgentSuggestions(userId: string): Promise<AgentSuggestion[]> {
  try {
    await requireSession()
  } catch {
    return []
  }
  const suggestions: AgentSuggestion[] = []
  const now = new Date()

  // 1. Overdue prayers — pulled from person-mcp.
  try {
    const { prayers = [] } = await callMcp<{ prayers: PrayerRow[] }>('person', 'list_prayers', {})
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const today = days[now.getDay()]
    for (const p of prayers) {
      if (p.responseState === 'answered') continue
      const schedule = p.schedule ?? ''
      const isDue = schedule === 'daily' || schedule.includes(today)
      const lastPrayed = p.lastPrayedAt ? new Date(p.lastPrayedAt) : null
      const sinceDays = lastPrayed ? Math.floor((now.getTime() - lastPrayed.getTime()) / 86400000) : 999
      if (isDue && sinceDays > 2) {
        suggestions.push({
          id: `prayer-${p.id}`,
          type: 'prayer',
          title: `Pray for: ${p.title}`,
          description: lastPrayed ? `Last prayed ${sinceDays} days ago` : 'Not yet prayed for',
          href: '/nurture/prayer',
          priority: sinceDays > 5 ? 1 : 2,
        })
      }
    }
  } catch { /* no A2A session yet */ }

  // 2. Planned conversations — oikos contacts in person-mcp.
  try {
    const { contacts = [] } = await callMcp<{ contacts: OikosRow[] }>('person', 'list_oikos_contacts', {})
    for (const c of contacts) {
      if (c.plannedConversation) {
        suggestions.push({
          id: `oikos-${c.id}`,
          type: 'oikos',
          title: `Follow up with ${c.personName}`,
          description: 'Planned conversation pending',
          href: '/oikos',
          priority: 2,
        })
      }
    }
  } catch { /* no A2A session yet */ }

  // 3. Training completion — person-mcp.
  try {
    const { progress = [] } = await callMcp<{ progress: TrainingRow[] }>('person', 'list_training_progress', {})
    const completed = progress.filter(p => p.status === 'completed').length
    const total = 28
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0
    if (pct < 50) {
      suggestions.push({
        id: 'training-low',
        type: 'training',
        title: 'Continue your training',
        description: `${pct}% complete — pick up where you left off`,
        href: '/nurture/grow',
        priority: 3,
      })
    }
  } catch { /* no A2A session yet */ }

  // 4. Coach: check disciples needing attention (on-chain edges; unchanged).
  try {
    const { getDisciples } = await import('@/lib/actions/grow.action')
    const disciples = await getDisciples(userId)
    for (const d of disciples) {
      suggestions.push({
        id: `coach-${d.id}`,
        type: 'coaching',
        title: `Check in with ${d.discipleName}`,
        description: 'Review disciple progress',
        href: '/catalyst/coach',
        priority: 1,
      })
    }
  } catch { /* ignored */ }

  return suggestions.sort((a, b) => a.priority - b.priority).slice(0, 8)
}
