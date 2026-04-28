import Link from 'next/link'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { NeedsAttentionCard, type AttentionItem } from '@/components/catalyst/NeedsAttentionCard'
import { DiscoveryService } from '@smart-agent/discovery'
import { getPersonAgentForUser, getAiAgentsForOrg } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { listHubsForOnboarding } from '@/lib/actions/onboarding/setup-agent.action'
import { JoinHubBanner } from '@/components/catalyst/JoinHubBanner'
import { CreateOrgButton } from '@/components/org/CreateOrgButton'
import { HeldCredentialsPanel } from '@/components/org/HeldCredentialsPanel'
import { AgentTrustSearch } from '@/components/trust/AgentTrustSearch'
import { AddGeoClaimPanel } from '@/components/profile/AddGeoClaimPanel'
import { AddSkillClaimPanel } from '@/components/profile/AddSkillClaimPanel'
import { AddRelationshipPanel } from '@/components/profile/AddRelationshipPanel'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import type { HubId } from '@/lib/hub-profiles'

/**
 * Hub-aware dashboard view. Pure render — caller (a route) decides which
 * hub to render based on URL slug, after performing membership checks.
 *
 * Variants:
 *   - 'cil'           → CIL command-center
 *   - 'catalyst'      → Catalyst field dashboard
 *   - 'global-church' → generic with hub framing
 *   - 'generic'       → generic with JoinHubBanner (no-hub state)
 *
 * Previously this lived inside /catalyst/page.tsx and branched off
 * `getUserHubId(currentUser.id)`. /catalyst is now URL-restricted to
 * actual catalyst members; this render is the single source of truth.
 */

const C = {
  bg: '#faf8f3', card: '#ffffff', accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)', accentBorder: 'rgba(139,94,60,0.20)',
  text: '#5c4a3a', textMuted: '#9a8c7e', border: '#ece6db',
  green: '#2e7d32', greenLight: 'rgba(46,125,50,0.08)', greenBorder: 'rgba(46,125,50,0.20)',
}

const CIL = {
  bg: '#f8fafc', card: '#ffffff', accent: '#2563EB',
  accentLight: 'rgba(37,99,235,0.08)', accentBorder: 'rgba(37,99,235,0.20)',
  text: '#1e293b', textMuted: '#64748b', border: '#e2e8f0',
  green: '#10B981', greenLight: 'rgba(16,185,129,0.08)', greenBorder: 'rgba(16,185,129,0.20)',
}

interface HubDashboardProps {
  hubId: HubId
  currentUser: { id: string; name: string; email?: string | null }
  /** Hub on-chain address — drives hub-scoped actions like "Create org". */
  hubAddress?: string | null
  hubName?: string
}

export async function HubDashboard({ hubId, currentUser, hubAddress, hubName }: HubDashboardProps) {
  const userOrgs = await getUserOrgs(currentUser.id)
  const firstName = currentUser.name.split(' ')[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // .agent primary name for the greeting subline. On-chain first, DB mirror
  // fallback for accounts where the resolver write was skipped.
  let primaryName = ''
  try {
    const personAddr = await getPersonAgentForUser(currentUser.id)
    if (personAddr) {
      const meta = await getAgentMetadata(personAddr)
      primaryName = meta.primaryName
    }
  } catch { /* on-chain unavailable */ }
  if (!primaryName) {
    try {
      const row = await db.select().from(schema.users)
        .where(eq(schema.users.id, currentUser.id)).limit(1).then(r => r[0])
      if (row?.agentName) primaryName = row.agentName
    } catch { /* db unavailable */ }
  }

  if (hubId === 'cil') {
    return <CILDashboard hubId={hubId} currentUser={currentUser} userOrgs={userOrgs} firstName={firstName} primaryName={primaryName} hubAddress={hubAddress ?? null} hubName={hubName ?? 'Mission Collective'} />
  }
  if (hubId === 'catalyst') {
    return <CatalystFieldDashboard hubId={hubId} currentUser={currentUser} userOrgs={userOrgs} firstName={firstName} greeting={greeting} primaryName={primaryName} hubAddress={hubAddress ?? null} hubName={hubName ?? 'Catalyst NoCo Network'} />
  }

  return <GenericDashboard hubId={hubId} currentUser={currentUser} userOrgs={userOrgs} firstName={firstName} greeting={greeting} primaryName={primaryName} showJoinHubBanner={hubId === 'generic'} hubAddress={hubAddress ?? null} hubName={hubName ?? ''} />
}

// ─── Generic / Global Church Dashboard ──────────────────────────────

async function GenericDashboard({
  hubId, currentUser, userOrgs, firstName, greeting, primaryName, showJoinHubBanner, hubAddress, hubName,
}: {
  hubId: HubId
  currentUser: { id: string; name: string; email?: string | null }
  userOrgs: Array<{ address: string; name: string; roles: string[] }>
  firstName: string
  greeting: string
  primaryName: string
  showJoinHubBanner: boolean
  hubAddress: string | null
  hubName: string
}) {
  const personAgentAddr = await getPersonAgentForUser(currentUser.id)
  let personAgentName = ''
  let personPrimaryName = primaryName
  if (personAgentAddr) {
    const meta = await getAgentMetadata(personAgentAddr)
    personAgentName = meta.displayName
    if (!personPrimaryName) personPrimaryName = meta.primaryName
  }

  const allRoles = new Set<string>()
  for (const org of userOrgs) for (const r of org.roles) allRoles.add(r)

  // Fan out the per-org RPC reads in parallel.
  const [orgsMeta, aiAddrsPerOrg, connectedOrgLists] = await Promise.all([
    Promise.all(userOrgs.map(async (org) => {
      const meta = await getAgentMetadata(org.address)
      return { ...org, primaryName: meta.primaryName }
    })),
    Promise.all(userOrgs.map(o => getAiAgentsForOrg(o.address).catch(() => []))),
    Promise.all(userOrgs.map(o => getConnectedOrgs(o.address).catch(() => []))),
  ])

  type AIAgentInfo = { name: string; primaryName: string; type: string; orgName: string; address: string }
  const aiAgentTasks: Array<Promise<AIAgentInfo>> = []
  for (let i = 0; i < userOrgs.length; i++) {
    const org = userOrgs[i]
    for (const addr of aiAddrsPerOrg[i]) {
      aiAgentTasks.push(getAgentMetadata(addr).then(meta => ({
        name: meta.displayName, primaryName: meta.primaryName,
        type: meta.aiAgentClass || 'custom', orgName: org.name, address: addr,
      })))
    }
  }
  const aiAgents: AIAgentInfo[] = await Promise.all(aiAgentTasks)

  let connectedOrgCount = 0
  for (const c of connectedOrgLists) connectedOrgCount += c.length

  let kbAgentCount = 0
  let kbEdgeCount = 0
  try {
    const discovery = DiscoveryService.fromEnv()
    const counts = await discovery.countAgentsByType()
    kbAgentCount = Object.values(counts).reduce((a, b) => a + b, 0)
    kbEdgeCount = await discovery.countEdges()
  } catch { /* GraphDB may be unavailable */ }

  // Only show the JoinHubBanner on the truly hub-less /dashboard. Hub-
  // specific routes already restrict access to members.
  let availableHubs = showJoinHubBanner
    ? await listHubsForOnboarding().catch(() => [])
    : []

  // If the user came from /h/{slug} (cookie set by HubLandingClient),
  // surface that hub first so they don't have to hunt for it in the list.
  if (availableHubs.length > 1) {
    try {
      const jar = await cookies()
      const intentSlug = jar.get('hub-intent')?.value
      const intendedHubId = intentSlug ? HUB_SLUG_MAP[intentSlug] : undefined
      if (intendedHubId) {
        const idx = availableHubs.findIndex((h) => hubMatchesId(h, intendedHubId))
        if (idx > 0) {
          availableHubs = [availableHubs[idx], ...availableHubs.filter((_, i) => i !== idx)]
        }
      }
    } catch { /* cookies optional */ }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: C.text, margin: '0 0 0.75rem' }}>
        {greeting}, {firstName}
      </h1>

      {showJoinHubBanner && <JoinHubBanner hubs={availableHubs} />}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ width: 44, height: 44, borderRadius: '50%', background: C.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.1rem', flexShrink: 0 }}>
            {firstName.charAt(0)}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: C.text }}>{currentUser.name}</div>
            {personPrimaryName && (
              <div style={{ fontSize: '0.78rem', color: C.accent, fontFamily: 'ui-monospace, monospace' }}>{personPrimaryName}</div>
            )}
            {currentUser.email && (
              <div style={{ fontSize: '0.78rem', color: C.textMuted }}>{currentUser.email}</div>
            )}
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
              <span key={r} style={{ padding: '0.15rem 0.5rem', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600, background: C.accentLight, color: C.accent, border: `1px solid ${C.accentBorder}`, textTransform: 'capitalize' }}>
                {r}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem' }}>
        <KpiCard label="MY ORGANIZATIONS" href="/agents">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{userOrgs.length}</span>
          <span style={{ fontSize: '0.72rem', color: C.textMuted }}>{connectedOrgCount > 0 ? `+ ${connectedOrgCount} connected` : 'registered'}</span>
        </KpiCard>
        <KpiCard label="AI AGENTS" href="/agents"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{aiAgents.length}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>deployed</span></KpiCard>
        <KpiCard label="KNOWLEDGE BASE" href="/agents"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{kbAgentCount}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>agents in registry</span></KpiCard>
        <KpiCard label="TRUST GRAPH" href="/agents"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{kbEdgeCount}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>relationships</span></KpiCard>
      </div>

      <AddGeoClaimPanel />
      <AddSkillClaimPanel />
      <AgentTrustSearch />

      {(userOrgs.length > 0 || hubAddress) && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
            <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>My Organizations</h2>
            {hubAddress && <CreateOrgButton hubAddress={hubAddress} hubName={hubName} hubId={hubId} label="New" />}
          </div>
          {orgsMeta.map(org => (
            <div key={org.address} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: C.accentLight, color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
                {org.name.charAt(0)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link href={`/agents/${org.address}`} style={{ fontWeight: 600, fontSize: '0.85rem', color: C.text, textDecoration: 'none' }}>{org.name}</Link>
                  {org.primaryName && (
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: C.accent, background: C.accentLight, padding: '0.05rem 0.35rem', borderRadius: 6, border: `1px solid ${C.accentBorder}` }}>{org.primaryName}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.15rem' }}>
                  {org.roles.map(r => (
                    <span key={r} style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: 4, background: '#f5f5f5', color: '#616161', textTransform: 'capitalize' }}>{r}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <HeldCredentialsPanel />
        </div>
      )}

      {aiAgents.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>AI Agents</h2>
          {aiAgents.map(agent => (
            <div key={agent.address} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: '#f3e5f5', color: '#7b1fa2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.65rem', flexShrink: 0 }}>AI</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link href={`/agents/${agent.address}`} style={{ fontWeight: 600, fontSize: '0.85rem', color: C.text, textDecoration: 'none' }}>{agent.name}</Link>
                  {agent.primaryName && (
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#7b1fa2', background: '#f3e5f5', padding: '0.05rem 0.35rem', borderRadius: 6, border: '1px solid #e1bee7' }}>{agent.primaryName}</span>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: C.textMuted }}>{agent.type} &middot; {agent.orgName}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <DelegationSection userId={currentUser.id} />

      {userOrgs.length === 0 && !showJoinHubBanner && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '2rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', color: C.textMuted, marginBottom: '0.75rem' }}>You are not yet associated with any organization.</p>
          <Link href="/setup" style={{ display: 'inline-block', padding: '0.5rem 1.25rem', background: C.accent, color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>Create Organization</Link>
        </div>
      )}
    </div>
  )
}

// ─── CIL Dashboard ──────────────────────────────────────────────────

async function CILDashboard({
  hubId, currentUser, userOrgs, firstName, primaryName, hubAddress, hubName,
}: {
  hubId: HubId
  currentUser: { id: string; name: string }
  userOrgs: Array<{ address: string; name: string; roles: string[] }>
  firstName: string
  primaryName: string
  hubAddress: string | null
  hubName: string
}) {
  const orgAddresses = new Set(userOrgs.map(o => o.address.toLowerCase()))
  const orgUserIds = new Set<string>([currentUser.id])
  for (let i = 1; i <= 7; i++) orgUserIds.add(`cil-user-00${i}`)

  let totalCircles = userOrgs.length
  for (const org of userOrgs) {
    try { const c = await getConnectedOrgs(org.address); totalCircles += c.length } catch { /* */ }
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
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: CIL.text, margin: '0 0 0.25rem' }}>Welcome, {firstName}</h1>
      {primaryName && (
        <div style={{ fontSize: '0.78rem', color: CIL.accent, fontFamily: 'ui-monospace, monospace', marginBottom: '0.75rem' }}>{primaryName}</div>
      )}
      <NeedsAttentionCard items={cilAttentionItems} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1.5rem' }}>
        <KpiCard label="BUSINESSES" href="/groups" palette={CIL}><span style={{ fontSize: '1.75rem', fontWeight: 700, color: CIL.accent }}>{totalCircles}</span><span style={{ fontSize: '0.72rem', color: CIL.textMuted }}>in portfolio</span></KpiCard>
        <KpiCard label="CAPITAL DEPLOYED" href="/steward" palette={CIL}><span style={{ fontSize: '1.75rem', fontWeight: 700, color: CIL.accent }}>${capitalDeployed.toLocaleString()}</span><span style={{ fontSize: '0.72rem', color: CIL.textMuted }}>across Wave 1</span></KpiCard>
        <KpiCard label="RECOVERY RATE" href="/activity" palette={CIL}><span style={{ fontSize: '1.75rem', fontWeight: 700, color: CIL.accent }}>{recoveryRate}%</span><span style={{ fontSize: '0.72rem', color: CIL.textMuted }}>${totalRecovered.toLocaleString()} recovered</span></KpiCard>
        <KpiCard label="HEALTH STATUS" href="/groups" palette={CIL}><span style={{ fontSize: '1.1rem', fontWeight: 600, color: CIL.text }}>{'🟢'} {greenCount} {'🟡'} {yellowCount} {'🔴'} {redCount}</span></KpiCard>
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

// ─── Catalyst Field Dashboard ───────────────────────────────────────

async function CatalystFieldDashboard({
  hubId, currentUser, userOrgs, firstName, greeting, primaryName, hubAddress, hubName,
}: {
  hubId: HubId
  currentUser: { id: string; name: string }
  userOrgs: Array<{ address: string; name: string; roles: string[] }>
  firstName: string
  greeting: string
  primaryName: string
  hubAddress: string | null
  hubName: string
}) {
  const orgAddresses = new Set(userOrgs.map(o => o.address.toLowerCase()))
  const orgUserIds = new Set<string>([currentUser.id])
  for (let i = 1; i <= 7; i++) orgUserIds.add(`cat-user-00${i}`)

  const allActivities = await db.select().from(schema.activityLogs)
  const activities = allActivities.filter(a => orgAddresses.has(a.orgAddress.toLowerCase()) || orgUserIds.has(a.userId))
  const thisWeek = new Date(); thisWeek.setDate(thisWeek.getDate() - 7)
  const weekCount = activities.filter(a => new Date(a.activityDate) >= thisWeek).length

  // Fan out every per-org RPC + the unrelated DB queries in parallel —
  // these used to run serially and dominated the catalyst home render
  // (5–10 s on the demo seed, vs ~50 ms for hubs that don't take this
  // path).
  const { eq } = await import('drizzle-orm')
  const { getTrainingProgress } = await import('@/lib/actions/grow.action')
  const [
    connectedOrgLists,
    oikosRows,
    allPrayers,
    progress,
    orgsMeta,
    aiAddrsPerOrg,
  ] = await Promise.all([
    Promise.all(userOrgs.map(o => getConnectedOrgs(o.address).catch(() => []))),
    db.select().from(schema.circles).where(eq(schema.circles.userId, currentUser.id)).catch(() => []),
    db.select().from(schema.prayers).where(eq(schema.prayers.userId, currentUser.id)).catch(() => []),
    getTrainingProgress(currentUser.id),
    Promise.all(userOrgs.map(async (org) => {
      const meta = await getAgentMetadata(org.address)
      return { ...org, primaryName: meta.primaryName }
    })),
    Promise.all(userOrgs.map(o => getAiAgentsForOrg(o.address).catch(() => []))),
  ])

  let totalCircles = userOrgs.length
  for (const c of connectedOrgLists) totalCircles += c.length

  const oikosCount = oikosRows.length

  const days = ['sun','mon','tue','wed','thu','fri','sat']
  const today = days[new Date().getDay()]
  const prayerDueCount = allPrayers.filter(p => !p.answered && (p.schedule === 'daily' || p.schedule.includes(today))).length

  const walkPct = Math.round((progress.filter(p => p.completed === 1).length / 28) * 100)

  // Resolve every AI agent's metadata in one parallel batch.
  type AIAgentInfo = { name: string; primaryName: string; type: string; orgName: string; address: string }
  const aiAgentTasks: Array<Promise<AIAgentInfo>> = []
  for (let i = 0; i < userOrgs.length; i++) {
    const org = userOrgs[i]
    for (const addr of aiAddrsPerOrg[i]) {
      aiAgentTasks.push(getAgentMetadata(addr).then(meta => ({
        name: meta.displayName, primaryName: meta.primaryName,
        type: meta.aiAgentClass || 'custom', orgName: org.name, address: addr,
      })))
    }
  }
  const aiAgents: AIAgentInfo[] = await Promise.all(aiAgentTasks)

  return (
    <div>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: C.text, margin: '0 0 0.25rem' }}>{greeting}, {firstName}</h1>
      {primaryName && (
        <div style={{ fontSize: '0.78rem', color: C.accent, fontFamily: 'ui-monospace, monospace', marginBottom: '0.75rem' }}>{primaryName}</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem' }}>
        <KpiCard label="MY OIKOS" href="/oikos"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{oikosCount}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>people</span></KpiCard>
        <KpiCard label="PRAY NOW" href="/nurture/prayer"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{prayerDueCount}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>due today</span></KpiCard>
        <KpiCard label="MY CIRCLES" href="/groups"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{totalCircles}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>gatherings</span></KpiCard>
        <KpiCard label="PERSONAL WALK" href="/nurture/grow"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{walkPct}%</span></KpiCard>
        <KpiCard label="SOW THIS WEEK" href="/activity"><span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>{weekCount}</span><span style={{ fontSize: '0.72rem', color: C.textMuted }}>activities</span></KpiCard>
      </div>

      <DelegationSection userId={currentUser.id} />

      <AddGeoClaimPanel />
      <AddSkillClaimPanel />
      <AgentTrustSearch />

      {(userOrgs.length > 0 || hubAddress) && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
            <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>My Organizations</h2>
            {hubAddress && <CreateOrgButton hubAddress={hubAddress} hubName={hubName} hubId={hubId} label="New" />}
          </div>
          {orgsMeta.map(org => (
            <div key={org.address} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: C.accentLight, color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>{org.name.charAt(0)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link href={`/agents/${org.address}`} style={{ fontWeight: 600, fontSize: '0.85rem', color: C.text, textDecoration: 'none' }}>{org.name}</Link>
                  {org.primaryName && (
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: C.accent, background: C.accentLight, padding: '0.05rem 0.35rem', borderRadius: 6, border: `1px solid ${C.accentBorder}` }}>{org.primaryName}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.15rem' }}>
                  {org.roles.map(r => (
                    <span key={r} style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: 4, background: '#f5f5f5', color: '#616161', textTransform: 'capitalize' }}>{r}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <HeldCredentialsPanel />
        </div>
      )}

      {aiAgents.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>AI Agents</h2>
          {aiAgents.map(agent => (
            <div key={agent.address} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: '#f3e5f5', color: '#7b1fa2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.65rem', flexShrink: 0 }}>AI</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link href={`/agents/${agent.address}`} style={{ fontWeight: 600, fontSize: '0.85rem', color: C.text, textDecoration: 'none' }}>{agent.name}</Link>
                  {agent.primaryName && (
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#7b1fa2', background: '#f3e5f5', padding: '0.05rem 0.35rem', borderRadius: 6, border: '1px solid #e1bee7' }}>{agent.primaryName}</span>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: C.textMuted }}>{agent.type} &middot; {agent.orgName}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Delegation Section (shared across all dashboards) ──────────────

async function DelegationSection({ userId }: { userId: string }) {
  const { getIncomingDelegations, getOutgoingDelegations } = await import('@/lib/actions/data-delegation.action')
  const { getCoachRelationship, getDisciples } = await import('@/lib/actions/grow.action')
  const { getAgentMetadata: getMeta } = await import('@/lib/agent-metadata')
  const { listMyRelationshipsAction } = await import('@/lib/actions/list-my-relationships.action')

  // Top-level data fetches in parallel.
  const [incoming, outgoing, coachRel, disciples, onChainRels] = await Promise.all([
    getIncomingDelegations(userId),
    getOutgoingDelegations(userId),
    getCoachRelationship(userId),
    getDisciples(userId),
    listMyRelationshipsAction(),
  ])

  // Resolve every counterparty name in one parallel batch instead of N
  // serial RPC reads.
  const nameTargets = new Set<string>()
  if (coachRel) nameTargets.add(coachRel.coachId)
  for (const d of disciples) nameTargets.add(d.discipleId)
  for (const d of incoming) nameTargets.add(d.grantor)
  for (const d of outgoing) nameTargets.add(d.grantee)
  const targetArr = [...nameTargets]
  const metas = await Promise.all(targetArr.map(a => getMeta(a).catch(() => null)))
  const nameCache = new Map<string, string>()
  for (let i = 0; i < targetArr.length; i++) {
    nameCache.set(targetArr[i], metas[i]?.primaryName ?? '')
  }

  const totalCount = (coachRel ? 1 : 0) + disciples.length + incoming.length + outgoing.length + onChainRels.length
  const isEmpty = totalCount === 0

  return (
    <div
      style={{
        background: '#fff', border: '1px solid #ece6db', borderRadius: 12,
        padding: '1rem 1.25rem', marginBottom: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{
          fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e',
          textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0,
        }}>My Relationships</h2>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {totalCount} {totalCount === 1 ? 'edge' : 'edges'}
        </span>
      </div>

      {/* ─── New-relationship form (always visible) ───────────────── */}
      <AddRelationshipPanel />

      {/* ─── Existing relationships / delegations list ────────────── */}
      <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
        {isEmpty && (
          <div style={{ fontSize: 11, color: '#64748b' }}>
            No relationships yet. Pick an agent + relationship type above and click Add.
          </div>
        )}
        {coachRel && (
          <DelegationRow icon="Coach" iconBg="#7c3aed12" iconColor="#7c3aed" name={coachRel.coachName} agentName={nameCache.get(coachRel.coachId)} detail="Coaching you" tooltip="Your mentor in this community" />
        )}
        {disciples.map(d => (
          <DelegationRow key={d.id} icon="Disciple" iconBg="#7c3aed12" iconColor="#7c3aed" name={d.discipleName} agentName={nameCache.get(d.discipleId)} detail="You coach" badgeLabel="data shared" badgeColor="#2e7d32" tooltip="You are coaching this person. They have shared personal data with you." />
        ))}
        {incoming.map(d => {
          const fields = d.grants.flatMap(g => g.fields)
          return (
            <DelegationRow key={d.edgeId} icon="Received" iconBg="rgba(139,94,60,0.10)" iconColor="#8b5e3c" name={d.grantorName} agentName={nameCache.get(d.grantor)} detail={`Shared with you: ${fields.map(f => fieldLabel(f)).join(', ')}`} href="/catalyst/me/sharing" linkLabel="view" tooltip="This person has granted you access to their personal data" />
          )
        })}
        {outgoing.map(d => {
          const fields = d.grants.flatMap(g => g.fields)
          return (
            <DelegationRow key={d.edgeId} icon="Shared" iconBg="#ec489912" iconColor="#ec4899" name={d.granteeName} agentName={nameCache.get(d.grantee)} detail={`You shared: ${fields.map(f => fieldLabel(f)).join(', ')}`} href="/catalyst/me/sharing" linkLabel="manage" linkColor="#ec4899" linkBorder="#ec489930" linkBg="#ec489912" tooltip="You have granted this person access to your personal data" />
          )
        })}
        {onChainRels.map(r => {
          const isPending = r.status === 1
          const dirIcon = r.direction === 'outgoing' ? 'Out' : 'In'
          const detail = `${r.relationshipTypeLabel}${r.roleLabels.length ? ` · ${r.roleLabels.join(', ')}` : ''}${r.direction === 'incoming' ? ' (incoming)' : ''}`
          return (
            <DelegationRow
              key={r.edgeId}
              icon={dirIcon}
              iconBg={isPending ? '#fde68a' : '#dbeafe'}
              iconColor={isPending ? '#92400e' : '#1d4ed8'}
              name={r.counterpartyDisplayName}
              agentName={r.counterpartyPrimaryName ?? undefined}
              detail={detail}
              badgeLabel={isPending ? 'pending' : undefined}
              badgeColor={isPending ? '#92400e' : undefined}
              tooltip={isPending
                ? r.direction === 'outgoing'
                  ? 'Awaiting counterparty confirmation'
                  : 'Pending request from this agent — confirm on the Relationships page'
                : `Status: ${r.statusLabel}`}
              href={isPending && r.direction === 'incoming' ? '/relationships' : undefined}
              linkLabel={isPending && r.direction === 'incoming' ? 'review' : undefined}
            />
          )
        })}
      </div>
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

function hubMatchesId(
  hub: { displayName: string; primaryName: string },
  hubId: HubId,
): boolean {
  const haystack = `${hub.displayName} ${hub.primaryName}`.toLowerCase()
  if (hubId === 'catalyst') return haystack.includes('catalyst')
  if (hubId === 'global-church') return haystack.includes('global') && haystack.includes('church')
  if (hubId === 'cil') return haystack.includes('mission') || haystack.includes('collective') || haystack.includes('cil')
  return false
}

function DelegationRow({ icon, iconBg, iconColor, name, agentName, detail, tooltip, badgeLabel, badgeColor, href, linkLabel, linkColor, linkBorder, linkBg }: {
  icon: string; iconBg: string; iconColor: string; name: string; agentName?: string; detail: string; tooltip?: string
  badgeLabel?: string; badgeColor?: string
  href?: string; linkLabel?: string; linkColor?: string; linkBorder?: string; linkBg?: string
}) {
  return (
    <div title={tooltip} className={`flex items-center gap-3 py-2 border-b border-outline-variant ${tooltip ? 'cursor-help' : ''}`}>
      <span className="px-2 py-0.5 rounded-full text-label-sm font-bold whitespace-nowrap" style={{ background: iconBg, color: iconColor, border: `1px solid ${iconColor}25` }}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-title-sm font-semibold text-on-surface">{name}</span>
          {agentName && (
            <span className="font-mono text-label-sm text-primary bg-primary-container px-1.5 py-0.5 rounded border border-primary/10">{agentName}</span>
          )}
        </div>
        <div className="text-body-sm text-on-surface-variant truncate">{detail}</div>
      </div>
      {badgeLabel && (
        <span className="text-label-sm px-2 py-0.5 rounded-full font-semibold" style={{ background: `${badgeColor}12`, color: badgeColor, border: `1px solid ${badgeColor}30` }}>{badgeLabel}</span>
      )}
      {href && linkLabel && (
        <Link href={href} className="text-label-sm px-2.5 py-0.5 rounded-full font-semibold no-underline transition-all hover:shadow-elevation-1" style={{ background: linkBg ?? 'rgba(139,94,60,0.10)', color: linkColor ?? '#8b5e3c', border: `1px solid ${linkBorder ?? 'rgba(139,94,60,0.20)'}` }}>{linkLabel}</Link>
      )}
    </div>
  )
}

function KpiCard({ label, href, children, palette }: { label: string; href: string; children: React.ReactNode; palette?: typeof C }) {
  const P = palette ?? C
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 10, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', minHeight: 80 }}>
        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: P.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flex: 1 }}>{children}</div>
      </div>
    </Link>
  )
}
