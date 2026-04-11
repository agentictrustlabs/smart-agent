'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useOrgContext } from '@/components/org/OrgContext'
import { isTogoTemplate } from '@/lib/togo'

interface NavItem {
  href: string
  label: string
  /** Roles that see this item prominently. Empty = visible to all. */
  forRoles?: string[]
  /** Only show for Togo pilot templates */
  togoOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home' },
  { href: '/team', label: 'Organization' },
  { href: '/agents', label: 'Agents' },
  { href: '/network', label: 'Network' },
  { href: '/treasury', label: 'Treasury', forRoles: ['owner', 'treasurer', 'authorized-signer', 'ceo'] },
  { href: '/portfolio', label: 'Portfolio', togoOnly: true, forRoles: ['owner', 'authorized-signer', 'board-member', 'operator', 'advisor', 'auditor'] },
  { href: '/revenue', label: 'Revenue', togoOnly: true },
  { href: '/training', label: 'Training', togoOnly: true, forRoles: ['owner', 'operator', 'reviewer', 'member', 'advisor'] },
  { href: '/governance', label: 'Governance', togoOnly: true, forRoles: ['owner', 'board-member', 'auditor'] },
  { href: '/reviews', label: 'Reviews', forRoles: ['owner', 'reviewer', 'auditor', 'board-member', 'advisor'] },
  { href: '/settings', label: 'Admin', forRoles: ['owner', 'admin', 'ceo'] },
]

export function GlobalNav() {
  const pathname = usePathname()
  const { userRoles, selectedOrg, loading } = useOrgContext()

  const templateId = selectedOrg?.templateId ?? null
  const isTogo = isTogoTemplate(templateId)

  return (
    <nav data-component="global-nav">
      {NAV_ITEMS.map((item) => {
        // Hide Togo-only items for non-Togo orgs
        if (item.togoOnly && !isTogo) return null

        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          || (item.href === '/agents' && pathname.startsWith('/agents'))

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
