import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db, schema } from '@/db'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { toDidEthr } from '@smart-agent/sdk'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { getOrgMembers } from '@/lib/get-org-members'
import { DashboardAnalytics } from './DashboardAnalytics'
import { buildDefaultAgentContexts, getHubIdForTemplate, getHubProfile } from '@/lib/hub-profiles'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  const { getPersonAgentForUser, getAiAgentsForOrg } = await import('@/lib/agent-registry')
  const { getAgentMetadata: getMeta } = await import('@/lib/agent-metadata')

  const personAgentAddr = await getPersonAgentForUser(currentUser.id)
  let personAgent: { smartAccountAddress: string; name: string } | null = null
  if (personAgentAddr) {
    const pMeta = await getMeta(personAgentAddr)
    personAgent = { smartAccountAddress: personAgentAddr, name: pMeta.displayName }
  }

  // Load data scoped to selected org (on-chain edges)
  const { members, partners } = selectedOrg
    ? await getOrgMembers(selectedOrg.smartAccountAddress)
    : { members: [], partners: [] }
  const aiAgentAddrs = selectedOrg ? await getAiAgentsForOrg(selectedOrg.smartAccountAddress) : []
  const aiAgents = await Promise.all(aiAgentAddrs.map(async addr => {
    const meta = await getMeta(addr)
    return { id: addr, name: meta.displayName, description: meta.description, agentType: meta.aiAgentClass || 'custom', smartAccountAddress: addr, status: 'deployed' }
  }))

  // Check if org has child orgs (ALLIANCE edges) → show analytics
  let showAnalytics = false
  if (selectedOrg) {
    try {
      const { getEdgesBySubject: checkEdges } = await import('@/lib/contracts')
      const outEdges = await checkEdges(selectedOrg.smartAccountAddress as `0x${string}`)
      showAnalytics = outEdges.length > 0
    } catch { /* ignored */ }
  }

  // Get agent type label from resolver
  const orgMeta = selectedOrg ? await getMeta(selectedOrg.smartAccountAddress) : null
  const hubId = getHubIdForTemplate(selectedOrg?.templateId)
  const hubProfile = getHubProfile(hubId)
  const derivedCapabilities = [
    'network',
    'agents',
    'reviews',
    ...(showAnalytics ? ['genmap', 'activities', 'members'] : []),
    ...(aiAgents.length > 0 ? ['treasury'] : []),
  ]
  const agentContexts = selectedOrg ? buildDefaultAgentContexts({
    orgAddress: selectedOrg.smartAccountAddress,
    orgName: selectedOrg.name,
    orgDescription: selectedOrg.description,
    hubId,
    capabilities: derivedCapabilities,
    aiAgentCount: aiAgents.length,
  }) : []
  const requestedContextId = typeof params.context === 'string' ? params.context : undefined
  const activeContext = agentContexts.find(context => context.id === requestedContextId)
    ?? agentContexts.find(context => context.isDefault)
    ?? agentContexts[0]
    ?? null
  const makeScopedHref = (pathname: string) => {
    const nextParams = new URLSearchParams()
    if (selectedOrg) nextParams.set('org', selectedOrg.smartAccountAddress)
    if (hubId) nextParams.set('hub', hubId)
    if (activeContext) nextParams.set('context', activeContext.id)
    const query = nextParams.toString()
    return query ? `${pathname}?${query}` : pathname
  }
  const overviewStats = selectedOrg ? [
    { label: 'Members', value: String(members.length) },
    { label: 'Relationships', value: String(partners.length) },
    { label: 'AI Agents', value: String(aiAgents.length) },
    { label: 'Context', value: activeContext?.kind ?? hubProfile.contextTerm },
  ] : []
  const quickLinks = selectedOrg ? [
    { href: makeScopedHref('/contexts'), label: hubProfile.contextsLabel },
    { href: makeScopedHref('/agents'), label: hubProfile.agentLabel },
    { href: makeScopedHref('/network'), label: hubProfile.networkLabel },
    { href: makeScopedHref('/treasury'), label: 'Treasury' },
    { href: makeScopedHref('/reviews'), label: 'Reviews' },
  ] : []

  // Load analytics data when org has child groups (on-chain ALLIANCE edges)
  let analyticsData = null
  if (showAnalytics && selectedOrg) {
    const allActivities = await db.select().from(schema.activityLogs)
    const allUsers = await db.select().from(schema.users)
    const userNames: Record<string, string> = {}
    for (const u of allUsers) userNames[u.id] = u.name

    // Get child orgs from on-chain edges
    const { getConnectedOrgs: getChildOrgs } = await import('@/lib/get-org-members')
    let childOrgs: Awaited<ReturnType<typeof getChildOrgs>> = []
    try { childOrgs = await getChildOrgs(selectedOrg.smartAccountAddress) } catch { /* ignored */ }

    // Get activities for this org + connected child orgs
    let orgActivities = allActivities.filter(a => a.orgAddress === selectedOrg.smartAccountAddress.toLowerCase())
    for (const child of childOrgs) {
      orgActivities = [...orgActivities, ...allActivities.filter(a => a.orgAddress === child.address.toLowerCase())]
    }

    analyticsData = {
      activities: orgActivities.map(a => ({ date: a.activityDate, count: 1, participants: a.participants, type: a.activityType })),
      genMapStats: {
        totalGroups: childOrgs.length,
        maxGen: 0,
        established: 0,
        multiplyRate: childOrgs.length > 0 ? 0.5 : 0,
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
        <h1>{activeContext?.name ?? selectedOrg?.name ?? hubProfile.overviewLabel}</h1>
        <p>
          {selectedOrg
            ? `${hubProfile.name} portal onto ${activeContext?.name ?? selectedOrg.name}. Anchor org: ${selectedOrg.name}.`
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
                  <span data-component="role-badge" data-status="active">{hubProfile.name}</span>
                  <span data-component="role-badge">{hubProfile.contextTerm}</span>
                  <span data-component="role-badge">{activeContext?.kind ?? 'context'}</span>
                </div>
                {activeContext?.description && <p data-component="text-muted">{activeContext.description}</p>}
                <p data-component="text-muted">
                  Anchor org: <span style={{ fontWeight: 600 }}>{selectedOrg.name}</span>
                </p>
                <p data-component="text-muted">
                  Smart account: <span data-component="address">{selectedOrg.smartAccountAddress}</span>
                </p>
              </div>
              <div data-component="dashboard-meta">
                <span data-component="role-badge">{currentUser.name}</span>
                <span data-component="role-badge">{orgMeta?.agentTypeLabel ?? 'Organization'}</span>
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

          {/* Analytics (orgs with child groups) */}
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
                <Link href={makeScopedHref('/team')} data-component="section-action">Manage</Link>
              </div>
              {members.length === 0 ? (
                <p data-component="text-muted">No members yet. <Link href={makeScopedHref('/team')}>Invite people</Link>.</p>
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
                <h2>{hubProfile.networkLabel} Relationships ({partners.length})</h2>
                <Link href={makeScopedHref('/network')} data-component="section-action">{hubProfile.networkLabel}</Link>
              </div>
              {partners.length === 0 ? (
                <p data-component="text-muted">No relationships yet. <Link href={makeScopedHref('/relationships')}>Add one</Link>.</p>
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
                <Link href={makeScopedHref('/agents')} data-component="section-action">View All</Link>
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
          <h2>Your Agent — {personAgent.name}</h2>
          <div data-component="protocol-info">
            <dl>
              <dt>Name</dt>
              <dd style={{ fontWeight: 600 }}>{personAgent.name}</dd>
              <dt>Smart Account</dt>
              <dd data-component="address">{personAgent.smartAccountAddress}</dd>
              <dt>DID</dt>
              <dd data-component="did">{toDidEthr(CHAIN_ID, personAgent.smartAccountAddress as `0x${string}`)}</dd>
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
