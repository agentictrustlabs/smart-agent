'use client'

import { useSearchParams, useRouter } from 'next/navigation'

const TABS = [
  { key: 'graph', label: 'Trust Graph' },
  { key: 'map', label: 'Map' },
  { key: 'hierarchy', label: 'Hierarchy' },
  { key: 'endorsements', label: 'Endorsements' },
]

export function NetworkTabs({ children, stats, labels }: {
  children: Record<string, React.ReactNode>
  stats?: { total: number; outgoing: number; incoming: number }
  labels?: { network: string; lineage: string }
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeTab = searchParams.get('tab') ?? 'graph'

  function handleTabChange(tab: string) {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set('tab', tab)
    router.push(`/network?${nextParams.toString()}`)
  }

  function getTabLabel(key: string, fallback: string) {
    if (key === 'graph') return labels?.network ?? fallback
    if (key === 'hierarchy') return labels?.lineage ?? fallback
    return fallback
  }

  return (
    <div data-component="network-layout">
      {/* Compact toolbar */}
      <div data-component="network-toolbar">
        <div data-component="network-tabbar">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              data-component="filter-btn"
              data-active={activeTab === tab.key ? 'true' : 'false'}
            >
              {getTabLabel(tab.key, tab.label)}
            </button>
          ))}
        </div>
        {stats && (
          <div data-component="network-toolbar-stats">
            <span>{stats.total} edges</span>
            <span>{stats.outgoing} out</span>
            <span>{stats.incoming} in</span>
          </div>
        )}
      </div>
      {/* Full-bleed content */}
      <div data-component="network-content" key={activeTab}>
        {children[activeTab] ?? children.graph}
      </div>
    </div>
  )
}
