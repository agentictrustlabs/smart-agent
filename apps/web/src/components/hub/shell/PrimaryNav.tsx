'use client'

/**
 * PrimaryNav — the horizontal pill-tabs bar that appears in the header.
 * Receives nav items from the hub profile and the current pathname to
 * derive active state. Purely presentational.
 *
 * Naming standardisation applied here:
 *   "Management" / "Manage" / "Steward" / "Governance" all normalise to
 *   the label supplied from hub-profiles.ts. The recommended canonical
 *   labels are:
 *     - "Govern"  for round-admin / financial stewardship (cil hub)
 *     - "Members" for org-member operations (where previously "Team")
 *     - "Settings" for self-configuration
 *
 * The label is the single source of truth — route paths are stable and
 * unchanged by this component.
 */

import Link from 'next/link'
import type { HubNavItem } from '@/lib/hub-profiles'

interface PrimaryNavProps {
  items: HubNavItem[]
  pathname: string
  accent: string
  onPrimary: string
  textMuted: string
  text: string
}

function isActive(item: HubNavItem, pathname: string): boolean {
  if (item.activePrefixes) {
    return item.activePrefixes.some(
      (p) => pathname === p || pathname.startsWith(p + '/'),
    )
  }
  return item.exact
    ? pathname === item.href
    : pathname.startsWith(item.href + '/')
}

export function PrimaryNav({ items, pathname, accent, onPrimary, textMuted, text }: PrimaryNavProps) {
  return (
    <nav
      aria-label="Primary navigation"
      className="flex items-center gap-1 flex-wrap justify-center flex-1 min-w-0"
    >
      {items.map((tab) => {
        const active = isActive(tab, pathname)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`px-4 py-1.5 rounded-full text-label-lg no-underline transition-all duration-200 whitespace-nowrap ${
              active
                ? 'bg-primary text-on-primary font-semibold shadow-elevation-1'
                : 'text-on-surface-variant hover:bg-surface-variant hover:text-on-surface font-medium'
            }`}
            style={
              active
                ? { background: accent, color: onPrimary }
                : { color: textMuted }
            }
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
