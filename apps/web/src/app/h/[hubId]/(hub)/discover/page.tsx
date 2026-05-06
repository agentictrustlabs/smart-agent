import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { listNeeds } from '@/lib/actions/needs.action'
import { listMatches, getHubDiscoverSummary } from '@/lib/actions/discover.action'
import { listRoundsForViewer } from '@/lib/actions/rounds.action'
import { listMemberProposals } from '@/lib/actions/grantProposals.action'
import { listPoolsForViewer } from '@/lib/actions/pools.action'
import { listIntents } from '@/lib/actions/intents.action'
import { listTopCandidatesForViewer } from '@/lib/actions/matchInitiations.action'
import { NeedCard } from '@/components/discover/NeedCard'
import { MatchRowCard } from '@/components/discover/MatchRow'

export const dynamic = 'force-dynamic'

const C = {
  bg: '#faf8f3',
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
}

/**
 * /h/{slug}/discover — gap-to-capacity matching surface.
 *
 * Layout:
 *   1. Hero strip — hub eyebrow + "Discover" + headline counts
 *   2. Top open needs (priority-sorted, top 5)
 *   3. My proposed matches (matches assigned to my agent)
 *   4. CTAs: Browse all needs / My offerings
 */
export default async function DiscoverPage({ params }: { params: Promise<{ hubId: string }> }) {
  const { hubId: slug } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const summary = await getHubDiscoverSummary(internalHubId)
  const allOpenNeeds = await listNeeds({ hubId: internalHubId, status: 'open' })

  // My proposed matches: where I'm the matched agent and status=proposed.
  // We resolve "my" via the user's person agent (same source the work-queue uses).
  const { getPersonAgentForUser } = await import('@/lib/agent-registry')
  const myAgent = await getPersonAgentForUser(user.id)
  const myMatches = myAgent
    ? await listMatches({ matchedAgent: myAgent, status: 'proposed', hydrate: true, limit: 10 })
    : []

  // Spec 001 — Match candidates for the viewer's expressed intents.
  // For each of Maria's expressed intents, surface up to 2 ranked candidates
  // as a compact preview; each row links to the intent detail for the full
  // candidate list.
  const myExpressedIntents = myAgent
    ? await listIntents({
        hubId: internalHubId,
        expressedBy: myAgent,
        status: 'expressed',
        limit: 8,
      }).catch(() => [])
    : []
  const topCandidatesByIntent = myAgent && myExpressedIntents.length > 0
    ? await listTopCandidatesForViewer({
        viewerAgentAddress: myAgent,
        intentIds: myExpressedIntents.map(i => i.id),
        topPerIntent: 2,
      }).catch(() => [])
    : []
  const matchCandidatePreviews = topCandidatesByIntent
    .filter(group => group.candidates.length > 0)
    .slice(0, 4)

  // Spec 003 — Open grant rounds (mandate-matched against the viewer's intents)
  // and the viewer's own GrantProposals (drafts + submitted). Best-effort —
  // when discovery / MCP is unavailable, the section renders an empty state.
  const openRounds = myAgent
    ? await listRoundsForViewer({
        hubId: internalHubId,
        viewerAgentId: myAgent,
        deadlineHorizon: 'all',
        includeClosed: false,
      }).catch(() => [])
    : []

  const myProposalsResult = await listMemberProposals().catch(() => ({ proposals: [] }))
  const myProposals = myProposalsResult.proposals.slice(0, 5)

  // Spec 002 — Open pools (pool-lane discovery). Best-effort.
  const openPools = myAgent
    ? await listPoolsForViewer({
        hubId: internalHubId,
        viewerAgentId: myAgent,
      }).catch(() => [])
    : []

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* Hero */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.15rem' }}>
          {profile.name} · Discover
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0 0 0.2rem' }}>
          Gaps & capacity
        </h1>
        <div style={{ fontSize: '0.85rem', color: C.textMuted }}>
          Where the hub needs help, and which offerings could fill the gap.
        </div>
      </div>

      {/* Headline counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem', marginBottom: '1.25rem' }} className="catalyst-kpi-grid">
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.75rem' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>OPEN NEEDS</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 700, color: C.accent }}>{summary.openNeeds}</div>
          <div style={{ fontSize: '0.7rem', color: C.textMuted }}>across the hub</div>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.75rem' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>PROPOSED MATCHES</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 700, color: C.accent }}>{summary.proposedMatches}</div>
          <div style={{ fontSize: '0.7rem', color: C.textMuted }}>awaiting decisions</div>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.75rem' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>MY MATCHES</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 700, color: C.accent }}>{myMatches.length}</div>
          <div style={{ fontSize: '0.7rem', color: C.textMuted }}>proposed for you</div>
        </div>
      </div>

      {/* My proposed matches (if any) */}
      {myMatches.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            Proposed matches for you
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {myMatches.map(m => <MatchRowCard key={m.id} match={m} hubSlug={slug} showNeed />)}
          </div>
        </section>
      )}

      {/* Top open needs */}
      <section style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Top open needs
          </h2>
          <Link href={`/h/${slug}/needs`} style={{ fontSize: '0.7rem', color: C.accent, textDecoration: 'none', fontWeight: 600 }}>
            Browse all →
          </Link>
        </div>
        {summary.topNeeds.length === 0 ? (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1rem', fontSize: '0.85rem', color: C.textMuted, textAlign: 'center' }}>
            No open needs right now. <Link href={`/h/${slug}/needs/new`} style={{ color: C.accent }}>File a need →</Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {summary.topNeeds.map(n => <NeedCard key={n.id} need={n} hubSlug={slug} />)}
          </div>
        )}
      </section>

      {/* Match candidates for your intents (spec 001) */}
      {matchCandidatePreviews.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
              Match candidates for your intents
            </h2>
            <Link href={`/h/${slug}/intents`} style={{ fontSize: '0.7rem', color: C.accent, textDecoration: 'none', fontWeight: 600 }}>
              All my intents →
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {matchCandidatePreviews.map((group) => {
              const viewedIntent = myExpressedIntents.find(i => i.id === group.viewedIntentId)
              if (!viewedIntent) return null
              return (
                <Link
                  key={group.viewedIntentId}
                  href={`/h/${slug}/intents/${group.viewedIntentId}`}
                  style={{ display: 'block', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.7rem 0.85rem', textDecoration: 'none' }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: C.text, marginBottom: '0.2rem' }}>
                    {viewedIntent.title}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: C.textMuted, marginBottom: '0.35rem' }}>
                    {group.candidates.length} compatible counter-intent{group.candidates.length === 1 ? '' : 's'} ready to match
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {group.candidates.map((c) => (
                      <div key={c.intent.id} style={{ fontSize: '0.74rem', color: C.text, display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: C.accent, padding: '0.06rem 0.4rem', borderRadius: 999, background: 'rgba(139,94,60,0.08)', border: `1px solid rgba(139,94,60,0.20)` }}>
                          {c.cue}
                        </span>
                        <span style={{ fontWeight: 600 }}>{c.intent.title}</span>
                      </div>
                    ))}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Open grant rounds (spec 003) */}
      <section style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Open grant rounds
          </h2>
          <Link href={`/h/${slug}/rounds`} style={{ fontSize: '0.7rem', color: C.accent, textDecoration: 'none', fontWeight: 600 }}>
            Browse all →
          </Link>
        </div>
        {openRounds.length === 0 ? (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1rem', fontSize: '0.85rem', color: C.textMuted, textAlign: 'center' }}>
            No open rounds in this hub.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {openRounds.slice(0, 3).map(r => {
              const matches = (r.matchedIntentIds?.length ?? 0) > 0
              const deadline = new Date(r.deadline)
              const daysLeft = Math.max(0, Math.round((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
              return (
                <Link key={r.id} href={`/h/${slug}/rounds/${r.id.replace(/^urn:smart-agent:round:/, '')}`} style={{ display: 'block', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.7rem 0.85rem', textDecoration: 'none' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text, marginBottom: '0.2rem' }}>
                    {(r.mandate?.acceptedKinds ?? []).slice(0, 3).join(', ') || 'Open round'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: C.textMuted, display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                    <span>ceiling ${r.mandate?.budgetCeiling?.toLocaleString() ?? '—'}</span>
                    <span>· {r.mandate?.expectedAwards ?? '—'} expected awards</span>
                    <span>· deadline in {daysLeft}d</span>
                    {matches && <span style={{ color: C.accent, fontWeight: 600 }}>✓ matches your intent</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* My grant proposals (spec 003) */}
      {myProposals.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
              My grant proposals
            </h2>
            <Link href={`/h/${slug}/proposals`} style={{ fontSize: '0.7rem', color: C.accent, textDecoration: 'none', fontWeight: 600 }}>
              Manage all →
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {myProposals.map(p => {
              const idShort = p.id.replace(/^urn:smart-agent:grant-proposal:/, '')
              return (
                <Link key={p.id} href={`/h/${slug}/proposals/${idShort}`} style={{ display: 'block', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.7rem 0.85rem', textDecoration: 'none' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text, marginBottom: '0.2rem' }}>
                    {(p.budget?.lineItems?.[0]?.name) ?? idShort}
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', fontWeight: 600, padding: '0.08rem 0.45rem', borderRadius: 4, background: p.status === 'submitted' ? C.accent : C.accentLight, color: p.status === 'submitted' ? '#fff' : C.accent, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {p.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
                    Budget ${p.budget?.total?.toLocaleString() ?? '—'} · {p.milestones?.length ?? 0} milestones
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Open pools (spec 002) */}
      <section style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Open pools
          </h2>
          <Link href={`/h/${slug}/pools`} style={{ fontSize: '0.7rem', color: C.accent, textDecoration: 'none', fontWeight: 600 }}>
            Browse all →
          </Link>
        </div>
        {openPools.length === 0 ? (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1rem', fontSize: '0.85rem', color: C.textMuted, textAlign: 'center' }}>
            No open pools in this hub.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {openPools.slice(0, 3).map(p => {
              const primaryUnit = p.acceptedUnits[0] ?? 'USD'
              return (
                <Link key={p.id} href={`/h/${slug}/pools/${encodeURIComponent(p.id)}`} style={{ display: 'block', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.7rem 0.85rem', textDecoration: 'none' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text, marginBottom: '0.2rem' }}>
                    {p.name || 'Unnamed pool'}
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.6rem', fontWeight: 700, color: C.accent, padding: '0.1rem 0.45rem', borderRadius: 999, background: C.accentLight, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {p.domain}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: C.textMuted, display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                    <span>pledged {p.pledgedTotal} {primaryUnit}</span>
                    {p.capacityCeiling != null && <span>· ceiling {p.capacityCeiling} {primaryUnit}</span>}
                    <span>· {p.governanceModel}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Footer CTAs */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Link href={`/h/${slug}/needs`} style={{ display: 'inline-block', padding: '0.55rem 1rem', background: C.accent, color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
          All open needs ({allOpenNeeds.length})
        </Link>
        <Link href={`/h/${slug}/rounds`} style={{ display: 'inline-block', padding: '0.55rem 1rem', background: '#fff', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
          Grant rounds
        </Link>
        <Link href={`/h/${slug}/proposals`} style={{ display: 'inline-block', padding: '0.55rem 1rem', background: '#fff', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
          My proposals
        </Link>
        <Link href={`/h/${slug}/pools`} style={{ display: 'inline-block', padding: '0.55rem 1rem', background: '#fff', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
          Pools
        </Link>
        <Link href={`/h/${slug}/pledges`} style={{ display: 'inline-block', padding: '0.55rem 1rem', background: '#fff', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
          My pledges
        </Link>
        <Link href={`/h/${slug}/offerings`} style={{ display: 'inline-block', padding: '0.55rem 1rem', background: '#fff', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
          My offerings
        </Link>
        <Link href={`/h/${slug}/needs/new`} style={{ display: 'inline-block', padding: '0.55rem 1rem', background: '#fff', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
          + File a new need
        </Link>
      </div>
    </div>
  )
}
