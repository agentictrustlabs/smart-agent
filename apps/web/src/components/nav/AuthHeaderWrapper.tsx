'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

interface Props {
  logo: ReactNode
  hubNav: ReactNode
  utility: ReactNode
}

/**
 * Renders the full app header with HubNav on non-catalyst routes.
 * On /catalyst/* routes, renders a minimal header (logo + back link only)
 * since the catalyst layout provides its own navigation.
 */
export function AuthHeaderWrapper({ logo, hubNav, utility }: Props) {
  const pathname = usePathname()
  const isCatalyst = pathname.startsWith('/catalyst')

  if (isCatalyst) {
    // Minimal header — catalyst layout handles its own nav
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
