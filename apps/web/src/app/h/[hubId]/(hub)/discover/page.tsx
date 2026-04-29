import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { listNeeds } from '@/lib/actions/needs.action'
import { listMatches, getHubDiscoverSummary } from '@/lib/actions/discover.action'
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

      {/* Footer CTAs */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Link href={`/h/${slug}/needs`} style={{ display: 'inline-block', padding: '0.55rem 1rem', background: C.accent, color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
          All open needs ({allOpenNeeds.length})
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
