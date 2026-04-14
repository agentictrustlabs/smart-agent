import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getActivityLog, type ActivityEntry } from '@/lib/agent-resolver'
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

  const { getConnectedOrgs } = await import('@/lib/get-org-members')
  for (const org of userOrgs) {
    try {
      const children = await getConnectedOrgs(org.address)
      for (const child of children) orgAddresses.add(child.address.toLowerCase())
    } catch { /* ignored */ }
  }

  // Fetch activities from on-chain resolver (per-org JSON property)
  const allActivities: (ActivityEntry & { orgAddress: string })[] = []
  for (const addr of orgAddresses) {
    try {
      const orgActivities = await getActivityLog(addr)
      for (const a of orgActivities) allActivities.push({ ...a, orgAddress: addr })
    } catch { /* ignored */ }
  }

  const TYPE_LABELS: Record<string, string> = {
    entry: 'Entry', evangelism: 'Evangelism', discipleship: 'Discipleship',
    formation: 'Formation', leadership: 'Leadership', prayer: 'Prayer',
    service: 'Service', other: 'Other',
    // Legacy labels
    meeting: 'Meeting', visit: 'Visit', training: 'Training', outreach: 'Outreach',
    'follow-up': 'Follow-up', assessment: 'Assessment', coaching: 'Coaching',
  }

  // Summary stats
  const thisWeek = new Date()
  thisWeek.setDate(thisWeek.getDate() - 7)
  const recentActivities = allActivities.filter(a => new Date(a.date) >= thisWeek)
  const totalParticipants = allActivities.reduce((s, a) => s + (a.participants ?? 0), 0)
  const totalHours = Math.round(allActivities.reduce((s, a) => s + (a.duration ?? 0), 0) / 60)

  const primaryOrg = userOrgs[0]

  return (
    <div data-page="activities">
      <div data-component="page-header">
        <h1>Activities</h1>
        <p>Log and track field activities, visits, meetings, and outreach.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1565c0' }}>{allActivities.length}</div>
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
        activities={allActivities.map(a => ({
          id: a.id,
          userId: a.createdBy,
          userName: a.createdBy,
          activityType: a.type,
          typeLabel: TYPE_LABELS[a.type] ?? a.type,
          title: a.title,
          description: a.notes ?? a.description ?? null,
          participants: a.participants ?? 0,
          location: a.location ?? null,
          durationMinutes: a.duration ?? null,
          activityDate: a.date,
          createdAt: a.createdAt,
          chainedFrom: a.chainedFrom ?? null,
          peopleGroup: a.peopleGroup ?? null,
        }))}
        orgAddress={primaryOrg.address}
        orgName={primaryOrg.name}
      />
    </div>
  )
}
