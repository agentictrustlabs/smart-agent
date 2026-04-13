import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { db, schema } from '@/db'
import { ActivitiesClient } from './ActivitiesClient'

export default async function ActivitiesPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)

  if (userOrgs.length === 0) {
    return (
      <div data-page="activities">
        <div data-component="page-header"><h1>Activities</h1><p>No organizations found.</p></div>
      </div>
    )
  }

  // Load activities across all user orgs + child orgs
  const orgAddresses = new Set(userOrgs.map(o => o.address.toLowerCase()))

  // Include child orgs via on-chain edges
  const { getConnectedOrgs } = await import('@/lib/get-org-members')
  for (const org of userOrgs) {
    try {
      const children = await getConnectedOrgs(org.address)
      for (const child of children) orgAddresses.add(child.address.toLowerCase())
    } catch { /* ignored */ }
  }

  const allActivities = await db.select().from(schema.activityLogs)
  const activities = allActivities.filter(a => orgAddresses.has(a.orgAddress.toLowerCase()))

  // User names
  const allUsers = await db.select().from(schema.users)
  const userNames: Record<string, string> = {}
  for (const u of allUsers) userNames[u.id] = u.name

  const TYPE_LABELS: Record<string, string> = {
    meeting: 'Meeting', visit: 'Visit', training: 'Training', outreach: 'Outreach',
    'follow-up': 'Follow-up', assessment: 'Assessment', coaching: 'Coaching',
    prayer: 'Prayer', service: 'Service', other: 'Other',
  }

  // Summary stats
  const thisWeek = new Date()
  thisWeek.setDate(thisWeek.getDate() - 7)
  const recentActivities = activities.filter(a => new Date(a.activityDate) >= thisWeek)
  const totalParticipants = activities.reduce((s, a) => s + a.participants, 0)
  const totalHours = Math.round(activities.reduce((s, a) => s + (a.durationMinutes ?? 0), 0) / 60)

  // Use first org for activity logging
  const primaryOrg = userOrgs[0]

  return (
    <div data-page="activities">
      <div data-component="page-header">
        <h1>Activities</h1>
        <p>Log and track field activities, visits, meetings, and outreach.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1565c0' }}>{activities.length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Total Activities</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#7c3aed' }}>{recentActivities.length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>This Week</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0d9488' }}>{totalParticipants}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Total Participants</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#ea580c' }}>{totalHours}h</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Total Hours</div>
        </div>
      </div>

      <ActivitiesClient
        activities={activities.map(a => ({
          ...a,
          userName: userNames[a.userId] ?? 'Unknown',
          typeLabel: TYPE_LABELS[a.activityType] ?? a.activityType,
        }))}
        orgAddress={primaryOrg.address}
        orgName={primaryOrg.name}
      />
    </div>
  )
}
