'use client'

import { useSearchParams, useRouter } from 'next/navigation'

const TABS = [
  { key: 'graph', label: 'Graph' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'endorsements', label: 'Endorsements' },
]

export function NetworkTabs({ children }: { children: Record<string, React.ReactNode> }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeTab = searchParams.get('tab') ?? 'graph'

  function handleTabChange(tab: string) {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set('tab', tab)
    router.push(`/network?${nextParams.toString()}`)
  }

  return (
    <div>
      <div data-component="network-tabbar">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            data-component="filter-btn"
            data-active={activeTab === tab.key ? 'true' : 'false'}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div key={activeTab}>{children[activeTab] ?? children.graph}</div>
    </div>
  )
}
