import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { db, schema } from '@/db'

export default async function CatalystDashboardPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)

  // Aggregate stats
  let totalGroups = 0
  let established = 0
  const orgAddresses = new Set(userOrgs.map(o => o.address.toLowerCase()))

  for (const org of userOrgs) {
    try {
      const connected = await getConnectedOrgs(org.address)
      totalGroups += connected.length
      established += connected.filter(c => Boolean(c.metadata?.isChurch)).length
      for (const c of connected) orgAddresses.add(c.address.toLowerCase())
    } catch { /* ignored */ }
  }

  const allActivities = await db.select().from(schema.activityLogs)
  const activities = allActivities.filter(a => orgAddresses.has(a.orgAddress.toLowerCase()))
  const thisWeek = new Date(); thisWeek.setDate(thisWeek.getDate() - 7)
  const weekCount = activities.filter(a => new Date(a.activityDate) >= thisWeek).length
  const totalParticipants = activities.reduce((s, a) => s + a.participants, 0)

  const allUsers = await db.select().from(schema.users)
  const userNames: Record<string, string> = {}
  for (const u of allUsers) userNames[u.id] = u.name

  const recentActivities = activities
    .sort((a, b) => b.activityDate.localeCompare(a.activityDate))
    .slice(0, 5)

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Catalyst Network</h1>
        <p style={{ fontSize: '0.85rem', color: '#616161', margin: 0 }}>
          Field overview for {currentUser.name}. {userOrgs.length} organization{userOrgs.length !== 1 ? 's' : ''}.
        </p>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Groups', value: totalGroups + userOrgs.length, color: '#0d9488' },
          { label: 'Established', value: established, color: '#2e7d32' },
          { label: 'This Week', value: weekCount, color: '#7c3aed' },
          { label: 'Participants', value: totalParticipants, color: '#1565c0' },
        ].map(s => (
          <div key={s.label} style={{ padding: '0.75rem', borderRadius: 8, textAlign: 'center', background: `${s.color}08`, border: `1px solid ${s.color}20` }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.75rem', color: '#616161' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <Link href="/catalyst/activities" style={{ padding: '0.5rem 1rem', background: '#0d9488', color: '#fff', borderRadius: 6, fontWeight: 600, textDecoration: 'none', fontSize: '0.85rem' }}>Log Activity</Link>
        <Link href="/catalyst/groups" style={{ padding: '0.5rem 1rem', background: '#fff', color: '#0d9488', border: '1px solid #0d9488', borderRadius: 6, fontWeight: 600, textDecoration: 'none', fontSize: '0.85rem' }}>View Groups</Link>
        <Link href="/catalyst/members" style={{ padding: '0.5rem 1rem', background: '#fff', color: '#0d9488', border: '1px solid #0d9488', borderRadius: 6, fontWeight: 600, textDecoration: 'none', fontSize: '0.85rem' }}>Members</Link>
        <Link href="/catalyst/map" style={{ padding: '0.5rem 1rem', background: '#fff', color: '#0d9488', border: '1px solid #0d9488', borderRadius: 6, fontWeight: 600, textDecoration: 'none', fontSize: '0.85rem' }}>Map</Link>
      </div>

      {/* Recent activities */}
      {recentActivities.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>Recent Activities</h2>
            <Link href="/catalyst/activities" style={{ color: '#0d9488', fontSize: '0.8rem', fontWeight: 600 }}>View all</Link>
          </div>
          <div style={{ display: 'grid', gap: '0.35rem' }}>
            {recentActivities.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: '#fafafa', borderRadius: 6, border: '1px solid #f0f1f3' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#0d9488', width: 70, flexShrink: 0 }}>{a.activityType}</span>
                <strong style={{ fontSize: '0.8rem', flex: 1 }}>{a.title}</strong>
                <span style={{ fontSize: '0.7rem', color: '#616161' }}>{userNames[a.userId] ?? 'Unknown'}</span>
                <span style={{ fontSize: '0.65rem', color: '#9e9e9e' }}>{a.activityDate}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Your organizations */}
      <section>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Your Organizations</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.75rem' }}>
          {userOrgs.map(org => (
            <div key={org.address} style={{ padding: '0.75rem', background: '#fff', borderRadius: 8, border: '1px solid #e2e4e8', borderLeft: '4px solid #0d9488' }}>
              <Link href={`/agents/${org.address}`} style={{ fontWeight: 700, color: '#1565c0', fontSize: '0.9rem' }}>{org.name}</Link>
              {org.description && <p style={{ fontSize: '0.75rem', color: '#616161', margin: '0.25rem 0 0' }}>{org.description}</p>}
              <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.35rem' }}>
                {org.roles.map(r => <span key={r} style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem', background: '#0d948810', color: '#0d9488', borderRadius: 3, fontWeight: 600 }}>{r}</span>)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
