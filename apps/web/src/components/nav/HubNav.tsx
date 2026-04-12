'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useOrgContext } from '@/components/org/OrgContext'
import { getHubProfile } from '@/lib/hub-profiles'

export function HubNav() {
  const pathname = usePathname()
  const { selectedOrg, selectedHub, activeContext, loading } = useOrgContext()

  if (loading) return null

  const hubId = selectedHub?.id ?? 'generic'
  const profile = getHubProfile(hubId)

  // Build scoped href with org + hub + context params
  const params: string[] = []
  if (selectedOrg) params.push(`org=${selectedOrg.address}`)
  if (hubId !== 'generic') params.push(`hub=${hubId}`)
  if (activeContext) params.push(`context=${activeContext.id}`)
  const qs = params.length > 0 ? `?${params.join('&')}` : ''

  return (
    <nav data-component="global-nav">
      {profile.navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          || (item.href === '/agents' && pathname.startsWith('/agents'))
          || (item.href === '/network' && pathname.startsWith('/network'))
        const href = `${item.href}${qs}`

        return (
          <Link
            key={item.href}
            href={href}
            data-active={isActive ? 'true' : 'false'}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
