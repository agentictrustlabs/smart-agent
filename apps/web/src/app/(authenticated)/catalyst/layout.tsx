'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/catalyst', label: 'Overview', exact: true },
  { href: '/catalyst/groups', label: 'Groups' },
  { href: '/catalyst/activities', label: 'Activities' },
  { href: '/catalyst/members', label: 'Members' },
  { href: '/catalyst/map', label: 'Map' },
]

export default function CatalystLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div>
      <nav style={{
        display: 'flex', gap: '0.25rem', padding: '0.5rem 0', marginBottom: '1rem',
        borderBottom: '2px solid #f0f1f3',
      }}>
        {NAV_ITEMS.map(item => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href}
              style={{
                padding: '0.4rem 0.85rem', borderRadius: 6, fontSize: '0.85rem', fontWeight: 600,
                textDecoration: 'none', transition: 'all 0.15s',
                background: isActive ? '#0d9488' : 'transparent',
                color: isActive ? '#fff' : '#616161',
                border: isActive ? '1px solid #0d9488' : '1px solid transparent',
              }}>
              {item.label}
            </Link>
          )
        })}
      </nav>
      {children}
    </div>
  )
}
