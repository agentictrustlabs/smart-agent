import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { db, schema } from '@/db'
import { NeedsAttentionCard, type AttentionItem } from '@/components/catalyst/NeedsAttentionCard'
import { DiscoveryService } from '@smart-agent/discovery'
import { getPersonAgentForUser, getAiAgentsForOrg } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getUserHubId } from '@/lib/get-user-hub'

// ─── Colors ─────────────────────────────────────────────────────────

const C = {
  bg: '#faf8f3',
  card: '#ffffff',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
  accentBorder: 'rgba(139,94,60,0.20)',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  border: '#ece6db',
  green: '#2e7d32',
  greenLight: 'rgba(46,125,50,0.08)',
  greenBorder: 'rgba(46,125,50,0.20)',
}

// CIL-specific palette (ILAD blue)
const CIL = {
  bg: '#f8fafc',
  card: '#ffffff',
  accent: '#2563EB',
  accentLight: 'rgba(37,99,235,0.08)',
  accentBorder: 'rgba(37,99,235,0.20)',
  text: '#1e293b',
  textMuted: '#64748b',
  border: '#e2e8f0',
  green: '#10B981',
  greenLight: 'rgba(16,185,129,0.08)',
  greenBorder: 'rgba(16,185,129,0.20)',
}

export default async function CatalystDashboardPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)
  const hubId = await getUserHubId(currentUser.id)
  const isCIL = hubId === 'cil'
  const isCatalyst = hubId === 'catalyst'

  const firstName = currentUser.name.split(' ')[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // ─── CIL Dashboard ──────────────────────────────────────────────
  if (isCIL) {
    return <CILDashboard currentUser={currentUser} userOrgs={userOrgs} firstName={firstName} />
  }

  // ─── Catalyst Dashboard (field-focused) ─────────────────────────
  if (isCatalyst) {
    return <CatalystFieldDashboard currentUser={currentUser} userOrgs={userOrgs} firstName={firstName} greeting={greeting} />
  }

  // ─── Global Church / Generic Hub Dashboard ──────────────────────
  // Shows: user summary, organizations, roles, AI agents, relationships

  // Person agent
  const personAgentAddr = await getPersonAgentForUser(currentUser.id)
  let personAgentName = ''
  let personPrimaryName = ''
  if (personAgentAddr) {
    const meta = await getAgentMetadata(personAgentAddr)
    personAgentName = meta.displayName
    personPrimaryName = meta.primaryName
  }

  // All roles across orgs
  const allRoles = new Set<string>()
  for (const org of userOrgs) {
    for (const r of org.roles) allRoles.add(r)
  }

  // Enrich orgs with .agent names
  const orgsMeta = await Promise.all(userOrgs.map(async (org) => {
    const meta = await getAgentMetadata(org.address)
    return { ...org, primaryName: meta.primaryName }
  }))

  // AI agents across user's orgs (with .agent names)
  type AIAgentInfo = { name: string; primaryName: string; type: string; orgName: string; address: string }
  const aiAgents: AIAgentInfo[] = []
  for (const org of userOrgs) {
    const aiAddrs = await getAiAgentsForOrg(org.address)
    for (const addr of aiAddrs) {
      const meta = await getAgentMetadata(addr)
      aiAgents.push({ name: meta.displayName, primaryName: meta.primaryName, type: meta.aiAgentClass || 'custom', orgName: org.name, address: addr })
    }
  }

  // Connected orgs count
  let connectedOrgCount = 0
  for (const org of userOrgs) {
    try {
      const connected = await getConnectedOrgs(org.address)
      connectedOrgCount += connected.length
    } catch { /* ignored */ }
  }

  // KB summary from GraphDB
  let kbAgentCount = 0
  let kbEdgeCount = 0
  try {
    const discovery = DiscoveryService.fromEnv()
    const counts = await discovery.countAgentsByType()
    kbAgentCount = Object.values(counts).reduce((a, b) => a + b, 0)
    kbEdgeCount = await discovery.countEdges()
  } catch { /* GraphDB may be unavailable */ }

  return (
    <div>
      {/* Greeting */}
      <h1 style={{
        fontSize: '1.35rem',
        fontWeight: 700,
        color: C.text,
        margin: '0 0 0.75rem',
      }}>
        {greeting}, {firstName}
      </h1>

      {/* User Identity Card */}
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{
            width: 44, height: 44, borderRadius: '50%', background: C.accent,
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '1.1rem', flexShrink: 0,
          }}>
            {firstName.charAt(0)}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: C.text }}>{currentUser.name}</div>
            <div style={{ fontSize: '0.78rem', color: C.textMuted }}>{currentUser.email}</div>
          </div>
        </div>

        {personAgentAddr && (
          <div style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.5rem' }}>
            {personPrimaryName ? (
              <>
                <span style={{ fontWeight: 600, color: C.accent, fontFamily: 'monospace', fontSize: '0.82rem' }}>{personPrimaryName}</span>
                <span style={{ marginLeft: '0.5rem', color: C.textMuted }}>({personAgentName})</span>
              </>
            ) : (
              <>
                <span style={{ fontWeight: 600, color: C.text }}>Person Agent:</span>{' '}
                <Link href={`/agents/${personAgentAddr}`} style={{ color: C.accent }}>{personAgentName}</Link>
              </>
            )}
          </div>
        )}

        {allRoles.size > 0 && (
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {[...allRoles].map(r => (
              <span key={r} style={{
                padding: '0.15rem 0.5rem', borderRadius: 10,
                fontSize: '0.7rem', fontWeight: 600,
                background: C.accentLight, color: C.accent,
                border: `1px solid ${C.accentBorder}`,
                textTransform: 'capitalize',
              }}>
                {r}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* KPI Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '0.6rem',
        marginBottom: '1rem',
      }}>
        <KpiCard label="MY ORGANIZATIONS" href="/agents">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>
            {userOrgs.length}
          </span>
          <span style={{ fontSize: '0.72rem', color: C.textMuted }}>
            {connectedOrgCount > 0 ? `+ ${connectedOrgCount} connected` : 'registered'}
          </span>
        </KpiCard>

        <KpiCard label="AI AGENTS" href="/agents">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>
            {aiAgents.length}
          </span>
          <span style={{ fontSize: '0.72rem', color: C.textMuted }}>deployed</span>
        </KpiCard>

        <KpiCard label="KNOWLEDGE BASE" href="/agents">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>
            {kbAgentCount}
          </span>
          <span style={{ fontSize: '0.72rem', color: C.textMuted }}>agents in registry</span>
        </KpiCard>

        <KpiCard label="TRUST GRAPH" href="/agents">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>
            {kbEdgeCount}
          </span>
          <span style={{ fontSize: '0.72rem', color: C.textMuted }}>relationships</span>
        </KpiCard>
      </div>

      {/* Organizations */}
      {userOrgs.length > 0 && (
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '1rem 1.25rem',
          marginBottom: '1rem',
        }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>
            My Organizations
          </h2>
          {orgsMeta.map(org => (
            <div key={org.address} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.5rem 0', borderBottom: `1px solid ${C.border}`,
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8, background: C.accentLight,
                color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.75rem', flexShrink: 0,
              }}>
                {org.name.charAt(0)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link href={`/agents/${org.address}`} style={{
                    fontWeight: 600, fontSize: '0.85rem', color: C.text, textDecoration: 'none',
                  }}>
                    {org.name}
                  </Link>
                  {org.primaryName && (
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: C.accent, background: C.accentLight, padding: '0.05rem 0.35rem', borderRadius: 6, border: `1px solid ${C.accentBorder}` }}>
                      {org.primaryName}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.15rem' }}>
                  {org.roles.map(r => (
                    <span key={r} style={{
                      fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: 4,
                      background: '#f5f5f5', color: '#616161', textTransform: 'capitalize',
                    }}>
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Agents */}
      {aiAgents.length > 0 && (
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '1rem 1.25rem',
          marginBottom: '1rem',
        }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>
            AI Agents
          </h2>
          {aiAgents.map(agent => (
            <div key={agent.address} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.5rem 0', borderBottom: `1px solid ${C.border}`,
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8, background: '#f3e5f5',
                color: '#7b1fa2', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.65rem', flexShrink: 0,
              }}>
                AI
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link href={`/agents/${agent.address}`} style={{
                    fontWeight: 600, fontSize: '0.85rem', color: C.text, textDecoration: 'none',
                  }}>
                    {agent.name}
                  </Link>
                  {agent.primaryName && (
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#7b1fa2', background: '#f3e5f5', padding: '0.05rem 0.35rem', borderRadius: 6, border: '1px solid #e1bee7' }}>
                      {agent.primaryName}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
                  {agent.type} &middot; {agent.orgName}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Data Delegations */}
      <DelegationSection userId={currentUser.id} />

      {/* No orgs state */}
      {userOrgs.length === 0 && (
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '2rem',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: '0.9rem', color: C.textMuted, marginBottom: '0.75rem' }}>
            You are not yet associated with any organization.
          </p>
          <Link href="/setup" style={{
            display: 'inline-block',
            padding: '0.5rem 1.25rem',
            background: C.accent,
            color: '#fff',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '0.85rem',
            textDecoration: 'none',
          }}>
            Create Organization
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── CIL Dashboard (unchanged) ──────────────────────────────────────

async function CILDashboard({
  currentUser,
  userOrgs,
  firstName,
}: {
  currentUser: { id: string; name: string }
  userOrgs: Array<{ address: string; name: string; roles: string[] }>
  firstName: string
}) {
  const orgAddresses = new Set(userOrgs.map(o => o.address.toLowerCase()))
  const orgUserIds = new Set<string>([currentUser.id])
  for (let i = 1; i <= 7; i++) orgUserIds.add(`cil-user-00${i}`)

  let totalCircles = userOrgs.length
  for (const org of userOrgs) {
    try {
      const connected = await getConnectedOrgs(org.address)
      totalCircles += connected.length
    } catch { /* ignored */ }
  }

  const capitalDeployed = 12500
  let totalRecovered = 0
  let revenueReports: (typeof schema.revenueReports.$inferSelect)[] = []
  let openProposalCount = 0
  try { revenueReports = await db.select().from(schema.revenueReports); totalRecovered = revenueReports.filter(r => r.status === 'verified').reduce((sum, r) => sum + r.sharePayment, 0) } catch { /* */ }
  const recoveryRate = capitalDeployed > 0 ? Math.round((totalRecovered / capitalDeployed) * 100) : 0

  const businessAddresses = ['0x00000000000000000000000000000000000c0003', '0x00000000000000000000000000000000000c0004']
  let greenCount = 0, yellowCount = 0, redCount = 0
  const currentMonth = new Date().toISOString().slice(0, 7)
  const lastMonth = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) })()
  const businessesWithoutReport: string[] = [], decliningBusinesses: string[] = []

  for (const addr of businessAddresses) {
    const reports = revenueReports.filter(r => r.orgAddress === addr).sort((a, b) => b.period.localeCompare(a.period))
    const latest = reports[0]
    if (!latest || (latest.period !== currentMonth && latest.period !== lastMonth)) { redCount++; businessesWithoutReport.push(addr) }
    else if (latest.netRevenue < 0) { redCount++; decliningBusinesses.push(addr) }
    else if (latest.netRevenue < latest.grossRevenue * 0.1) { yellowCount++ }
    else { greenCount++ }
  }
  yellowCount += Math.max(0, totalCircles - businessAddresses.length)

  try { const { eq: eqOp } = await import('drizzle-orm'); const openProps = await db.select().from(schema.proposals).where(eqOp(schema.proposals.status, 'open')); openProposalCount = openProps.length } catch { /* */ }

  const cilAttentionItems: AttentionItem[] = []
  for (const addr of businessesWithoutReport) cilAttentionItems.push({ type: 'revenue-report', label: `Business ${addr.slice(-4)}`, detail: 'No revenue report', href: '/catalyst/activity' })
  if (openProposalCount > 0) cilAttentionItems.push({ type: 'governance', label: `${openProposalCount} open proposal${openProposalCount !== 1 ? 's' : ''}`, detail: 'Awaiting votes', href: '/catalyst/steward' })
  for (const addr of decliningBusinesses) cilAttentionItems.push({ type: 'escalation', label: `Business ${addr.slice(-4)}`, detail: 'Declining revenue', href: '/catalyst/groups' })

  const allActivities = await db.select().from(schema.activityLogs)
  const activities = allActivities.filter(a => orgAddresses.has(a.orgAddress.toLowerCase()) || orgUserIds.has(a.userId))
  const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0,0,0,0)
  const monthActivities = activities.filter(a => new Date(a.activityDate) >= thisMonth)

  return (
    <div>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: CIL.text, margin: '0 0 0.75rem' }}>Welcome, {firstName}</h1>
      <NeedsAttentionCard items={cilAttentionItems} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1.5rem' }}>
        <KpiCard label="BUSINESSES" href="/groups" palette={CIL}><span style={{ fontSize: '1.75rem', fontWeight: 700, color: CIL.accent }}>{totalCircles}</span><span style={{ fontSize: '0.72rem', color: CIL.textMuted }}>in portfolio</span></KpiCard>
        <KpiCard label="CAPITAL DEPLOYED" href="/steward" palette={CIL}><span style={{ fontSize: '1.75rem', fontWeight: 700, color: CIL.accent }}>${capitalDeployed.toLocaleString()}</span><span style={{ fontSize: '0.72rem', color: CIL.textMuted }}>across Wave 1</span></KpiCard>
        <KpiCard label="RECOVERY RATE" href="/activity" palette={CIL}><span style={{ fontSize: '1.75rem', fontWeight: 700, color: CIL.accent }}>{recoveryRate}%</span><span style={{ fontSize: '0.72rem', color: CIL.textMuted }}>${totalRecovered.toLocaleString()} recovered</span></KpiCard>
        <KpiCard label="HEALTH STATUS" href="/groups" palette={CIL}><span style={{ fontSize: '1.1rem', fontWeight: 600, color: CIL.text }}>{'\uD83D\uDFE2'} {greenCount} {'\uD83D\uDFE1'} {yellowCount} {'\uD83D\uDD34'} {redCount}</span></KpiCard>
      </div>
      {monthActivities.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <h2 style={{ fontSize: '0.75rem', fontWeight: 700, color: CIL.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Recent Revenue Activity</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {monthActivities.slice(0, 5).map((a, i) => (
              <div key={i} style={{ background: CIL.card, border: `1px solid ${CIL.border}`, borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: CIL.text, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>{a.title}</span>
                <span style={{ fontSize: '0.72rem', color: CIL.textMuted }}>{a.activityDate}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Catalyst Field Dashboard (for catalyst hub users) ───────────────

async function CatalystFieldDashboard({
  currentUser,
  userOrgs,
  firstName,
  greeting,
}: {
  currentUser: { id: string; name: string }
  userOrgs: Array<{ address: string; name: string; roles: string[] }>
  firstName: string
  greeting: string
}) {
  const orgAddresses = new Set(userOrgs.map(o => o.address.toLowerCase()))
  const orgUserIds = new Set<string>([currentUser.id])
  for (let i = 1; i <= 7; i++) orgUserIds.add(`cat-user-00${i}`)

  const allActivities = await db.select().from(schema.activityLogs)
  const activities = allActivities.filter(a => orgAddresses.has(a.orgAddress.toLowerCase()) || orgUserIds.has(a.userId))
  const thisWeek = new Date(); thisWeek.setDate(thisWeek.getDate() - 7)
  const weekCount = activities.filter(a => new Date(a.activityDate) >= thisWeek).length

  let totalCircles = userOrgs.length
  for (const org of userOrgs) { try { const c = await getConnectedOrgs(org.address); totalCircles += c.length } catch { /* */ } }

  let oikosCount = 0
  try { const { eq } = await import('drizzle-orm'); oikosCount = (await db.select().from(schema.circles).where(eq(schema.circles.userId, currentUser.id))).length } catch { /* */ }

  let prayerDueCount = 0
  try {
    const { eq } = await import('drizzle-orm')
    const allPrayers = await db.select().from(schema.prayers).where(eq(schema.prayers.userId, currentUser.id))
    const days = ['sun','mon','tue','wed','thu','fri','sat']
    const today = days[new Date().getDay()]
    prayerDueCount = allPrayers.filter(p => !p.answered && (p.schedule === 'daily' || p.schedule.includes(today))).length
  } catch { /* */ }

  const { getTrainingProgress } = await import('@/lib/actions/grow.action')
  const progress = await getTrainingProgress(currentUser.id)
  const walkPct = Math.round((progress.filter(p => p.completed === 1).length / 28) * 100)

  // Enrich orgs with .agent names
  const orgsMeta = await Promise.all(userOrgs.map(async (org) => {
    const meta = await getAgentMetadata(org.address)
    return { ...org, primaryName: meta.primaryName }
  }))

  // AI agents across user's orgs
  type AIAgentInfo = { name: string; primaryName: string; type: string; orgName: string; address: string }
  const aiAgents: AIAgentInfo[] = []
  for (const org of userOrgs) {
    const aiAddrs = await getAiAgentsForOrg(org.address)
    for (const addr of aiAddrs) {
      const meta = await getAgentMetadata(addr)
      aiAgents.push({ name: meta.displayName, primaryName: meta.primaryName, type: meta.aiAgentClass || 'custom', orgName: org.name, address: addr })
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: C.text, margin: '0 0 0.75rem' }}>{greeting}, {firstName}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem' }}>
        <KpiCard label="MY OIKOS" href="/oikos"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{oikosCount}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>people</span></KpiCard>
        <KpiCard label="PRAY NOW" href="/nurture/prayer"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{prayerDueCount}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>due today</span></KpiCard>
        <KpiCard label="MY CIRCLES" href="/groups"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{totalCircles}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>gatherings</span></KpiCard>
        <KpiCard label="PERSONAL WALK" href="/nurture/grow"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{walkPct}%</span></KpiCard>
        <KpiCard label="SOW THIS WEEK" href="/activity"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{weekCount}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>activities</span></KpiCard>
      </div>

      <DelegationSection userId={currentUser.id} />

      {/* Organizations */}
      {userOrgs.length > 0 && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem',
        }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>
            My Organizations
          </h2>
          {orgsMeta.map(org => (
            <div key={org.address} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.5rem 0', borderBottom: `1px solid ${C.border}`,
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8, background: C.accentLight,
                color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.75rem', flexShrink: 0,
              }}>
                {org.name.charAt(0)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link href={`/agents/${org.address}`} style={{
                    fontWeight: 600, fontSize: '0.85rem', color: C.text, textDecoration: 'none',
                  }}>
                    {org.name}
                  </Link>
                  {org.primaryName && (
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: C.accent, background: C.accentLight, padding: '0.05rem 0.35rem', borderRadius: 6, border: `1px solid ${C.accentBorder}` }}>
                      {org.primaryName}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.15rem' }}>
                  {org.roles.map(r => (
                    <span key={r} style={{
                      fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: 4,
                      background: '#f5f5f5', color: '#616161', textTransform: 'capitalize',
                    }}>
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Agents */}
      {aiAgents.length > 0 && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem',
        }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>
            AI Agents
          </h2>
          {aiAgents.map(agent => (
            <div key={agent.address} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.5rem 0', borderBottom: `1px solid ${C.border}`,
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8, background: '#f3e5f5',
                color: '#7b1fa2', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.65rem', flexShrink: 0,
              }}>
                AI
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link href={`/agents/${agent.address}`} style={{
                    fontWeight: 600, fontSize: '0.85rem', color: C.text, textDecoration: 'none',
                  }}>
                    {agent.name}
                  </Link>
                  {agent.primaryName && (
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#7b1fa2', background: '#f3e5f5', padding: '0.05rem 0.35rem', borderRadius: 6, border: '1px solid #e1bee7' }}>
                      {agent.primaryName}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
                  {agent.type} &middot; {agent.orgName}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Delegation Section (shared across all dashboard types) ─────────

async function DelegationSection({ userId }: { userId: string }) {
  const { getIncomingDelegations, getOutgoingDelegations } = await import('@/lib/actions/data-delegation.action')
  const { getCoachRelationship, getDisciples } = await import('@/lib/actions/grow.action')
  const { getAgentMetadata: getMeta } = await import('@/lib/agent-metadata')

  const incoming = await getIncomingDelegations(userId)
  const outgoing = await getOutgoingDelegations(userId)
  const coachRel = await getCoachRelationship(userId)
  const disciples = await getDisciples(userId)

  if (!coachRel && disciples.length === 0 && incoming.length === 0 && outgoing.length === 0) return null

  // Resolve .agent names for all addresses we'll display
  const nameCache = new Map<string, string>()
  async function agentName(addr: string): Promise<string> {
    if (nameCache.has(addr)) return nameCache.get(addr)!
    try {
      const meta = await getMeta(addr)
      const name = meta.primaryName || ''
      nameCache.set(addr, name)
      return name
    } catch { return '' }
  }

  // Pre-fetch names
  if (coachRel) await agentName(coachRel.coachId)
  for (const d of disciples) await agentName(d.discipleId)
  for (const d of incoming) await agentName(d.grantor)
  for (const d of outgoing) await agentName(d.grantee)

  return (
    <div className="bg-white border border-outline-variant rounded-md p-5 mb-4 shadow-elevation-1">
      <h2 className="text-label-md text-on-surface-variant uppercase tracking-wider font-bold mb-3">
        Relationships & Data Delegations
      </h2>

      {coachRel && (
        <DelegationRow icon="Coach" iconBg="#7c3aed12" iconColor="#7c3aed" name={coachRel.coachName} agentName={nameCache.get(coachRel.coachId)} detail="Coaching you" tooltip="Your mentor in this community" />
      )}

      {disciples.map(d => (
        <DelegationRow key={d.id} icon="Disciple" iconBg="#7c3aed12" iconColor="#7c3aed" name={d.discipleName} agentName={nameCache.get(d.discipleId)} detail="You coach" badgeLabel="data shared" badgeColor="#2e7d32" tooltip="You are coaching this person. They have shared personal data with you." />
      ))}

      {incoming.map(d => {
        const fields = d.grants.flatMap(g => g.fields)
        return (
          <DelegationRow
            key={d.edgeId} icon="Received" iconBg="rgba(139,94,60,0.10)" iconColor="#8b5e3c"
            name={d.grantorName} agentName={nameCache.get(d.grantor)}
            detail={`Shared with you: ${fields.map(f => fieldLabel(f)).join(', ')}`}
            href="/catalyst/me/sharing" linkLabel="view"
            tooltip="This person has granted you access to their personal data"
          />
        )
      })}

      {outgoing.map(d => {
        const fields = d.grants.flatMap(g => g.fields)
        return (
          <DelegationRow
            key={d.edgeId} icon="Shared" iconBg="#ec489912" iconColor="#ec4899"
            name={d.granteeName} agentName={nameCache.get(d.grantee)}
            detail={`You shared: ${fields.map(f => fieldLabel(f)).join(', ')}`}
            href="/catalyst/me/sharing" linkLabel="manage" linkColor="#ec4899" linkBorder="#ec489930" linkBg="#ec489912"
            tooltip="You have granted this person access to your personal data"
          />
        )
      })}
    </div>
  )
}

const FIELD_LABELS: Record<string, string> = {
  email: 'Email', phone: 'Phone', dateOfBirth: 'DOB', gender: 'Gender',
  language: 'Language', displayName: 'Name', bio: 'Bio',
  city: 'City', stateProvince: 'State', postalCode: 'ZIP', country: 'Country',
  addressLine1: 'Address', addressLine2: 'Address 2', location: 'Location',
}
function fieldLabel(f: string) { return FIELD_LABELS[f] ?? f }

function DelegationRow({ icon, iconBg, iconColor, name, agentName, detail, tooltip, badgeLabel, badgeColor, href, linkLabel, linkColor, linkBorder, linkBg }: {
  icon: string; iconBg: string; iconColor: string; name: string; agentName?: string; detail: string; tooltip?: string
  badgeLabel?: string; badgeColor?: string
  href?: string; linkLabel?: string; linkColor?: string; linkBorder?: string; linkBg?: string
}) {
  return (
    <div title={tooltip} className={`flex items-center gap-3 py-2 border-b border-outline-variant ${tooltip ? 'cursor-help' : ''}`}>
      <span className="px-2 py-0.5 rounded-full text-label-sm font-bold whitespace-nowrap"
        style={{ background: iconBg, color: iconColor, border: `1px solid ${iconColor}25` }}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-title-sm font-semibold text-on-surface">{name}</span>
          {agentName && (
            <span className="font-mono text-label-sm text-primary bg-primary-container px-1.5 py-0.5 rounded border border-primary/10">
              {agentName}
            </span>
          )}
        </div>
        <div className="text-body-sm text-on-surface-variant truncate">{detail}</div>
      </div>
      {badgeLabel && (
        <span className="text-label-sm px-2 py-0.5 rounded-full font-semibold"
          style={{ background: `${badgeColor}12`, color: badgeColor, border: `1px solid ${badgeColor}30` }}>
          {badgeLabel}
        </span>
      )}
      {href && linkLabel && (
        <Link href={href} className="text-label-sm px-2.5 py-0.5 rounded-full font-semibold no-underline transition-all hover:shadow-elevation-1"
          style={{ background: linkBg ?? 'rgba(139,94,60,0.10)', color: linkColor ?? '#8b5e3c', border: `1px solid ${linkBorder ?? 'rgba(139,94,60,0.20)'}` }}>
          {linkLabel}
        </Link>
      )}
    </div>
  )
}

// ─── KPI Card ───────────────────────────────────────────────────────

function KpiCard({
  label,
  href,
  children,
  palette,
}: {
  label: string
  href: string
  children: React.ReactNode
  palette?: typeof C
}) {
  const P = palette ?? C
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{
        background: P.card,
        border: `1px solid ${P.border}`,
        borderRadius: 10,
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        minHeight: 80,
      }}>
        <span style={{
          fontSize: '0.6rem',
          fontWeight: 700,
          color: P.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flex: 1 }}>
          {children}
        </div>
      </div>
    </Link>
  )
}
