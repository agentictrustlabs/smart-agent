import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { db, schema } from '@/db'
import { ActivityFeed } from '@/components/catalyst/ActivityFeed'
import { getUserHubId } from '@/lib/get-user-hub'

export default async function CatalystActivitiesPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // ── CIL Revenue branch ───────────────────────────────────────────────
  const isCIL = (await getUserHubId(currentUser.id)) === 'cil'
  if (isCIL) {
    const { getMCRole, getBusinessOrgAddressesForUser } = await import('@/lib/mc-roles')
    const { RevenuePageClient } = await import('@/components/mc/RevenuePageClient')
    const { getAgentMetadata } = await import('@/lib/agent-metadata')

    const role = getMCRole(currentUser.id)
    const allowedAddrs = getBusinessOrgAddressesForUser(currentUser.id)

    // Get all revenue reports
    let allReports = await db.select().from(schema.revenueReports)

    // Role-based filtering
    if (role === 'business-owner' && allowedAddrs) {
      // Business owners see only their own
      const lowerAddrs = new Set(allowedAddrs.map(a => a.toLowerCase()))
      allReports = allReports.filter(r => lowerAddrs.has(r.orgAddress.toLowerCase()))
    } else if (role === 'funder') {
      // Funders see only verified reports
      allReports = allReports.filter(r => r.status === 'verified')
    }
    // ilad-ops, admin, reviewer, local-manager see all

    // User names
    const allUsers = await db.select().from(schema.users)
    const userNames: Record<string, string> = {}
    for (const u of allUsers) userNames[u.id] = u.name

    // Business names from agent metadata
    const bizNames: Record<string, string> = {}
    const uniqueAddrs = new Set(allReports.map(r => r.orgAddress.toLowerCase()))
    for (const addr of uniqueAddrs) {
      try {
        const meta = await getAgentMetadata(addr)
        bizNames[addr] = meta.displayName
      } catch {
        bizNames[addr] = addr.slice(0, 10) + '...'
      }
    }

    // Compute stats
    const now = new Date()
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const thisMonthReports = allReports.filter(r => r.period === currentPeriod)
    const pendingCount = allReports.filter(r => r.status === 'submitted').length
    const totalRevenue = allReports.reduce((s, r) => s + r.grossRevenue, 0)
    const totalSharePayments = allReports.reduce((s, r) => s + r.sharePayment, 0)

    const reports = allReports
      .sort((a, b) => b.period.localeCompare(a.period))
      .map(r => ({
        id: r.id,
        orgAddress: r.orgAddress,
        businessName: bizNames[r.orgAddress.toLowerCase()] ?? r.orgAddress.slice(0, 10) + '...',
        period: r.period,
        grossRevenue: r.grossRevenue,
        expenses: r.expenses,
        netRevenue: r.netRevenue,
        sharePayment: r.sharePayment,
        currency: r.currency,
        status: r.status,
        submittedBy: r.submittedBy,
        submitterName: userNames[r.submittedBy] ?? 'Unknown',
        notes: r.notes,
      }))

    // User org address for submit form
    const userOrgs = await getUserOrgs(currentUser.id)
    const userOrgAddress = allowedAddrs?.[0] ?? userOrgs[0]?.address ?? ''

    return (
      <RevenuePageClient
        reports={reports}
        stats={{
          total: thisMonthReports.length,
          pending: pendingCount,
          totalRevenue,
          totalSharePayments,
        }}
        role={role}
        userOrgAddress={userOrgAddress}
      />
    )
  }
  // ── End CIL Revenue branch ───────────────────────────────────────────

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

  // Build set of user IDs in the same org network — query by org membership, not ID prefix
  const orgUserIds = new Set<string>()
  orgUserIds.add(currentUser.id)

  const allActivities = await db.select().from(schema.activityLogs)
  const activities = allActivities
    .filter(a => orgAddresses.has(a.orgAddress.toLowerCase()) || orgUserIds.has(a.userId))
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

  // Compute hours
  const totalHours = Math.round(activities.reduce((s, a) => s + (a.durationMinutes ?? 0), 0) / 60)

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: '#5c4a3a' }}>Activity</h1>
        <p style={{ fontSize: '0.85rem', color: '#9a8c7e', margin: 0 }}>
          Field activities across the NoCo network — outreach, visits, meetings, coaching, and more.
        </p>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Total', value: activities.length, color: '#8b5e3c' },
          { label: 'This Week', value: weekCount, color: '#7c3aed' },
          { label: 'Participants', value: totalParticipants, color: '#0d9488' },
          { label: 'Hours', value: totalHours, color: '#1565c0' },
        ].map(s => (
          <div key={s.label} style={{
            padding: '0.6rem 0.75rem', background: '#fff', borderRadius: 10,
            border: '1px solid #ece6db', textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.72rem', color: '#9a8c7e' }}>{s.label}</div>
          </div>
        ))}
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
