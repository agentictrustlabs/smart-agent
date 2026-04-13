import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { formatEther } from 'viem'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getOrgMembers } from '@/lib/get-org-members'

export default async function DashboardPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const { getPersonAgentForUser, getAiAgentsForOrg } = await import('@/lib/agent-registry')
  const { getAgentMetadata: getMeta } = await import('@/lib/agent-metadata')
  const { getPublicClient, getEdgesBySubject } = await import('@/lib/contracts')

  // Person agent
  const personAgentAddr = await getPersonAgentForUser(currentUser.id)
  const userOrgs = await getUserOrgs(currentUser.id)

  if (userOrgs.length === 0 && !personAgentAddr) {
    return (
      <div data-page="dashboard">
        <div data-component="page-header">
          <h1>Welcome, {currentUser.name}</h1>
          <p>Get started by creating your organization or joining an existing one.</p>
        </div>
        <div data-component="empty-state">
          <div data-component="dashboard-actions" style={{ justifyContent: 'center' }}>
            <Link href="/setup"><button>New Organization</button></Link>
            <Link href="/setup/join"><button style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Join Organization</button></Link>
            <Link href="/deploy/person"><button style={{ background: 'transparent', border: '1px solid #e2e4e8', color: '#1a1a2e' }}>Create Personal Account</button></Link>
          </div>
        </div>
      </div>
    )
  }

  // ─── Build role-based responsibility sections ───────────────────────

  // Collect all unique roles across orgs
  const allRoles = new Set<string>()
  for (const org of userOrgs) {
    for (const r of org.roles) allRoles.add(r.toLowerCase())
  }

  // Delegations granted to this user
  type DelegationView = { id: string; orgName: string; orgAddress: string; status: string; expiresAt: string; caveats: string[] }
  const activeDelegations: DelegationView[] = []
  if (personAgentAddr) {
    const delegations = await db.select().from(schema.reviewDelegations)
      .where(eq(schema.reviewDelegations.reviewerAgentAddress, personAgentAddr.toLowerCase()))
    const enforcerNames: Record<string, string> = {
      [process.env.TIMESTAMP_ENFORCER_ADDRESS?.toLowerCase() ?? '']: 'Time Window',
      [process.env.ALLOWED_METHODS_ENFORCER_ADDRESS?.toLowerCase() ?? '']: 'Allowed Methods',
      [process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS?.toLowerCase() ?? '']: 'Allowed Targets',
      [process.env.VALUE_ENFORCER_ADDRESS?.toLowerCase() ?? '']: 'Spending Limit',
    }
    for (const d of delegations) {
      const isExpired = new Date(d.expiresAt) < new Date()
      if (isExpired || d.status !== 'active') continue
      let caveats: string[] = []
      try {
        const parsed = JSON.parse(d.delegationJson)
        caveats = (parsed.caveats ?? []).map((c: { enforcer: string }) =>
          enforcerNames[c.enforcer?.toLowerCase()] ?? 'Custom'
        )
      } catch { /* ignored */ }
      const org = userOrgs.find(o => o.address.toLowerCase() === d.subjectAgentAddress.toLowerCase())
      activeDelegations.push({
        id: d.id,
        orgName: org?.name ?? d.subjectAgentAddress.slice(0, 10) + '...',
        orgAddress: d.subjectAgentAddress,
        status: 'active',
        expiresAt: new Date(d.expiresAt).toLocaleDateString(),
        caveats,
      })
    }
  }

  // ─── Gather data per responsibility area ────────────────────────────

  // Treasury: orgs where user has financial authority
  const client = getPublicClient()
  type TreasuryItem = { orgName: string; orgAddress: string; orgBalance: string; agentCount: number; agentBalance: string }
  const treasuryItems: TreasuryItem[] = []
  const financialRoles = ['owner', 'treasurer', 'authorized-signer']
  for (const org of userOrgs) {
    if (!org.roles.some(r => financialRoles.includes(r.toLowerCase()))) continue
    const orgBal = await client.getBalance({ address: org.address as `0x${string}` }).catch(() => 0n)
    const aiAddrs = await getAiAgentsForOrg(org.address)
    let agentBal = 0n
    let agentCount = 0
    for (const addr of aiAddrs) {
      const meta = await getMeta(addr)
      if (meta.displayName.toLowerCase().includes('treasury') || meta.aiAgentClass === 'executor') {
        agentBal += await client.getBalance({ address: addr as `0x${string}` }).catch(() => 0n)
        agentCount++
      }
    }
    treasuryItems.push({
      orgName: org.name, orgAddress: org.address,
      orgBalance: formatEther(orgBal),
      agentCount, agentBalance: formatEther(agentBal),
    })
  }

  // Governance: orgs where user is owner/admin
  type GovItem = { orgName: string; orgAddress: string; memberCount: number; pendingCount: number }
  const govItems: GovItem[] = []
  for (const org of userOrgs) {
    if (!org.roles.some(r => ['owner', 'admin', 'ceo'].includes(r.toLowerCase()))) continue
    const { members } = await getOrgMembers(org.address)
    const pendingInvites = await db.select().from(schema.invites)
      .where(eq(schema.invites.agentAddress, org.address.toLowerCase()))
    const pending = pendingInvites.filter(i => i.status === 'pending').length
    govItems.push({ orgName: org.name, orgAddress: org.address, memberCount: members.length, pendingCount: pending })
  }

  // Operations: orgs with child groups (field activity)
  type OpsItem = { orgName: string; orgAddress: string; childCount: number; recentActivityCount: number }
  const opsItems: OpsItem[] = []
  const thisWeek = new Date()
  thisWeek.setDate(thisWeek.getDate() - 7)
  for (const org of userOrgs) {
    try {
      const outEdges = await getEdgesBySubject(org.address as `0x${string}`)
      if (outEdges.length === 0) continue
      const { getConnectedOrgs } = await import('@/lib/get-org-members')
      const children = await getConnectedOrgs(org.address)
      const orgAddrs = new Set([org.address.toLowerCase(), ...children.map(c => c.address.toLowerCase())])
      const activities = await db.select().from(schema.activityLogs)
      const recentCount = activities.filter(a => orgAddrs.has(a.orgAddress.toLowerCase()) && new Date(a.activityDate) >= thisWeek).length
      opsItems.push({ orgName: org.name, orgAddress: org.address, childCount: children.length, recentActivityCount: recentCount })
    } catch { /* ignored */ }
  }

  // Reviews: pending reviews where user has delegation authority
  const reviewAddr = process.env.AGENT_REVIEW_ADDRESS as `0x${string}`
  const pendingReviewCount = 0
  let totalReviewCount = 0
  if (reviewAddr) {
    try {
      const { agentReviewRecordAbi } = await import('@smart-agent/sdk')
      totalReviewCount = Number(await client.readContract({ address: reviewAddr, abi: agentReviewRecordAbi, functionName: 'reviewCount' }) as bigint)
    } catch { /* not deployed */ }
  }

  // Recent activity across all orgs
  const allActivities = await db.select().from(schema.activityLogs)
  const allUsers = await db.select().from(schema.users)
  const userNameMap: Record<string, string> = {}
  for (const u of allUsers) userNameMap[u.id] = u.name
  const orgAddrSet = new Set(userOrgs.map(o => o.address.toLowerCase()))

  // Include child org activities
  for (const ops of opsItems) {
    try {
      const { getConnectedOrgs } = await import('@/lib/get-org-members')
      const children = await getConnectedOrgs(ops.orgAddress)
      for (const c of children) orgAddrSet.add(c.address.toLowerCase())
    } catch { /* ignored */ }
  }

  const recentActivities = allActivities
    .filter(a => orgAddrSet.has(a.orgAddress.toLowerCase()))
    .sort((a, b) => b.activityDate.localeCompare(a.activityDate))
    .slice(0, 5)

  return (
    <div data-page="dashboard">
      <div data-component="page-header">
        <h1>{currentUser.name}</h1>
        <p style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {[...allRoles].map(r => (
            <span key={r} data-component="role-badge" data-status="active">{r}</span>
          ))}
          <span style={{ color: '#616161' }}>across {userOrgs.length} organization{userOrgs.length !== 1 ? 's' : ''}</span>
        </p>
      </div>

      {/* ─── Role Cards: one per org showing user's responsibilities ─── */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {userOrgs.map(org => (
          <div key={org.address} data-component="protocol-info" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <Link href={`/agents/${org.address}`} style={{ fontWeight: 700, color: '#1565c0', fontSize: '0.95rem' }}>{org.name}</Link>
            </div>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              {org.roles.map(r => (
                <span key={r} data-component="role-badge" data-status="active" style={{ fontSize: '0.65rem' }}>{r}</span>
              ))}
            </div>
            {org.description && <p style={{ fontSize: '0.8rem', color: '#616161', margin: '0 0 0.5rem' }}>{org.description}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem' }}>
              <Link href="/team" style={{ color: '#1565c0' }}>Team</Link>
              <Link href="/network" style={{ color: '#1565c0' }}>Network</Link>
              <Link href={`/agents/${org.address}`} style={{ color: '#1565c0' }}>Profile</Link>
            </div>
          </div>
        ))}
      </section>

      {/* ─── Action Areas: only shown if user has relevant authority ─── */}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>

        {/* Governance & Team — shown if owner/admin */}
        {govItems.length > 0 && (
          <section data-component="graph-section">
            <div data-component="section-header">
              <h2>Governance</h2>
              <Link href="/team" data-component="section-action">Manage</Link>
            </div>
            {govItems.map(g => (
              <div key={g.orgAddress} data-component="protocol-info" style={{ marginBottom: '0.75rem', padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>{g.orgName}</strong>
                  <span style={{ fontSize: '0.75rem', color: '#616161' }}>{g.memberCount} members</span>
                </div>
                {g.pendingCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span data-component="role-badge" data-status="proposed">{g.pendingCount} pending invite{g.pendingCount !== 1 ? 's' : ''}</span>
                    <Link href="/team" style={{ color: '#1565c0', fontSize: '0.8rem' }}>Review</Link>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                  <Link href="/team" style={{ color: '#1565c0' }}>Invite Member</Link>
                  <Link href="/settings" style={{ color: '#1565c0' }}>Settings</Link>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Treasury — shown if treasurer/owner/signer */}
        {treasuryItems.length > 0 && (
          <section data-component="graph-section">
            <div data-component="section-header">
              <h2>Treasury</h2>
              <Link href="/treasury" data-component="section-action">Manage</Link>
            </div>
            {treasuryItems.map(t => (
              <div key={t.orgAddress} data-component="protocol-info" style={{ marginBottom: '0.75rem', padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>{t.orgName}</strong>
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.35rem' }}>
                  <div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#2e7d32' }}>
                      {parseFloat(t.orgBalance).toFixed(4)} <span style={{ fontSize: '0.75rem', color: '#616161' }}>ETH</span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#616161' }}>Org Account</div>
                  </div>
                  {t.agentCount > 0 && (
                    <div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1565c0' }}>
                        {parseFloat(t.agentBalance).toFixed(4)} <span style={{ fontSize: '0.75rem', color: '#616161' }}>ETH</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#616161' }}>{t.agentCount} Treasury Agent{t.agentCount !== 1 ? 's' : ''}</div>
                    </div>
                  )}
                </div>
                <Link href="/treasury" style={{ color: '#1565c0', fontSize: '0.8rem' }}>View Details</Link>
              </div>
            ))}
          </section>
        )}

        {/* Delegated Authority — shown if user has active delegations */}
        {activeDelegations.length > 0 && (
          <section data-component="graph-section">
            <div data-component="section-header">
              <h2>Delegated Authority</h2>
              <Link href="/reviews" data-component="section-action">Reviews</Link>
            </div>
            {activeDelegations.map(d => (
              <div key={d.id} data-component="protocol-info" style={{ marginBottom: '0.75rem', padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>{d.orgName}</strong>
                  <span data-component="role-badge" data-status="active">active</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#616161', marginBottom: '0.35rem' }}>Expires {d.expiresAt}</div>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  {d.caveats.map((c, i) => (
                    <span key={i} style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', background: '#f5f5f5', borderRadius: 4, color: '#616161' }}>{c}</span>
                  ))}
                </div>
                <div style={{ marginTop: '0.5rem' }}>
                  <Link href="/reviews/submit" style={{ color: '#1565c0', fontSize: '0.8rem' }}>Submit Review</Link>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Operations — shown if user has orgs with child groups */}
        {opsItems.length > 0 && (
          <section data-component="graph-section">
            <div data-component="section-header">
              <h2>Operations</h2>
              <Link href="/activities" data-component="section-action">Activities</Link>
            </div>
            {opsItems.map(o => (
              <div key={o.orgAddress} data-component="protocol-info" style={{ marginBottom: '0.75rem', padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>{o.orgName}</strong>
                  <span style={{ fontSize: '0.75rem', color: '#616161' }}>{o.childCount} groups</span>
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.35rem' }}>
                  <div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#7c3aed' }}>{o.recentActivityCount}</div>
                    <div style={{ fontSize: '0.7rem', color: '#616161' }}>This Week</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0d9488' }}>{o.childCount}</div>
                    <div style={{ fontSize: '0.7rem', color: '#616161' }}>Groups</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <Link href="/activities" style={{ color: '#1565c0' }}>Log Activity</Link>
                  <Link href="/genmap" style={{ color: '#1565c0' }}>Gen Map</Link>
                  <Link href="/members" style={{ color: '#1565c0' }}>Members</Link>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Reviews — shown if user has review capability */}
        {(totalReviewCount > 0 || allRoles.has('reviewer') || allRoles.has('auditor') || allRoles.has('endorser')) && (
          <section data-component="graph-section">
            <div data-component="section-header">
              <h2>Reviews</h2>
              <Link href="/reviews" data-component="section-action">View All</Link>
            </div>
            <div data-component="protocol-info" style={{ padding: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.5rem' }}>
                <div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1565c0' }}>{totalReviewCount}</div>
                  <div style={{ fontSize: '0.7rem', color: '#616161' }}>Total Reviews</div>
                </div>
                {pendingReviewCount > 0 && (
                  <div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ea580c' }}>{pendingReviewCount}</div>
                    <div style={{ fontSize: '0.7rem', color: '#616161' }}>Pending</div>
                  </div>
                )}
              </div>
              <Link href="/reviews/submit" style={{ color: '#1565c0', fontSize: '0.8rem' }}>Submit Review</Link>
            </div>
          </section>
        )}
      </div>

      {/* ─── Recent Activity Feed ─── */}
      {recentActivities.length > 0 && (
        <section data-component="graph-section" style={{ marginTop: '1.5rem' }}>
          <div data-component="section-header">
            <h2>Recent Activity</h2>
            <Link href="/activities" data-component="section-action">View All</Link>
          </div>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {recentActivities.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#fafafa', borderRadius: 6, border: '1px solid #f0f1f3' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span data-component="role-badge" style={{ fontSize: '0.6rem' }}>{a.activityType}</span>
                  <strong style={{ fontSize: '0.85rem' }}>{a.title}</strong>
                  <span style={{ fontSize: '0.75rem', color: '#616161' }}>{userNameMap[a.userId] ?? 'Unknown'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {a.location && <span style={{ fontSize: '0.7rem', color: '#616161' }}>{a.location}</span>}
                  <span style={{ fontSize: '0.7rem', color: '#616161' }}>{a.activityDate}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
