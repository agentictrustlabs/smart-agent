'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useOrgContext } from '@/components/org/OrgContext'

interface NavItem {
  href: string
  label: string
  /** Roles that see this item prominently. Empty = visible to all. */
  forRoles?: string[]
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home' },
  { href: '/team', label: 'Organization' },
  { href: '/agents', label: 'Agents' },
  { href: '/network', label: 'Network' },
  { href: '/treasury', label: 'Treasury', forRoles: ['owner', 'treasurer', 'authorized-signer', 'ceo'] },
  { href: '/settings', label: 'Admin', forRoles: ['owner', 'admin', 'ceo'] },
]

export function GlobalNav() {
  const pathname = usePathname()
  const { userRoles, loading } = useOrgContext()

  return (
    <nav data-component="global-nav">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          || (item.href === '/agents' && pathname.startsWith('/agents'))

        // If item has forRoles, dim it if user doesn't have a matching role
        // Still visible (not hidden) — just less prominent
        const isRelevant = !item.forRoles || item.forRoles.length === 0
          || loading
          || userRoles.some(r => item.forRoles!.includes(r))

        return (
          <Link
            key={item.href}
            href={item.href}
            data-active={isActive ? 'true' : 'false'}
            style={!isRelevant ? { opacity: 0.4 } : undefined}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
