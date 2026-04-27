'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const TABS = [
  { key: 'graph', label: 'Trust Graph' },
  { key: 'map', label: 'Map' },
  { key: 'hierarchy', label: 'Hierarchy' },
  { key: 'endorsements', label: 'Endorsements' },
]

/**
 * Tab bar + stats. Tab content is server-rendered upstream and passed
 * in as `activeContent` (only the active tab's data is fetched). Tab
 * switching is a route navigation so each tab's server component gets
 * its own fresh render and Suspense boundaries stream independently.
 */
export function NetworkTabs({ activeContent, stats, labels, statsSlot }: {
  activeContent: React.ReactNode
  stats?: { total: number; outgoing: number; incoming: number }
  labels?: { network: string; lineage: string }
  statsSlot?: React.ReactNode
}) {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'graph'

  function getTabLabel(key: string, fallback: string) {
    if (key === 'graph') return labels?.network ?? fallback
    if (key === 'hierarchy') return labels?.lineage ?? fallback
    return fallback
  }

  function tabHref(key: string) {
    const next = new URLSearchParams(searchParams.toString())
    next.set('tab', key)
    return `/network?${next.toString()}`
  }

  return (
    <div data-component="network-layout">
      <div data-component="network-toolbar">
        <div data-component="network-tabbar">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={tabHref(tab.key)}
              data-component="filter-btn"
              data-active={activeTab === tab.key ? 'true' : 'false'}
              prefetch={false}
            >
              {getTabLabel(tab.key, tab.label)}
            </Link>
          ))}
        </div>
        {stats && (
          <div data-component="network-toolbar-stats">
            <span>{stats.total} edges</span>
            <span>{stats.outgoing} out</span>
            <span>{stats.incoming} in</span>
          </div>
        )}
        {statsSlot}
      </div>
      <div data-component="network-content" key={activeTab}>
        {activeContent}
      </div>
    </div>
  )
}
