import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { NetworkTabs } from './NetworkTabs'
import { GraphTabContent, MapTabContent, HierarchyTabContent, EndorsementsTabContent, StatsSlot } from './_tabs'

/**
 * /network — tabs for trust graph, map, hierarchy, and endorsements.
 *
 * Each tab fetches independently inside its own Suspense boundary, so
 * the shell paints immediately and the active tab streams when its
 * data resolves. Inactive tabs aren't computed at all — switching tabs
 * is a route navigation that re-renders the page with the new `tab`
 * search param.
 *
 * Stats (edge counts) are also Suspense'd; they share the request-scoped
 * `loadRelationships` cache with the active tab when it needs the same
 * data, so the work isn't duplicated.
 */
type SP = Promise<Record<string, string | string[] | undefined>>

export default async function NetworkPage({ searchParams }: { searchParams?: SP }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const sp = (await searchParams) ?? {}
  const tab = (typeof sp.tab === 'string' ? sp.tab : 'graph')

  let activeContent: React.ReactNode
  switch (tab) {
    case 'map':
      activeContent = <Suspense fallback={<TabFallback label="Loading map…" />}><MapTabContent userId={currentUser.id} /></Suspense>
      break
    case 'hierarchy':
      activeContent = <Suspense fallback={<TabFallback label="Loading hierarchy…" />}><HierarchyTabContent userId={currentUser.id} /></Suspense>
      break
    case 'endorsements':
      activeContent = <Suspense fallback={<TabFallback label="Loading endorsements…" />}><EndorsementsTabContent userId={currentUser.id} /></Suspense>
      break
    case 'graph':
    default:
      activeContent = <Suspense fallback={<TabFallback label="Loading trust graph…" />}><GraphTabContent userId={currentUser.id} /></Suspense>
  }

  return (
    <div data-page="network">
      <div data-component="page-header">
        <h1>Network</h1>
        <p>Trust graph, relationships, and connected organizations.</p>
      </div>
      <NetworkTabs
        activeContent={activeContent}
        labels={{ network: 'Network', lineage: 'Lineage' }}
        statsSlot={<Suspense fallback={null}><StatsSlot userId={currentUser.id} /></Suspense>}
      />
    </div>
  )
}

function TabFallback({ label }: { label: string }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
      {label}
    </div>
  )
}
