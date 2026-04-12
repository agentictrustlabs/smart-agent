import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { ActivitiesClient } from './ActivitiesClient'

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  if (!selectedOrg) {
    return (
      <div data-page="activities">
        <div data-component="page-header"><h1>Activities</h1><p>Select an organization to view activities.</p></div>
      </div>
    )
  }

  const templateId = (selectedOrg as Record<string, unknown>).templateId as string | null

  // Load activities for this org
  // For movement networks, show all activities from child teams too
  const allOrgs = await db.select().from(schema.orgAgents)
  let activities = await db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.orgAddress, selectedOrg.smartAccountAddress.toLowerCase()))

  // If movement network, also include child team activities
  if (templateId === 'movement-network') {
    const allActivities = await db.select().from(schema.activityLogs)
    const childTeamOrgs = allOrgs.filter(o => (o as Record<string, unknown>).templateId === 'church-planting-team')
    for (const team of childTeamOrgs) {
      const teamActivities = allActivities.filter(a => a.orgAddress === team.smartAccountAddress.toLowerCase())
      activities = [...activities, ...teamActivities]
    }
  }

  // User names
  const allUsers = await db.select().from(schema.users)
  const userNames: Record<string, string> = {}
  for (const u of allUsers) userNames[u.id] = u.name

  // Activity type labels
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

  return (
    <div data-page="activities">
      <div data-component="page-header">
        <h1>Activities{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
        <p>Log and track field activities, visits, meetings, and outreach.</p>
      </div>

      {/* Summary */}
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
        orgAddress={selectedOrg.smartAccountAddress}
        orgName={selectedOrg.name}
      />
    </div>
  )
}
