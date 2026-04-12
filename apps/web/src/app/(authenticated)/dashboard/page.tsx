import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { toDidEthr } from '@smart-agent/sdk'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { getOrgTemplate } from '@/lib/org-templates.data'
import { getOrgMembers } from '@/lib/get-org-members'
import { isCpmTemplate } from '@/lib/cpm'
import { DashboardAnalytics } from './DashboardAnalytics'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  const personAgents = await db.select().from(schema.personAgents)
    .where(eq(schema.personAgents.userId, currentUser.id)).limit(1)
  const personAgent = personAgents[0]

  // Load data scoped to selected org
  const { members, partners } = selectedOrg
    ? await getOrgMembers(selectedOrg.smartAccountAddress)
    : { members: [], partners: [] }

  const allAI = await db.select().from(schema.aiAgents)
  const aiAgents = selectedOrg
    ? allAI.filter(a => a.operatedBy?.toLowerCase() === selectedOrg.smartAccountAddress.toLowerCase())
    : []

  const template = selectedOrg ? getOrgTemplate((selectedOrg as Record<string, unknown>).templateId as string ?? '') : null
  const templateId = (selectedOrg as Record<string, unknown> | null)?.templateId as string ?? ''
  const showAnalytics = isCpmTemplate(templateId)
  const overviewStats = selectedOrg ? [
    { label: 'Members', value: String(members.length) },
    { label: 'Relationships', value: String(partners.length) },
    { label: 'AI Agents', value: String(aiAgents.length) },
    { label: 'Template', value: template?.name ?? 'Custom' },
  ] : []
  const quickLinks = selectedOrg ? [
    { href: `/team?org=${selectedOrg.smartAccountAddress}`, label: 'Manage Team' },
    { href: `/agents?org=${selectedOrg.smartAccountAddress}`, label: 'View Agents' },
    { href: `/network?org=${selectedOrg.smartAccountAddress}`, label: 'Open Network' },
    { href: `/treasury?org=${selectedOrg.smartAccountAddress}`, label: 'Treasury' },
    { href: `/reviews?org=${selectedOrg.smartAccountAddress}`, label: 'Reviews' },
  ] : []

  // Load analytics data for CPM/Catalyst templates
  let analyticsData = null
  if (showAnalytics && selectedOrg) {
    const allActivities = await db.select().from(schema.activityLogs)
    const allOrgs = await db.select().from(schema.orgAgents)
    const allUsers = await db.select().from(schema.users)
    const userNames: Record<string, string> = {}
    for (const u of allUsers) userNames[u.id] = u.name

    // Get activities for this org + child teams
    let orgActivities = allActivities.filter(a => a.orgAddress === selectedOrg.smartAccountAddress.toLowerCase())
    if (['catalyst-network', 'movement-network'].includes(templateId)) {
      const childTemplates = ['facilitator-hub', 'church-planting-team']
      const childOrgs = allOrgs.filter(o => childTemplates.includes((o as Record<string, unknown>).templateId as string ?? ''))
      for (const child of childOrgs) {
        orgActivities = [...orgActivities, ...allActivities.filter(a => a.orgAddress === child.smartAccountAddress.toLowerCase())]
      }
    }

    // Gen map stats
    const allGenNodes = await db.select().from(schema.genMapNodes)
    const genNodes = allGenNodes.filter(n => n.networkAddress === selectedOrg.smartAccountAddress.toLowerCase())
    const nodes = genNodes

    analyticsData = {
      activities: orgActivities.map(a => ({ date: a.activityDate, count: 1, participants: a.participants, type: a.activityType })),
      genMapStats: {
        totalGroups: nodes.length,
        maxGen: nodes.reduce((max, n) => Math.max(max, n.generation), 0),
        established: nodes.filter(n => { try { return JSON.parse(n.healthData ?? '{}').isChurch } catch { return false } }).length,
        multiplyRate: nodes.length > 0 ? nodes.filter(n => { try { return JSON.parse(n.healthData ?? '{}').groupsStarted > 0 } catch { return false } }).length / nodes.length : 0,
      },
      recentActivities: orgActivities
        .sort((a, b) => b.activityDate.localeCompare(a.activityDate))
        .slice(0, 6)
        .map(a => ({ title: a.title, type: a.activityType, date: a.activityDate, userName: userNames[a.userId] ?? 'Unknown', location: a.location })),
    }
  }

  return (
    <div data-page="dashboard">
      <div data-component="page-header">
        <h1>{selectedOrg ? selectedOrg.name : 'Dashboard'}</h1>
        <p>
          {selectedOrg
            ? `${selectedOrg.description || `Welcome, ${currentUser.name} — managing ${selectedOrg.name}`}`
            : `Welcome, ${currentUser.name}`}
        </p>
      </div>

      {!selectedOrg && !personAgent && (
        <div data-component="empty-state">
          <h2>Welcome</h2>
          <p>
            Get started by creating your organization or joining an existing one.
          </p>
          <div data-component="dashboard-actions" style={{ justifyContent: 'center' }}>
            <Link href="/setup"><button>New Organization</button></Link>
            <Link href="/setup/join"><button style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Join Organization</button></Link>
            <Link href="/deploy/person"><button style={{ background: 'transparent', border: '1px solid #e2e4e8', color: '#1a1a2e' }}>Create Personal Account</button></Link>
          </div>
        </div>
      )}

      {selectedOrg && (
        <>
          <section data-component="dashboard-hero">
            <div data-component="dashboard-hero-top">
              <div data-component="dashboard-hero-copy">
                <div data-component="dashboard-meta">
                  <span data-component="role-badge" data-status="active">{template?.name ?? 'Custom org'}</span>
                  <span data-component="role-badge">{showAnalytics ? 'Analytics Enabled' : 'Operational Overview'}</span>
                </div>
                <p data-component="text-muted">
                  Smart account: <span data-component="address">{selectedOrg.smartAccountAddress}</span>
                </p>
              </div>
              <div data-component="dashboard-meta">
                <span data-component="role-badge">{currentUser.name}</span>
              </div>
            </div>
            <div data-component="dashboard-kpi-grid">
              {overviewStats.map((stat) => (
                <div key={stat.label} data-component="dashboard-kpi">
                  <div data-component="dashboard-kpi-value">{stat.value}</div>
                  <div data-component="dashboard-kpi-label">{stat.label}</div>
                </div>
              ))}
            </div>
            <div data-component="dashboard-actions">
              {quickLinks.map((link) => (
                <Link key={link.href} href={link.href} data-component="dashboard-action">
                  {link.label}
                </Link>
              ))}
            </div>
          </section>

          {/* Analytics (CPM/Catalyst templates) */}
          {showAnalytics && analyticsData && (
            <DashboardAnalytics
              activities={analyticsData.activities}
              genMapStats={analyticsData.genMapStats}
              recentActivities={analyticsData.recentActivities}
            />
          )}

          <div data-component="dashboard-section-grid">
            <section data-component="graph-section">
              <div data-component="section-header">
                <h2>Members ({members.length})</h2>
                <Link href={`/team?org=${selectedOrg.smartAccountAddress}`} data-component="section-action">Manage</Link>
              </div>
              {members.length === 0 ? (
                <p data-component="text-muted">No members yet. <Link href={`/team?org=${selectedOrg.smartAccountAddress}`}>Invite people</Link>.</p>
              ) : (
                <div data-component="table-wrap">
                  <table data-component="graph-table">
                    <thead><tr><th>Name</th><th>Roles</th><th>Status</th></tr></thead>
                    <tbody>
                      {members.map(m => (
                        <tr key={m.address}>
                          <td><Link href={`/agents/${m.address}`}>{m.name}</Link></td>
                          <td>{m.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}</td>
                          <td><span data-component="role-badge" data-status={m.status === 'Active' ? 'active' : 'proposed'}>{m.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section data-component="graph-section">
              <div data-component="section-header">
                <h2>Relationships ({partners.length})</h2>
                <Link href={`/network?org=${selectedOrg.smartAccountAddress}`} data-component="section-action">Network</Link>
              </div>
              {partners.length === 0 ? (
                <p data-component="text-muted">No relationships yet. <Link href={`/relationships?org=${selectedOrg.smartAccountAddress}`}>Add one</Link>.</p>
              ) : (
                <div data-component="table-wrap">
                  <table data-component="graph-table">
                    <thead><tr><th>Entity</th><th>Roles</th><th>Status</th></tr></thead>
                    <tbody>
                      {partners.map(p => (
                        <tr key={p.address}>
                          <td><Link href={`/agents/${p.address}`}>{p.name}</Link></td>
                          <td>{p.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}</td>
                          <td><span data-component="role-badge" data-status={p.status === 'Active' ? 'active' : 'proposed'}>{p.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {aiAgents.length > 0 && (
            <section data-component="graph-section">
              <div data-component="section-header">
                <h2>AI Agents ({aiAgents.length})</h2>
                <Link href={`/agents?org=${selectedOrg.smartAccountAddress}`} data-component="section-action">View All</Link>
              </div>
              <div data-component="agent-grid">
                {aiAgents.map(agent => (
                  <div key={agent.id} data-component="agent-card" data-status={agent.status}>
                    <div data-component="agent-card-header">
                      <h3>{agent.name}</h3>
                      <span data-component="role-badge">{agent.agentType}</span>
                    </div>
                    {agent.description && <p data-component="card-description">{agent.description}</p>}
                    <Link href={`/agents/${agent.smartAccountAddress}`} data-component="section-action">View Agent</Link>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {personAgent && (
        <section data-component="graph-section">
          <h2>Your Agent</h2>
          <div data-component="protocol-info">
            <dl>
              <dt>Smart Account</dt>
              <dd data-component="address">{personAgent.smartAccountAddress}</dd>
              <dt>DID</dt>
              <dd data-component="did">{toDidEthr(CHAIN_ID, personAgent.smartAccountAddress as `0x${string}`)}</dd>
              <dt>Status</dt>
              <dd data-status={personAgent.status}>{personAgent.status}</dd>
            </dl>
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
              <Link href={`/agents/${personAgent.smartAccountAddress}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
              <Link href={`/agents/${personAgent.smartAccountAddress}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
