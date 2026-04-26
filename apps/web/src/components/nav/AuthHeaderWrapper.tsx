'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

interface Props {
  logo: ReactNode
  hubNav: ReactNode
  utility: ReactNode
}

/**
 * Renders the full app header with HubNav on routes that don't already
 * provide their own. The hub layout (used by /h/{slug}/* and the rest of
 * the authenticated app) supplies its own header, so we suppress this
 * wrapper there and on the legacy /catalyst path that still redirects.
 */
export function AuthHeaderWrapper({ logo, hubNav, utility }: Props) {
  const pathname = usePathname()
  const suppress = pathname.startsWith('/catalyst') || pathname.startsWith('/h/')

  if (suppress) {
    return null
  }

  return (
    <header data-component="app-header">
      <div data-component="header-primary">
        {logo}
        {hubNav}
      </div>
      {utility}
    </header>
  )
}
