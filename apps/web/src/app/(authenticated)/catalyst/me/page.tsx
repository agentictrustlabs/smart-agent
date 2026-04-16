import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserPreferences, getCoachRelationship } from '@/lib/actions/grow.action'
import { ProfileClient } from './ProfileClient'

export default async function ProfilePage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const prefs = await getUserPreferences(currentUser.id)
  const coachRel = await getCoachRelationship(currentUser.id)

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: '#5c4a3a' }}>My Profile</h1>
        <p style={{ fontSize: '0.85rem', color: '#9a8c7e', margin: 0 }}>
          Manage your personal settings and preferences.
        </p>
      </div>
      <ProfileClient
        userId={currentUser.id}
        userName={currentUser.name}
        email={currentUser.email}
        location={prefs?.location ?? null}
        homeChurch={prefs?.homeChurch ?? null}
        language={prefs?.language ?? 'en'}
        coach={coachRel ? { coachName: coachRel.coachName, sharePermissions: coachRel.sharePermissions } : null}
      />
    </div>
  )
}
