'use client'

import { createContext, useContext, useState, useMemo, useCallback, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useUserContext } from '@/components/user/UserContext'
import type { UserNavSection } from '@/app/api/user-context/route'
import type { HubId, HubProfile, HubNavItem, HubViewMode } from '@/lib/hub-profiles'
import { getHubProfile, getNavBySection, inferHubIdFromDemoKey } from '@/lib/hub-profiles'

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------
export interface HubContextValue {
  hubId: HubId
  profile: HubProfile
  /** Resolved primary nav items for current user */
  primaryNav: HubNavItem[]
  /** Resolved admin nav items for current user */
  adminNav: HubNavItem[]
  /** Personal nav items for current user */
  personalNav: HubNavItem[]
  /** User-specific nav sections (groups, coaching, orgs, agents) */
  userNav: UserNavSection[]
  /** Active sub-tabs based on current pathname */
  activeSubTabs: Array<{ href: string; label: string; exact?: boolean }> | null
  /** Current view mode key (e.g., 'disciple', 'coach') */
  viewMode: string
  /** Set the view mode */
  setViewMode: (mode: string) => void
  /** Available view modes for this hub + user */
  availableViewModes: HubViewMode[]
  /** Check if a feature is enabled in this hub */
  hasFeature: (feature: string) => boolean
  /** Formatted greeting for the current user */
  greeting: string | null
}

const HubCtx = createContext<HubContextValue | null>(null)

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useHubContext(): HubContextValue {
  const ctx = useContext(HubCtx)
  if (!ctx) {
    throw new Error('useHubContext must be used within a <HubProvider>')
  }
  return ctx
}

/**
 * Optional hook that returns null if outside HubProvider
 * (useful for components that may render both inside and outside hub layouts)
 */
export function useOptionalHubContext(): HubContextValue | null {
  return useContext(HubCtx)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the demo-user cookie value (client-side) */
function getDemoUserKey(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)demo-user=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

/** Determine hubId from user context + demo key */
function resolveHubId(
  hubs: Array<{ address: string; name: string }>,
  _orgs: Array<{ address: string; name: string }>,
): HubId {
  // 1. Demo mode: infer from cookie
  const demoKey = getDemoUserKey()
  const demoHubId = inferHubIdFromDemoKey(demoKey)
  if (demoHubId) return demoHubId

  // 2. If user has hubs, try to match by name
  for (const hub of hubs) {
    const name = hub.name.toLowerCase()
    if (name.includes('catalyst')) return 'catalyst'
    if (name.includes('global') && name.includes('church')) return 'global-church'
    if (name.includes('collective') || name.includes('cil')) return 'cil'
  }

  // 3. Default
  return 'generic'
}

/** Filter nav items by user capabilities and roles */
function filterNavItems(
  items: HubNavItem[],
  capabilities: string[],
  roles: string[],
  hasCapability: (cap: string) => boolean,
  hasRole: (role: string) => boolean,
): HubNavItem[] {
  return items.filter(item => {
    if (item.requiresCapability && !hasCapability(item.requiresCapability)) return false
    if (item.requiresRole && !hasRole(item.requiresRole)) return false
    return true
  })
}

/** Find active sub-tabs from the current pathname */
function resolveActiveSubTabs(
  allNavItems: HubNavItem[],
  pathname: string,
): Array<{ href: string; label: string; exact?: boolean }> | null {
  for (const item of allNavItems) {
    if (!item.subTabs || item.subTabs.length === 0) continue

    // Check if pathname matches the item's href or any of its activePrefixes
    const prefixes = item.activePrefixes ?? [item.href]
    const isMatch = prefixes.some(p => pathname === p || pathname.startsWith(p + '/'))

    if (isMatch) {
      return item.subTabs
    }
  }
  return null
}

/** Filter view modes based on user's capabilities and roles */
function filterViewModes(
  modes: HubViewMode[] | undefined,
  hasCapability: (cap: string) => boolean,
  hasRole: (role: string) => boolean,
): HubViewMode[] {
  if (!modes) return []
  return modes.filter(mode => {
    if (mode.requiresCapability && !hasCapability(mode.requiresCapability)) return false
    if (mode.requiresRole && !hasRole(mode.requiresRole)) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
interface HubProviderProps {
  children: ReactNode
  /** Override the hub ID (useful for testing or forced routing) */
  hubIdOverride?: HubId
}

export function HubProvider({ children, hubIdOverride }: HubProviderProps) {
  const pathname = usePathname()
  const { personAgent, orgs, hubs, capabilities, roles, hasCapability, hasRole, hubProfile: serverHubProfile, personalNav: userPersonalNav } = useUserContext()

  // Resolve hub: prefer server-resolved profile (on-chain), fall back to static
  const hubId = hubIdOverride ?? (serverHubProfile?.id ?? resolveHubId(hubs, orgs))
  const profile = useMemo(
    () => serverHubProfile ?? getHubProfile(hubId),
    [serverHubProfile, hubId],
  )

  // Filter navigation
  const primaryNav = useMemo(
    () => filterNavItems(getNavBySection(profile, 'primary'), capabilities, roles, hasCapability, hasRole),
    [profile, capabilities, roles, hasCapability, hasRole],
  )

  const adminNav = useMemo(
    () => filterNavItems(getNavBySection(profile, 'admin'), capabilities, roles, hasCapability, hasRole),
    [profile, capabilities, roles, hasCapability, hasRole],
  )

  const personalNav = useMemo(
    () => filterNavItems(getNavBySection(profile, 'personal'), capabilities, roles, hasCapability, hasRole),
    [profile, capabilities, roles, hasCapability, hasRole],
  )

  // Sub-tabs
  const activeSubTabs = useMemo(
    () => resolveActiveSubTabs(profile.navItems, pathname),
    [profile.navItems, pathname],
  )

  // View modes
  const availableViewModes = useMemo(
    () => filterViewModes(profile.viewModes, hasCapability, hasRole),
    [profile.viewModes, hasCapability, hasRole],
  )

  const [viewMode, setViewMode] = useState<string>(
    availableViewModes[0]?.key ?? 'disciple',
  )

  // Feature check
  const hasFeature = useCallback(
    (feature: string) => !!(profile.features as Record<string, boolean | undefined>)[feature],
    [profile.features],
  )

  // Greeting
  const greeting = useMemo(() => {
    if (!profile.greetingTemplate) return null
    const name = personAgent?.name ?? 'User'
    return profile.greetingTemplate.replace('{name}', name)
  }, [profile.greetingTemplate, personAgent?.name])

  const value = useMemo<HubContextValue>(() => ({
    hubId,
    profile,
    primaryNav,
    adminNav,
    personalNav,
    userNav: userPersonalNav,
    activeSubTabs,
    viewMode,
    setViewMode,
    availableViewModes,
    hasFeature,
    greeting,
  }), [hubId, profile, primaryNav, adminNav, personalNav, userPersonalNav, activeSubTabs, viewMode, availableViewModes, hasFeature, greeting])

  return <HubCtx.Provider value={value}>{children}</HubCtx.Provider>
}
