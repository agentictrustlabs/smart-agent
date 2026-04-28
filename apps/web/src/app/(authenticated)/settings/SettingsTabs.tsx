'use client'

import { useSearchParams, useRouter } from 'next/navigation'

const TABS = [
  { key: 'templates', label: 'Role Templates' },
  { key: 'governance', label: 'Governance' },
  { key: 'issuers', label: 'Authorities' },
  { key: 'ontology', label: 'Registry' },
  { key: 'sessions', label: 'Active Sessions' },
]

export function SettingsTabs({ children }: { children: Record<string, React.ReactNode> }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeTab = searchParams.get('tab') ?? 'templates'

  return (
    <div>
      <div data-component="graph-filter" style={{ marginBottom: '1.5rem' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => router.push(`/settings?tab=${tab.key}`)}
            data-component="filter-btn"
            data-active={activeTab === tab.key ? 'true' : 'false'}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div key={activeTab}>{children[activeTab] ?? children.templates}</div>
    </div>
  )
}
