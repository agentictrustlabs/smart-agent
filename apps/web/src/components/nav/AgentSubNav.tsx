'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function AgentSubNav({ address }: { address: string }) {
  const pathname = usePathname()
  const base = `/agents/${address}`

  const tabs = [
    { href: base, label: 'Trust & Compliance', exact: true },
    { href: `${base}/metadata`, label: 'Profile' },
    { href: `${base}/communicate`, label: 'Chat' },
  ]

  return (
    <nav data-component="graph-filter" style={{ marginBottom: '1.5rem' }}>
      {tabs.map(tab => {
        const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link key={tab.href} href={tab.href} data-component="filter-btn" data-active={isActive ? 'true' : 'false'}>
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
