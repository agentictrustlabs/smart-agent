import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPrayers } from '@/lib/actions/prayer.action'
import { PrayerClient } from './PrayerClient'

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export default async function CatalystPrayerPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const allPrayers = await getPrayers(currentUser.id)

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
      />
    </div>
  )
}
