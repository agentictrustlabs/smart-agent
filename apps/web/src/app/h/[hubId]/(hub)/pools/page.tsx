/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pools index (US1).
 *
 * Server component. Browse open pools with filters (domain, governance
 * model, geo, free-text). Implements FR-001 / FR-002 / FR-003 / FR-004.
 *
 * Composition:
 *   - <PoolFilters />  — client component, pushes filter state to URL
 *   - <PoolCard />[]   — server component, one per pool with rank cue
 *   - <EmptyState />   — friendly empty message
 */

import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { listPoolsForViewer } from '@/lib/actions/pools.action'
import { PoolFilters } from './(components)/PoolFilters'
import { PoolCard } from './(components)/PoolCard'
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

export default async function PoolsListPage({
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
  const governanceModel = pickStr(sp, 'governance')
  const geo = pickStr(sp, 'geo')
  const search = pickStr(sp, 'search')

  const hasFilters = !!(domain || governanceModel || geo || search)

  const pools = myAgent
    ? await listPoolsForViewer({
        hubId: internalHubId,
        viewerAgentId: myAgent,
        domain,
        governanceModel,
        geo,
        search,
      })
    : []

  const total = pools.length

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Pools
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
            Open pools {total > 0 && <span style={{ color: C.textMuted, fontSize: '0.95rem', fontWeight: 500 }}>({total})</span>}
          </h1>
        </div>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          Funds, coaching networks, prayer chains, skills benches, hospitality networks accepting pledges in this hub.
        </p>
      </div>

      <PoolFilters hubSlug={slug} />

      {total === 0 ? (
        <EmptyState hubSlug={slug} hasFilters={hasFilters} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {pools.map((p) => (
            <PoolCard key={p.id} pool={p} hubSlug={slug} />
          ))}
        </div>
      )}
    </div>
  )
}
