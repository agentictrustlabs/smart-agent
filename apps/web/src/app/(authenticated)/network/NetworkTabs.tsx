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

  return (
    <div>
      <div data-component="graph-filter" style={{ marginBottom: '1.5rem' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => router.push(`/network?tab=${tab.key}`)}
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
