'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'

export interface AgentSuggestion {
  id: string
  type: 'prayer' | 'coaching' | 'oikos' | 'training'
  title: string
  description: string
  href: string
  priority: number // 1 = highest
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

async function resolveUserId(): Promise<string | null> {
  try {
    const session = await requireSession()
    const user = await db.select().from(schema.users)
      .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
    return user[0]?.id ?? null
  } catch {
    return null
  }
}

/** Fetch suggestions for the current session user */
export async function getMyAgentSuggestions(): Promise<AgentSuggestion[]> {
  const userId = await resolveUserId()
  if (!userId) return []
  return getAgentSuggestions(userId)
}

export async function getAgentSuggestions(userId: string): Promise<AgentSuggestion[]> {
  const suggestions: AgentSuggestion[] = []
  const now = new Date()

  try {
    // 1. Overdue prayers (scheduled for today, last prayed >2 days ago)
    const prayers = await db.select().from(schema.prayers).where(eq(schema.prayers.userId, userId))
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const today = days[now.getDay()]
    for (const p of prayers) {
      if (p.answered) continue
      const isDue = p.schedule === 'daily' || p.schedule.includes(today)
      const lastPrayed = p.lastPrayed ? new Date(p.lastPrayed) : null
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

    // 2. Planned conversations (oikos people with planned flag)
    const circles = await db.select().from(schema.circles).where(eq(schema.circles.userId, userId))
    for (const c of circles) {
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

    // 3. Low training completion
    const progress = await db.select().from(schema.trainingProgress).where(eq(schema.trainingProgress.userId, userId))
    const completed = progress.filter(p => p.completed === 1).length
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

    // 4. Coach: check disciples needing attention (on-chain edges)
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
  } catch { /* tables may not exist */ }

  return suggestions.sort((a, b) => a.priority - b.priority).slice(0, 8)
}
