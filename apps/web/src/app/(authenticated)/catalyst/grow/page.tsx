import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { getTrainingProgress } from '@/lib/actions/grow.action'
import { GrowClient } from './GrowClient'

export default async function GrowPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const progress = await getTrainingProgress(currentUser.id)

  // Count churches from user's orgs
  const userOrgs = await getUserOrgs(currentUser.id)
  let churchCount = 0
  for (const org of userOrgs) {
    try {
      const connected = await getConnectedOrgs(org.address)
      churchCount += connected.filter((c) => Boolean(c.metadata?.isChurch)).length
    } catch {
      /* ignored */
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: '#5c4a3a' }}>Grow</h1>
        <p style={{ fontSize: '0.85rem', color: '#9a8c7e', margin: 0 }}>
          Track your discipleship journey and spiritual growth.
        </p>
      </div>
      <GrowClient progress={progress} churchCount={churchCount} />
    </div>
  )
}
