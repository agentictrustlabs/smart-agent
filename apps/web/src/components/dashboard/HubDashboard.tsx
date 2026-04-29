import Link from 'next/link'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { eq, desc } from 'drizzle-orm'
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
import { MyWorkPanel } from '@/components/work-queue/MyWorkPanel'
import { DashboardForMode } from '@/components/dashboard/modes/DashboardForMode'
import { AddRelationshipPanel } from '@/components/profile/AddRelationshipPanel'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import type { HubId } from '@/lib/hub-profiles'
import { getHubProfile } from '@/lib/hub-profiles'
import { defaultModeForRole } from '@/lib/work-queue/role-modes'
import type { WorkMode } from '@/lib/work-queue/types'
import { DEMO_USER_META } from '@/lib/auth/session'
import { CatalystFooterCTA } from '@/components/catalyst/CatalystFooterCTA'
import { CatalystFieldZone } from '@/components/catalyst/CatalystFieldZone'
import { CatalystAttentionStrip, CatalystAttentionStripSkeleton } from '@/components/catalyst/CatalystAttentionStrip'
import { OpenNeedsStrip } from '@/components/discover/OpenNeedsStrip'

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
  currentUser: { id: string; name: string; email?: string | null; did?: string | null }
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

      <MyWorkPanel />
      <DashboardForMode onChainRoles={userOrgs.flatMap(o => o.roles)} />
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
  currentUser: { id: string; name: string; did?: string | null }
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

  // Push the org/user filter into the DB instead of scanning every
  // activity_logs row in JS. With the catalyst seed at ~111 activities
  // this saved ~150ms per render; grows linearly with demo activity.
  const { inArray, or } = await import('drizzle-orm')
  const orgFilter = userOrgs.length > 0 ? inArray(schema.activityLogs.orgAddress, userOrgs.map(o => o.address.toLowerCase())) : undefined
  const userFilter = inArray(schema.activityLogs.userId, [...orgUserIds])
  const where = orgFilter ? or(orgFilter, userFilter) : userFilter
  const activities = await db.select().from(schema.activityLogs)
    .where(where)
    .orderBy(desc(schema.activityLogs.activityDate))
    .limit(120)
  const thisWeekIso = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const weekCount = activities.filter(a => a.activityDate >= thisWeekIso).length

  // Fan out every per-org RPC + the unrelated DB queries in parallel.
  // PERF: dropped getAiAgentsForOrg from the critical path — the AI-agents
  // count was only used to render the inventory-row tile, which now shows
  // "—" linking to /agents where the full list is computed lazily.
  const { eq } = await import('drizzle-orm')
  const { getTrainingProgress } = await import('@/lib/actions/grow.action')
  const [
    connectedOrgLists,
    oikosRows,
    allPrayers,
    progress,
  ] = await Promise.all([
    Promise.all(userOrgs.map(o => getConnectedOrgs(o.address).catch(() => []))),
    db.select().from(schema.circles).where(eq(schema.circles.userId, currentUser.id)).catch(() => []),
    db.select().from(schema.prayers).where(eq(schema.prayers.userId, currentUser.id)).catch(() => []),
    getTrainingProgress(currentUser.id),
  ])

  // Aggregate connected (sister) circles for "My Circles" count + field list.
  type ConnectedRow = { address: string; name: string }
  const connectedCircles: ConnectedRow[] = []
  for (let i = 0; i < userOrgs.length; i++) {
    for (const c of connectedOrgLists[i]) {
      if (!connectedCircles.find(x => x.address === c.address)) {
        connectedCircles.push({ address: c.address, name: c.name })
      }
    }
  }
  const totalCircles = userOrgs.length + connectedCircles.length

  const oikosCount = oikosRows.length
  const days = ['sun','mon','tue','wed','thu','fri','sat']
  const today = days[new Date().getDay()]
  const prayerDueCount = allPrayers.filter(p => !p.answered && (p.schedule === 'daily' || p.schedule.includes(today))).length
  const walkPct = Math.round((progress.filter(p => p.completed === 1).length / 28) * 100)

  // ─── Mode resolution (drives KPI branching + persona subhead) ──
  const role = pickRoleForUser(currentUser.did ?? null, userOrgs.flatMap(o => o.roles))
  const mode: WorkMode = defaultModeForRole(role)

  // ─── Hub profile (eyebrow text on the hero) ────────────────────
  const hubProfile = getHubProfile(hubId)

  // ─── Attention items moved into <CatalystAttentionStrip> ───────
  // The strip is rendered behind a Suspense boundary so the rest of
  // the page (hero, KPIs, work zone) doesn't block on the chain RPC
  // (`listMyRelationshipsAction`) it triggers. Count-driven KPIs
  // (`NEEDS ATTENTION` / `PENDING REQUESTS`) read undefined here and
  // light up after the strip resolves on the client; the persona
  // subhead picks a calmer label that doesn't need the count.

  // ─── KPI selection (4 tiles, branched by mode) ─────────────────
  const kpis = pickKpisForMode({ mode, oikosCount, prayerDueCount, totalCircles, walkPct, weekCount, pendingIncoming: 0, attentionCount: 0 })

  // ─── First-org address for QuickActivityModal binding ──────────
  const firstOrgAddr = userOrgs[0]?.address ?? hubAddress ?? null

  // ─── Persona subhead (named by mode) ───────────────────────────
  // Attention count is unknown until the suspended strip resolves;
  // pass 0 so the subhead picks the "all clear" wording. The strip
  // itself shows the real count once it streams in.
  const subhead = personaSubhead({ mode, totalCircles, attentionCount: 0 })

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div style={{ paddingBottom: '4.5rem' }}>
      {/* Zone 1 — Hero strip */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.15rem' }}>
          {hubProfile.name}{hubProfile.description ? ` · ${hubProfile.description.split('—')[0].trim()}` : ''}
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0 0 0.2rem' }}>
          {greeting}, {firstName}
        </h1>
        <div style={{ fontSize: '0.85rem', color: C.textMuted, display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span>{subhead}</span>
          {primaryName && (
            <span title={`Your unique name in this network: ${primaryName}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem', color: C.textMuted, cursor: 'help' }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: C.accentLight, color: C.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.6rem' }}>?</span>
            </span>
          )}
        </div>
      </div>

      {/* Zone 2 — Needs Attention (renders only when items > 0).
          Suspense'd: the strip's data load (chain RPC for pending
          relationships) shouldn't block the rest of the page. */}
      <Suspense fallback={<CatalystAttentionStripSkeleton />}>
        <CatalystAttentionStrip userId={currentUser.id} userOrgs={userOrgs} hubSlug="catalyst" />
      </Suspense>

      {/* Zone 3 — Role-aware KPI row (4 tiles, or zero-state welcome) */}
      {kpis.allZero ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text, marginBottom: '0.35rem' }}>Welcome to {hubProfile.name}</div>
          <div style={{ fontSize: '0.82rem', color: C.textMuted, marginBottom: '0.75rem' }}>You&apos;re a member — here are three first steps:</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link href="/groups" style={ctaBtn(C.accent)}>Find your group</Link>
            <Link href="/oikos" style={ctaBtn(C.accent)}>Add someone to your oikos</Link>
            <Link href="/nurture" style={ctaBtn(C.accent)}>Start nurture</Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem', marginBottom: '1rem' }} className="catalyst-kpi-grid">
          {kpis.tiles.map(tile => (
            <KpiCard key={tile.label} label={tile.label} href={tile.href}>
              <span style={{ fontSize: '1.7rem', fontWeight: 700, color: C.accent }}>{tile.value}</span>
              <span style={{ fontSize: '0.72rem', color: C.textMuted }}>{tile.detail}</span>
            </KpiCard>
          ))}
        </div>
      )}

      {/* Zone 4 — Work zone (2-col 60/40 on desktop; mode picker is in MyWorkPanel itself) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: '0.75rem', marginBottom: '1rem' }} className="catalyst-work-grid">
        <div>
          <MyWorkPanel />
        </div>
        <div>
          <DashboardForMode onChainRoles={userOrgs.flatMap(o => o.roles)} />
        </div>
      </div>

      {/* Zone 4.5 — Where the hub needs help (Discover layer).
          Re-anchored from Zone 2.5 to here, AFTER the work zone, so
          it doesn't twin with NeedsAttentionCard. Suspense'd so the
          intents query never blocks first paint. */}
      <Suspense fallback={<div style={{ height: 90, background: 'rgba(13,148,136,0.04)', borderRadius: 12, marginBottom: '1rem' }} aria-hidden />}>
        <OpenNeedsStrip hubId={hubId} hubSlug="catalyst" />
      </Suspense>

      {/* Zone 5 — Field zone (activities + circles) */}
      <CatalystFieldZone
        activities={activities.slice(0, 5).map(a => ({
          id: a.id,
          activityType: a.activityType,
          title: a.title,
          activityDate: a.activityDate,
          orgAddress: a.orgAddress,
        }))}
        myCircles={[...userOrgs.map(o => ({ address: o.address, name: o.name, role: o.roles[0] ?? 'member' })), ...connectedCircles.map(c => ({ address: c.address, name: c.name, role: 'connected' }))]}
        firstOrgAddr={firstOrgAddr}
      />

      {/* Zone 6 — Inventory KPI row (4 link cards replace 4 panels) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem', marginBottom: '1rem' }} className="catalyst-inventory-grid">
        <InventoryKpi label="CONNECTIONS" count={totalCircles + 0 /* connections counted in DelegationSection */} href="/me/relationships" detail="people you work with" />
        <InventoryKpi label="GROUPS" count={userOrgs.length} href="/groups" detail="you're a member of" actionHref={hubAddress ? '/groups/new' : undefined} actionLabel={hubAddress ? '+ New' : undefined} />
        <InventoryKpi label="AI AGENTS" count={undefined} href="/agents" detail="deployed in your orgs" />
        <InventoryKpi label="CREDENTIALS" count={undefined} href="/me/credentials" detail="vault & shared" />
      </div>

      {/* DelegationSection demoted: it lives below the inventory row, but lighter
          chrome. Suspense'd because it does many chain reads — the heaviest
          remaining block on the home. Future: split into list-only on home +
          form-only on /me/relationships. */}
      <Suspense fallback={<div style={{ height: 100, background: '#fff', border: '1px solid #ece6db', borderRadius: 12, marginBottom: '1rem' }} aria-hidden />}>
        <DelegationSection userId={currentUser.id} />
      </Suspense>

      {/* Zone 7 — Footer CTA strip */}
      <CatalystFooterCTA mode={mode} firstOrgAddr={firstOrgAddr} />
    </div>
  )
}

// ─── Catalyst dashboard helpers ─────────────────────────────────────

function pickRoleForUser(did: string | null, onChainRoles: string[]): string {
  if (did) {
    for (const meta of Object.values(DEMO_USER_META)) {
      if (meta.userId === did) return meta.role
    }
  }
  return onChainRoles[0] ?? ''
}

function ctaBtn(accent: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '0.45rem 0.85rem',
    background: accent,
    color: '#fff',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: '0.8rem',
    textDecoration: 'none',
  }
}

interface KpiTile {
  label: string
  href: string
  value: string | number
  detail: string
}

function pickKpisForMode(args: {
  mode: WorkMode
  oikosCount: number
  prayerDueCount: number
  totalCircles: number
  walkPct: number
  weekCount: number
  pendingIncoming: number
  attentionCount: number
}): { tiles: KpiTile[]; allZero: boolean } {
  let tiles: KpiTile[] = []
  switch (args.mode) {
    case 'govern':
      tiles = [
        { label: 'ACTIVE GROUPS', href: '/groups', value: args.totalCircles, detail: 'across the hub' },
        { label: 'THIS WEEK', href: '/activity', value: args.weekCount, detail: 'activities logged' },
        { label: 'NEEDS ATTENTION', href: '#', value: args.attentionCount, detail: 'open items' },
        { label: 'PENDING REQUESTS', href: '/relationships', value: args.pendingIncoming, detail: 'awaiting you' },
      ]
      break
    case 'route':
      tiles = [
        { label: 'PENDING REQUESTS', href: '/relationships', value: args.pendingIncoming, detail: 'awaiting you' },
        { label: 'THIS WEEK', href: '/activity', value: args.weekCount, detail: 'activities logged' },
        { label: 'MY CIRCLES', href: '/groups', value: args.totalCircles, detail: 'gatherings' },
        { label: 'NEEDS ATTENTION', href: '#', value: args.attentionCount, detail: 'open items' },
      ]
      break
    case 'disciple':
    case 'walk':
    case 'discover':
    default:
      tiles = [
        { label: 'MY OIKOS', href: '/oikos', value: args.oikosCount, detail: 'people' },
        { label: 'PRAY NOW', href: '/nurture/prayer', value: args.prayerDueCount, detail: 'due today' },
        { label: 'MY CIRCLES', href: '/groups', value: args.totalCircles, detail: 'gatherings' },
        { label: 'PERSONAL WALK', href: '/nurture/grow', value: `${args.walkPct}%`, detail: 'this 4-week cycle' },
      ]
      break
  }
  const allZero = tiles.every(t => (typeof t.value === 'number' ? t.value === 0 : t.value === '0%'))
  return { tiles, allZero }
}

function personaSubhead({ mode, totalCircles, attentionCount }: { mode: WorkMode; totalCircles: number; attentionCount: number }): string {
  switch (mode) {
    case 'govern':
      return attentionCount > 0
        ? `Hub Lead · ${totalCircles} group${totalCircles === 1 ? '' : 's'} · ${attentionCount} need${attentionCount === 1 ? 's' : ''} attention`
        : `Hub Lead · ${totalCircles} group${totalCircles === 1 ? '' : 's'} · all clear`
    case 'route':
      return 'Coordinator · route incoming requests'
    case 'disciple':
      return totalCircles > 0
        ? `Group Leader · ${totalCircles} circle${totalCircles === 1 ? '' : 's'} · log this week's gathering →`
        : 'Group Leader · ready to start'
    case 'walk':
      return 'Disciple · keep going'
    case 'discover':
      return 'Discover · find a coach or a circle'
    default:
      return ''
  }
}

function InventoryKpi({ label, count, href, detail, actionHref, actionLabel }: {
  label: string
  count: number | undefined
  href: string
  detail: string
  actionHref?: string
  actionLabel?: string
}) {
  // Use one outer card with `position: relative`, a Link covering the whole
  // card via `position: absolute` (the navigation surface), and the action
  // Link rendered after it as a sibling at z-index above the absolute Link.
  // This keeps both anchors and avoids nesting them.
  return (
    <div style={{ position: 'relative', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.65rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', minHeight: 72 }}>
      <Link
        href={href}
        aria-label={label}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 10,
          textDecoration: 'none',
          zIndex: 1,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 2, pointerEvents: 'none' }}>
        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            style={{ fontSize: '0.65rem', color: C.accent, textDecoration: 'none', fontWeight: 600, pointerEvents: 'auto' }}
          >
            {actionLabel}
          </Link>
        )}
      </div>
      <span style={{ fontSize: '1.4rem', fontWeight: 700, color: C.accent, position: 'relative', zIndex: 2, pointerEvents: 'none' }}>{count !== undefined ? count : '—'}</span>
      <span style={{ fontSize: '0.7rem', color: C.textMuted, position: 'relative', zIndex: 2, pointerEvents: 'none' }}>{detail}</span>
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
        }}>My Connections</h2>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {totalCount} {totalCount === 1 ? 'connection' : 'connections'}
        </span>
      </div>

      {/* ─── New-connection form (always visible) ─────────────────── */}
      <AddRelationshipPanel />

      {/* ─── Existing connections / sharing list ──────────────────── */}
      <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
        {isEmpty && (
          <div style={{ fontSize: 11, color: '#64748b' }}>
            No connections yet. Pick a person + relationship type above and click Add.
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
          // Chip = "Pending" while awaiting confirmation; otherwise the
          // human-readable role (preferred — "Coach", "Member", "Trustee")
          // falling back to the relationship type ("Coaching", "Governance").
          // Direction is meaningless once a relationship is active, so we
          // surface it only for pending rows via the detail text + the
          // `review` CTA on incoming requests.
          const chipLabel = isPending
            ? 'Pending'
            : (r.roleLabels[0] ?? r.relationshipTypeLabel)
          const detailParts: string[] = [r.relationshipTypeLabel]
          if (!isPending && r.roleLabels.length > 1) {
            detailParts.push(r.roleLabels.slice(1).join(', '))
          }
          if (isPending) {
            detailParts.push(r.direction === 'outgoing' ? 'you initiated · awaiting them' : 'awaiting your reply')
          }
          const detail = detailParts.join(' · ')
          return (
            <DelegationRow
              key={r.edgeId}
              icon={chipLabel}
              // Pending: amber. Confirmed/active: neutral slate so on-chain rows
              // visually defer to the warmer Coach/Disciple/Shared/Received chips.
              iconBg={isPending ? '#fde68a' : '#e2e8f0'}
              iconColor={isPending ? '#92400e' : '#475569'}
              name={r.counterpartyDisplayName}
              agentName={r.counterpartyPrimaryName ?? undefined}
              detail={detail}
              tooltip={isPending
                ? r.direction === 'outgoing'
                  ? `${r.relationshipTypeLabel} request — awaiting ${r.counterpartyDisplayName}'s confirmation`
                  : `${r.relationshipTypeLabel} request from ${r.counterpartyDisplayName} — confirm on the Connections page`
                : `${r.relationshipTypeLabel} · ${r.statusLabel}`}
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
