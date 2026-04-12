'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useOrgContext } from '@/components/org/OrgContext'
import { getHubProfile } from '@/lib/hub-profiles'

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
  { href: '/contexts', label: 'Contexts' },
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
  const searchParams = useSearchParams()
  const { userRoles, hasCapability, selectedOrg, selectedHub, activeContext, loading } = useOrgContext()
  const profile = getHubProfile(selectedHub?.id)

  function getNavLabel(item: NavItem): string {
    if (item.href === '/dashboard') return profile.overviewLabel
    if (item.href === '/contexts') return profile.contextsLabel
    if (item.href === '/agents') return profile.agentLabel
    if (item.href === '/activities') return profile.activityLabel
    if (item.href === '/network') return activeContext?.kind === 'lineage' ? profile.lineageLabel : profile.networkLabel
    if (item.href === '/genmap') return profile.lineageLabel
    return item.label
  }

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
        const nextParams = new URLSearchParams(searchParams.toString())
        if (selectedOrg) nextParams.set('org', selectedOrg.address)
        if (selectedHub) nextParams.set('hub', selectedHub.id)
        if (activeContext) nextParams.set('context', activeContext.id)
        const href = nextParams.toString() ? `${item.href}?${nextParams.toString()}` : item.href

        return (
          <Link
            key={item.href}
            href={href}
            data-active={isActive ? 'true' : 'false'}
            style={!isRelevant ? { opacity: 0.4 } : undefined}
          >
            {getNavLabel(item)}
          </Link>
        )
      })}
    </nav>
  )
}
