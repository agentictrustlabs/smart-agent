/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Rounds index (T032).
 *
 * Server component. Browse open rounds with mandate-match badges.
 *
 * Composition:
 *   - <RoundFilters />  — client component, pushes filter state to URL
 *   - <RoundCard />[]   — server component, one per round
 *   - <EmptyState />    — server component, friendly empty message (FR-004)
 *
 * Data flow (action layer → discovery → SPARQL → GraphDB):
 *   listRoundsForViewer({ hubId, viewerAgentId, …filters })
 *     → DiscoveryService.listRounds(filters)        // public mirror read
 *     → SPARQL narrows on deadline / search / domain / closed-toggle
 *     → discovery applies budget range + visibility-or-addressed gate
 *     → action layer applies mandate-match overlap (FR-001 / Research R2)
 *
 * Implements FR-001 / FR-002 / FR-003 / FR-004.
 */

import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { listRoundsForViewer } from '@/lib/actions/rounds.action'
import { RoundFilters } from './(components)/RoundFilters'
import { RoundCard } from './(components)/RoundCard'
import { EmptyState } from './(components)/EmptyState'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
}

type RawSearch = { [k: string]: string | string[] | undefined }

function pickStr(sp: RawSearch, key: string): string | undefined {
  const v = sp[key]
  if (Array.isArray(v)) return v[0]
  return v
}

function pickNum(sp: RawSearch, key: string): number | undefined {
  const s = pickStr(sp, key)
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function pickHorizon(sp: RawSearch): 'this-week' | 'this-month' | 'this-quarter' | 'all' | undefined {
  const v = pickStr(sp, 'deadline')
  if (v === 'this-week' || v === 'this-month' || v === 'this-quarter' || v === 'all') return v
  return undefined
}

export default async function RoundsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ hubId: string }>
  searchParams: Promise<RawSearch>
}) {
  const { hubId: slug } = await params
  const sp = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)

  const domain = pickStr(sp, 'domain')
  const deadlineHorizon = pickHorizon(sp)
  const budgetMin = pickNum(sp, 'budgetMin')
  const budgetMax = pickNum(sp, 'budgetMax')
  const search = pickStr(sp, 'search')
  const includeClosed = pickStr(sp, 'includeClosed') === '1'

  const hasFilters = !!(domain || (deadlineHorizon && deadlineHorizon !== 'all') || budgetMin || budgetMax || search || includeClosed)

  const rounds = myAgent
    ? await listRoundsForViewer({
        hubId: internalHubId,
        viewerAgentId: myAgent,
        domain,
        deadlineHorizon,
        budgetMin,
        budgetMax,
        search,
        includeClosed,
      })
    : []

  const total = rounds.length
  const matchedCount = rounds.filter(r => r.matchedIntentIds.length > 0).length

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Rounds
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
            Open rounds {total > 0 && <span style={{ color: C.textMuted, fontSize: '0.95rem', fontWeight: 500 }}>({total})</span>}
          </h1>
        </div>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          Grant rounds, RFPs, and proposal windows from funds operating in this hub.
          {matchedCount > 0 && (
            <> {matchedCount} match your expressed intent{matchedCount === 1 ? '' : 's'}.</>
          )}
        </p>
      </div>

      <RoundFilters hubSlug={slug} />

      {total === 0 ? (
        <EmptyState
          hubSlug={slug}
          hint={hasFilters ? (includeClosed ? 'widen-filters' : 'include-closed') : 'no-rounds'}
          hasFilters={hasFilters}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {rounds.map((r) => (
            <RoundCard key={r.id} round={r} hubSlug={slug} />
          ))}
        </div>
      )}
    </div>
  )
}
