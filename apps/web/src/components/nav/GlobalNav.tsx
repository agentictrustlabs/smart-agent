'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useOrgContext } from '@/components/org/OrgContext'

interface NavItem {
  href: string
  label: string
  /** Roles that see this item prominently. Empty = visible to all. */
  forRoles?: string[]
  /** Capability required on the selected org. If set, item is hidden when org lacks this capability. */
  requiresCapability?: string
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home' },
  { href: '/team', label: 'Organization' },
  { href: '/agents', label: 'Agents' },
  { href: '/network', label: 'Network' },
  { href: '/treasury', label: 'Treasury', requiresCapability: 'treasury', forRoles: ['owner', 'treasurer', 'authorized-signer', 'ceo'] },
  { href: '/portfolio', label: 'Portfolio', requiresCapability: 'portfolio', forRoles: ['owner', 'authorized-signer', 'board-member', 'operator', 'advisor', 'auditor'] },
  { href: '/revenue', label: 'Revenue', requiresCapability: 'revenue' },
  { href: '/training', label: 'Training', requiresCapability: 'training', forRoles: ['owner', 'operator', 'reviewer', 'member', 'advisor'] },
  { href: '/governance', label: 'Governance', requiresCapability: 'governance', forRoles: ['owner', 'board-member', 'auditor'] },
  { href: '/activities', label: 'Activities', requiresCapability: 'activities' },
  { href: '/genmap', label: 'Gen Map', requiresCapability: 'genmap', forRoles: ['owner', 'operator', 'board-member', 'advisor', 'auditor'] },
  { href: '/members', label: 'Members', requiresCapability: 'members' },
  { href: '/reviews', label: 'Reviews', requiresCapability: 'reviews' },
  { href: '/settings', label: 'Admin', forRoles: ['owner', 'admin', 'ceo'] },
]

export function GlobalNav() {
  const pathname = usePathname()
  const { userRoles, hasCapability, selectedOrg, loading } = useOrgContext()

  return (
    <nav data-component="global-nav">
      {NAV_ITEMS.map((item) => {
        // Hide items when org doesn't have the required capability
        if (item.requiresCapability && !loading && !hasCapability(item.requiresCapability)) return null

        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          || (item.href === '/agents' && pathname.startsWith('/agents'))

        const isRelevant = !item.forRoles || item.forRoles.length === 0
          || loading
          || userRoles.some(r => item.forRoles!.includes(r))
        const href = selectedOrg ? `${item.href}?org=${selectedOrg.address}` : item.href

        return (
          <Link
            key={item.href}
            href={href}
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
