'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Sub-nav rendered above every `/agents/[address]` page. The Manage
 * tab is visible only when the connected user owns or controls the
 * target agent — checked via `/api/agents/can-manage`. This is purely
 * a UI affordance; the `/manage` route itself re-checks `canManageAgent`
 * server-side, so a manually-typed URL still 404s for non-owners.
 */
export function AgentSubNav({ address }: { address: string }) {
  const pathname = usePathname()
  const base = `/agents/${address}`
  const [canManage, setCanManage] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/agents/can-manage?address=${address}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { canManage: false }))
      .then((d: { canManage: boolean }) => { if (!cancelled) setCanManage(!!d.canManage) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [address])

  const tabs = [
    { href: base, label: 'Trust & Compliance', exact: true },
    { href: `${base}/metadata`, label: 'Profile' },
    ...(canManage ? [{ href: `${base}/manage`, label: 'Manage' }] : []),
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
