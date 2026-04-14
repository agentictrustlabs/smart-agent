import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPrayers } from '@/lib/actions/prayer.action'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { PrayerClient } from './PrayerClient'

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export default async function CatalystPrayerPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  let allPrayers: Awaited<ReturnType<typeof getPrayers>> = []
  try {
    allPrayers = await getPrayers(currentUser.id)
  } catch { /* table may not exist */ }

  // Fetch oikos circles
  let oikosPeople: Array<{id: string, personName: string}> = []
  try {
    const oikosRows = await db.select().from(schema.circles).where(eq(schema.circles.userId, currentUser.id))
    oikosPeople = oikosRows.map(r => ({ id: r.id, personName: r.personName }))
  } catch { /* ignored */ }

  // Compute "Pray for Oikos" list: oikos people with no linked prayer or lastPrayed > 3 days
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const activePrayers = allPrayers.filter(p => p.answered === 0)
  const oikosNeedPrayer = oikosPeople.filter(person => {
    const linkedPrayer = activePrayers.find(p => p.linkedOikosId === person.id)
    if (!linkedPrayer) return true // no linked prayer at all
    if (!linkedPrayer.lastPrayed) return true // never prayed
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
