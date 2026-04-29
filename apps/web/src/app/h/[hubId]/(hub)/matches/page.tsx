import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { listMatches, type MatchRow } from '@/lib/actions/discover.action'
import { MatchRowCard } from '@/components/discover/MatchRow'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  card: '#ffffff', border: '#ece6db',
}

/**
 * `/h/{slug}/matches` — index page.
 *
 * Lists every match where the current user is the matched agent,
 * grouped by status. Renders even when the user has zero matches —
 * "no matches yet" with a link to /discover. Replaces the 404 the
 * user hit when clicking back from /matches/[id].
 */
export default async function MatchesIndexPage({ params, searchParams }: {
  params: Promise<{ hubId: string }>
  searchParams: Promise<{ filter?: string }>
}) {
  const { hubId: slug } = await params
  const { filter } = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  const allMatches = myAgent
    ? await listMatches({ matchedAgent: myAgent, hydrate: true, minScore: 0, limit: 100 })
    : []

  const grouped = {
    proposed:  allMatches.filter(m => m.status === 'proposed'),
    accepted:  allMatches.filter(m => m.status === 'accepted'),
    fulfilled: allMatches.filter(m => m.status === 'fulfilled'),
    rejected:  allMatches.filter(m => m.status === 'rejected'),
    stale:     allMatches.filter(m => m.status === 'stale'),
  }

  const visible = filter && filter in grouped
    ? { [filter]: grouped[filter as keyof typeof grouped] } as Partial<typeof grouped>
    : grouped

  const totalProposed = grouped.proposed.length
  const totalAccepted = grouped.accepted.length

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Matches
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.3rem' }}>
          My matches
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: 0 }}>
          Intents the discovery engine paired your offerings with — accept, decline, or check on what you&apos;ve already committed to.
        </p>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <FilterPill href={`/h/${slug}/matches`} active={!filter} count={allMatches.length}>All</FilterPill>
        <FilterPill href={`/h/${slug}/matches?filter=proposed`}  active={filter === 'proposed'}  count={grouped.proposed.length}>Proposed</FilterPill>
        <FilterPill href={`/h/${slug}/matches?filter=accepted`}  active={filter === 'accepted'}  count={grouped.accepted.length}>Accepted</FilterPill>
        <FilterPill href={`/h/${slug}/matches?filter=fulfilled`} active={filter === 'fulfilled'} count={grouped.fulfilled.length}>Fulfilled</FilterPill>
        <FilterPill href={`/h/${slug}/matches?filter=rejected`}  active={filter === 'rejected'}  count={grouped.rejected.length}>Declined</FilterPill>
      </div>

      {allMatches.length === 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>No matches yet</div>
          <div style={{ fontSize: '0.82rem', color: C.textMuted, marginBottom: '0.85rem' }}>
            Matches are created when the discovery engine pairs an open need with one of your offerings.
          </div>
          <Link href={`/h/${slug}/discover`} style={{ display: 'inline-block', padding: '0.5rem 0.9rem', background: C.accent, color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
            Browse open needs →
          </Link>
        </div>
      )}

      {(['proposed', 'accepted', 'fulfilled', 'rejected', 'stale'] as const).map(status => {
        const list = visible[status]
        if (!list || list.length === 0) return null
        return (
          <Section key={status} title={SECTION_TITLES[status]} count={list.length}>
            {list.map((m: MatchRow) => <MatchRowCard key={m.id} match={m} hubSlug={slug} showNeed />)}
          </Section>
        )
      })}

      {/* Quick context strip back to discover when there's something to show */}
      {allMatches.length > 0 && (
        <div style={{ marginTop: '1rem', fontSize: '0.78rem', color: C.textMuted }}>
          {totalProposed > 0 && <>{totalProposed} awaiting your decision · </>}
          {totalAccepted > 0 && <>{totalAccepted} in progress · </>}
          <Link href={`/h/${slug}/discover`} style={{ color: C.accent, fontWeight: 600 }}>Discover more →</Link>
        </div>
      )}
    </div>
  )
}

const SECTION_TITLES: Record<string, string> = {
  proposed:  'Proposed — awaiting your decision',
  accepted:  'Accepted — in progress',
  fulfilled: 'Fulfilled',
  rejected:  'Declined',
  stale:     'Stale',
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '1.25rem' }}>
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
        {title} ({count})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {children}
      </div>
    </section>
  )
}

function FilterPill({ href, active, count, children }: { href: string; active: boolean; count: number; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        padding: '0.3rem 0.7rem',
        fontSize: '0.72rem',
        fontWeight: 600,
        borderRadius: 999,
        textDecoration: 'none',
        background: active ? C.accent : '#fff',
        color: active ? '#fff' : C.text,
        border: `1px solid ${active ? C.accent : C.border}`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
      }}
    >
      {children}
      <span style={{ fontSize: '0.65rem', opacity: 0.75 }}>{count}</span>
    </Link>
  )
}
