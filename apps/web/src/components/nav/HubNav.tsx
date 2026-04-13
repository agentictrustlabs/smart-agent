'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUserContext } from '@/components/user/UserContext'

/** Nav items driven by user capabilities across all orgs */
const NAV_ITEMS: Array<{ href: string; label: string; requires?: string }> = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/catalyst', label: 'Catalyst' },
  { href: '/agents', label: 'Agents' },
  { href: '/network', label: 'Network' },
  { href: '/reviews', label: 'Reviews', requires: 'reviews' },
  { href: '/treasury', label: 'Treasury', requires: 'treasury' },
  { href: '/settings', label: 'Admin', requires: 'settings' },
]

export function HubNav() {
  const pathname = usePathname()
  const { capabilities, loading } = useUserContext()

  if (loading) return null

  return (
    <nav data-component="global-nav">
      {NAV_ITEMS
        .filter(item => !item.requires || capabilities.includes(item.requires))
        .map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={isActive ? 'true' : 'false'}
            >
              {item.label}
            </Link>
          )
        })}
    </nav>
  )
}
