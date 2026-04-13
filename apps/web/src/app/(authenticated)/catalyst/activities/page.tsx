import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { db, schema } from '@/db'
import { ActivityFeed } from '@/components/catalyst/ActivityFeed'

export default async function CatalystActivitiesPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)
  if (userOrgs.length === 0) return <p>No organizations found.</p>

  // Collect activities across all user orgs + child orgs
  const orgAddresses = new Set(userOrgs.map(o => o.address.toLowerCase()))
  const { getConnectedOrgs } = await import('@/lib/get-org-members')
  for (const org of userOrgs) {
    try {
      const children = await getConnectedOrgs(org.address)
      for (const c of children) orgAddresses.add(c.address.toLowerCase())
    } catch { /* ignored */ }
  }

  const allActivities = await db.select().from(schema.activityLogs)
  const activities = allActivities
    .filter(a => orgAddresses.has(a.orgAddress.toLowerCase()))
    .sort((a, b) => b.activityDate.localeCompare(a.activityDate))

  const allUsers = await db.select().from(schema.users)
  const userNames: Record<string, string> = {}
  for (const u of allUsers) userNames[u.id] = u.name

  const TYPE_LABELS: Record<string, string> = {
    outreach: 'Entry', visit: 'Evangelism', training: 'Discipleship',
    meeting: 'Formation', coaching: 'Leadership',
    'follow-up': 'Follow-up', assessment: 'Assessment', prayer: 'Prayer',
    service: 'Service', other: 'Other',
  }

  // Stats
  const thisWeek = new Date(); thisWeek.setDate(thisWeek.getDate() - 7)
  const weekCount = activities.filter(a => new Date(a.activityDate) >= thisWeek).length
  const totalParticipants = activities.reduce((s, a) => s + a.participants, 0)

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Activities</h1>
        <p style={{ fontSize: '0.85rem', color: '#616161', margin: 0 }}>
          Log field activities following the Entry → Evangelism → Discipleship → Formation → Leadership pipeline.
        </p>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ padding: '0.5rem 1rem', background: '#0d948808', borderRadius: 6, border: '1px solid #0d948820', textAlign: 'center' }}>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0d9488' }}>{activities.length}</div>
          <div style={{ fontSize: '0.7rem', color: '#616161' }}>Total</div>
        </div>
        <div style={{ padding: '0.5rem 1rem', background: '#7c3aed08', borderRadius: 6, border: '1px solid #7c3aed20', textAlign: 'center' }}>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#7c3aed' }}>{weekCount}</div>
          <div style={{ fontSize: '0.7rem', color: '#616161' }}>This Week</div>
        </div>
        <div style={{ padding: '0.5rem 1rem', background: '#1565c008', borderRadius: 6, border: '1px solid #1565c020', textAlign: 'center' }}>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1565c0' }}>{totalParticipants}</div>
          <div style={{ fontSize: '0.7rem', color: '#616161' }}>Participants</div>
        </div>
      </div>

      <ActivityFeed
        activities={activities.map(a => ({
          ...a,
          userName: userNames[a.userId] ?? 'Unknown',
          typeLabel: TYPE_LABELS[a.activityType] ?? a.activityType,
        }))}
        orgAddress={userOrgs[0].address}
        orgName={userOrgs[0].name}
      />
    </div>
  )
}
