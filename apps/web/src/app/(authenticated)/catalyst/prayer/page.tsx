import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPrayers } from '@/lib/actions/prayer.action'
import { getOikosContacts } from '@/lib/actions/oikos.action'
import { PrayerClient } from './PrayerClient'

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export default async function CatalystPrayerPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // Prayer + oikos data lives in person-mcp now. Both calls fail gracefully
  // until the user has bootstrapped an A2A session (delegation token).
  const allPrayersRaw = await getPrayers(currentUser.id).catch(() => [])
  const oikosRaw = await getOikosContacts(currentUser.id).catch(() => [])
  const oikosPeople = oikosRaw.map(c => ({ id: c.id, personName: c.personName }))

  // Map MCP shape to the legacy fields the client expects.
  const allPrayers = allPrayersRaw.map(p => ({
    id: p.id,
    userId: currentUser.id,
    title: p.title,
    notes: p.content ?? null,
    schedule: p.schedule ?? 'daily',
    linkedOikosId: p.linkedOikosContactId ?? null,
    answered: p.responseState === 'answered' ? 1 : 0,
    lastPrayed: p.lastPrayedAt ?? null,
    answeredAt: null as string | null,
    createdAt: p.createdAt,
  }))

  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const activePrayers = allPrayers.filter(p => p.answered === 0)
  const oikosNeedPrayer = oikosPeople.filter(person => {
    const linkedPrayer = activePrayers.find(p => p.linkedOikosId === person.id)
    if (!linkedPrayer) return true
    if (!linkedPrayer.lastPrayed) return true
    return (now - new Date(linkedPrayer.lastPrayed).getTime()) > THREE_DAYS_MS
  })

  const todayDay = DAY_NAMES[new Date().getDay()]

  const active = allPrayers.filter(p => p.answered === 0)
  const answered = allPrayers.filter(p => p.answered === 1)

  const dueToday = active.filter(p => {
    if (p.schedule === 'daily') return true
    const days = p.schedule.split(',').map(d => d.trim().toLowerCase())
    return days.includes(todayDay)
  })

  const notToday = active.filter(p => {
    if (p.schedule === 'daily') return false
    const days = p.schedule.split(',').map(d => d.trim().toLowerCase())
    return !days.includes(todayDay)
  })

  return (
    <div>
      <PrayerClient
        dueToday={dueToday}
        notToday={notToday}
        answered={answered}
        allActive={active}
        todayDay={todayDay}
        oikosPeople={oikosPeople}
        oikosNeedPrayer={oikosNeedPrayer}
      />
    </div>
  )
}
