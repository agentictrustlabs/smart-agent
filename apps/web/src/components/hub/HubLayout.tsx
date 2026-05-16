'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useMemo } from 'react'
import { useUserContext } from '@/components/user/UserContext'
import { HubProvider, useHubContext } from '@/components/hub/HubContext'
import { CreateOrgDialog } from '@/components/org/CreateOrgDialog'
import { IssueCredentialDialog } from '@/lib/credentials/IssueCredentialDialog'
import type { HubId } from '@/lib/hub-profiles'
import { CatalystViewCtx } from '@/components/catalyst/CatalystViewContext'
import type { ViewMode } from '@/components/catalyst/CatalystViewContext'
import QuickActivityModal from '@/components/catalyst/QuickActivityModal'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { CommandPalette } from '@/components/people/CommandPalette'
import { PrincipalContextChip } from '@/components/shell/PrincipalContextChip'
import { HubShell, PrimaryNav, UserMenu, Breadcrumbs } from '@/components/hub/shell'
import { truncateAddress } from '@/lib/ui/formatAgent'

// Local copy of hub-routes' HUB_SLUG_REVERSE — we can't import from
// '@/lib/hub-routes' here because that module transitively imports
// `next/headers` (via DEMO_USER_META), which is server-only and would
// fail this file's 'use client' contract.
const HUB_SLUG_REVERSE: Record<string, string> = {
  catalyst: 'catalyst',
  cil: 'mission',
  'global-church': 'globalchurch',
  generic: 'globalchurch',
}
function getHubSlugForId(hubId: string): string {
  return HUB_SLUG_REVERSE[hubId] ?? 'globalchurch'
}

function hubProfileMatches(hub: { name: string }, hubId: HubId): boolean {
  const n = hub.name.toLowerCase()
  if (hubId === 'catalyst') return n.includes('catalyst')
  if (hubId === 'global-church') return n.includes('global') && n.includes('church')
  if (hubId === 'cil') return n.includes('mission') || n.includes('collective') || n.includes('cil')
  return false
}

// ---------------------------------------------------------------------------
// Breadcrumb derivation
// ---------------------------------------------------------------------------
const SEGMENT_LABELS: Record<string, string> = {
  'catalyst': 'Home',
  'circles': 'Oikos',
  'oikos': 'Oikos',
  'nurture': 'Nurture',
  'groups': 'Groups',
  'steward': 'Govern',
  'activity': 'Activity',
  'agents': 'Agents',
  'network': 'Network',
  'treasury': 'Treasury',
  'reviews': 'Reviews',
  'trust': 'Trust',
  'me': 'Profile',
  'members': 'Members',
  'prayer': 'Prayer',
  'grow': 'Grow',
  'map': 'Map',
  'settings': 'Settings',
  'coach': 'Coaching',
  'activities': 'Activities',
  'entitlements': 'Engagements',
  'intents': 'Intents',
  'governance': 'Govern',
  'coaching': 'Coaching',
  'revenue': 'Revenue',
  'portfolio': 'Portfolio',
  'command-center': 'Command Center',
  'training': 'Training',
  'reports': 'Reports',
  'dashboard': 'Dashboard',
}

const PARENT_INTENT: Record<string, { label: string; href: string }> = {
  '/treasury': { label: 'Govern', href: '/steward' },
  '/reviews': { label: 'Govern', href: '/steward' },
  '/network': { label: 'Govern', href: '/steward' },
  '/trust': { label: 'Govern', href: '/steward' },
  '/settings': { label: 'Govern', href: '/steward' },
  '/agents': { label: 'Govern', href: '/steward' },
  '/team': { label: 'Govern', href: '/steward' },
  '/genmap': { label: 'Groups', href: '/groups' },
  '/members': { label: 'Groups', href: '/groups' },
  '/activities': { label: 'Activity', href: '/activity' },
  '/onboarding': { label: 'Home', href: '/dashboard' },
  '/catalyst/prayer': { label: 'Nurture', href: '/nurture' },
  '/catalyst/grow': { label: 'Nurture', href: '/nurture' },
  '/catalyst/coach': { label: 'Nurture', href: '/nurture' },
  '/prayer': { label: 'Nurture', href: '/nurture' },
  '/grow': { label: 'Nurture', href: '/nurture' },
}

function deriveBreadcrumbs(
  pathname: string,
  orgName: string,
): Array<{ label: string; href: string }> {
  const segments = pathname.split('/').filter(Boolean)

  const parentIntent = PARENT_INTENT[pathname] ?? PARENT_INTENT['/' + segments[0]]
  if (parentIntent && segments.length >= 1) {
    const crumbs: Array<{ label: string; href: string }> = [
      { label: parentIntent.label, href: parentIntent.href },
    ]
    const seg = segments[segments.length - 1]
    const label = SEGMENT_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1)
    crumbs.push({ label, href: pathname })
    return crumbs
  }

  if (segments.length <= 1) return []

  const crumbs: Array<{ label: string; href: string }> = []
  let currentPath = ''
  const isHubScoped = segments[0] === 'h' && segments.length >= 2

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    currentPath += '/' + seg

    if (i === 0 && seg === 'h') continue

    if (isHubScoped && i === 1) {
      const label = SEGMENT_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1)
      crumbs.push({ label, href: `/h/${seg}/home` })
      continue
    }
    if (isHubScoped && i === 2 && seg === 'home') continue

    if (seg.startsWith('0x') || (seg.length > 20 && /^[a-f0-9]+$/i.test(seg))) {
      const label = orgName || truncateAddress(seg)
      crumbs.push({ label, href: currentPath })
    } else {
      const label = SEGMENT_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1)
      crumbs.push({ label, href: currentPath })
    }
  }

  return crumbs
}

// ---------------------------------------------------------------------------
// Logo SVG
// ---------------------------------------------------------------------------
function LogoIcon({ accent }: { accent: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill={accent} />
      <circle cx="14" cy="10" r="2.5" fill="white" />
      <circle cx="8" cy="19" r="2" fill="white" />
      <circle cx="20" cy="19" r="2" fill="white" />
      <line x1="14" y1="12.5" x2="8" y2="17" stroke="white" strokeWidth="1.2" />
      <line x1="14" y1="12.5" x2="20" y2="17" stroke="white" strokeWidth="1.2" />
      <line x1="8" y1="19" x2="20" y2="19" stroke="white" strokeWidth="1.2" strokeDasharray="2 1.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Inner layout (consumes HubContext)
// ---------------------------------------------------------------------------
function HubLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { personAgent, orgs, hubs, hasRole, loading } = useUserContext()
  const hub = useHubContext()
  const { profile, primaryNav, adminNav, availableViewModes, viewMode, setViewMode, userNav } = hub
  const T = profile.theme

  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [createOrgOpen, setCreateOrgOpen] = useState(false)
  const [issueCredentialType, setIssueCredentialType] = useState<string | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const activeHub = hubs.find(h => hubProfileMatches(h, profile.id)) ?? hubs[0] ?? null

  const isAdmin = hasRole('owner') || hasRole('admin') || hasRole('ceo')

  const userPrimaryName = personAgent?.primaryName || ''
  const userName = userPrimaryName || personAgent?.name || 'User'
  const userSubtitle = userPrimaryName && personAgent?.name && personAgent.name !== userPrimaryName
    ? personAgent.name
    : ''
  const userInitial = (personAgent?.name || userName).charAt(0).toUpperCase()
  const orgName = orgs[0]?.name ?? profile.name

  const roleLabel = availableViewModes.length > 0
    ? (availableViewModes.find(m => m.key === viewMode)?.label ?? viewMode)
    : ''

  const catalystViewMode = (viewMode === 'coach' ? 'coach' : 'disciple') as ViewMode
  const setCatalystViewMode = (m: ViewMode) => setViewMode(m)

  const visibleAdminItems = isAdmin ? adminNav : []

  const breadcrumbs = deriveBreadcrumbs(pathname, orgName)

  const fabDefaults = useMemo(() => {
    if (pathname.includes('/groups/0x')) {
      const match = pathname.match(/(0x[a-fA-F0-9]+)/)
      return {
        defaultType: 'meeting' as const,
        defaultRelatedEntity: match?.[1],
      }
    }
    if (pathname.includes('/oikos') || pathname.includes('/circles')) {
      return { defaultType: 'outreach' as const }
    }
    return {}
  }, [pathname])

  const hubSlug = getHubSlugForId(profile.id)

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#fafafa' }}>
        <header className="sticky top-0 z-40 bg-white border-b border-outline-variant h-14 flex items-center px-4">
          <span className="font-bold text-title-md text-on-surface">Smart Agent</span>
        </header>
        <main className="flex-1 p-8 flex items-center justify-center">
          <span className="text-on-surface-variant text-body-md animate-pulse">Loading...</span>
        </main>
      </div>
    )
  }

  return (
    <CatalystViewCtx.Provider value={{ viewMode: catalystViewMode, setViewMode: setCatalystViewMode }}>
      <HubShell bg={T.bg}>
        {/* ============================================================== */}
        {/* Top Header Bar                                                  */}
        {/* ============================================================== */}
        <header className="sticky top-0 z-40 bg-white border-b border-outline-variant flex-shrink-0 shadow-elevation-1">
          {/* Primary row: logo + tabs + agent toggle + user menu */}
          <div className="flex items-center justify-between px-4 h-14 gap-3">
            {/* Left: Logo + Brand */}
            <Link
              href="/"
              className="flex items-center gap-2 no-underline flex-shrink-0"
              aria-label={`${profile.name} home`}
            >
              <LogoIcon accent={T.accent} />
              <span className="font-bold text-title-md text-on-surface tracking-tight">
                {profile.name}
              </span>
            </Link>

            {/* Center: Primary navigation tabs (hidden on mobile, visible md+) */}
            <div className="hidden md:flex flex-1 min-w-0">
              <PrimaryNav
                items={primaryNav}
                pathname={pathname}
                accent={T.accent}
                onPrimary="#ffffff"
                textMuted={T.textMuted}
                text={T.text}
              />
            </div>

            {/* Right: Mobile hamburger + Agent panel toggle + User menu */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              {/* Mobile hamburger — visible only on small screens */}
              <button
                className="flex md:hidden"
                onClick={() => setMobileNavOpen(prev => !prev)}
                aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-nav"
                style={{
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 8,
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                }}
              >
                {mobileNavOpen ? '✕' : '☰'}
              </button>
              {/* Agent panel toggle — icon-only: needs aria-label */}
              <button
                onClick={() => setAgentPanelOpen(prev => !prev)}
                aria-label="Toggle agent assistant"
                aria-expanded={agentPanelOpen}
                aria-controls="agent-panel"
                style={{
                  border: 'none',
                  background: agentPanelOpen ? T.accentLight : 'transparent',
                  borderRadius: 8,
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  transition: 'background 0.15s',
                }}
              >
                {'🤖'}
              </button>

              {/* User menu (dropdown factored into UserMenu component) */}
              <UserMenu
                userName={userName}
                userInitial={userInitial}
                userSubtitle={userSubtitle}
                roleLabel={roleLabel}
                hubSlug={hubSlug}
                isAdmin={isAdmin}
                adminNav={visibleAdminItems}
                userNav={userNav}
                showCreateOrg={Boolean(activeHub)}
                activeHubAddress={activeHub?.address}
                activeHubName={activeHub?.name}
                hubId={profile.id}
                accent={T.accent}
                accentLight={T.accentLight}
                text={T.text}
                textMuted={T.textMuted}
                border={T.border}
                onCreateOrg={() => setCreateOrgOpen(true)}
                onIssueCredential={(type) => setIssueCredentialType(type)}
              />
            </div>
          </div>

          {/* Breadcrumb bar — semantic nav with aria-label */}
          <Breadcrumbs
            items={breadcrumbs}
            borderColor={T.border}
            bg={T.bg}
            textMuted={T.textMuted}
            text={T.text}
          />

          {/* Mobile nav drawer (visible on small screens when open) */}
          {mobileNavOpen && (
            <nav
              id="mobile-nav"
              aria-label="Mobile navigation"
              className="flex md:hidden flex-col"
              style={{
                borderTop: `1px solid ${T.border}`,
                background: '#ffffff',
                padding: '0.5rem 0',
              }}
            >
              {primaryNav.map(tab => {
                const active = tab.activePrefixes
                  ? tab.activePrefixes.some(p => pathname === p || pathname.startsWith(p + '/'))
                  : (tab.exact ? pathname === tab.href : pathname.startsWith(tab.href + '/'))
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setMobileNavOpen(false)}
                    style={{
                      display: 'block',
                      padding: '0.75rem 1.25rem',
                      fontSize: '0.9rem',
                      fontWeight: active ? 700 : 500,
                      color: active ? T.accent : T.text,
                      textDecoration: 'none',
                      background: active ? T.accentLight : 'transparent',
                      borderLeft: active ? `3px solid ${T.accent}` : '3px solid transparent',
                    }}
                  >
                    {tab.label}
                  </Link>
                )
              })}
            </nav>
          )}
        </header>

        {/* ============================================================== */}
        {/* Main content area + optional agent panel                        */}
        {/* ============================================================== */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <main className="flex-1 px-6 py-5 pb-12 min-w-0">
            {/* Context chip — "Working as X · Role · Hub" */}
            <PrincipalContextChip />
            {/* Sub-nav for marketplace lanes */}
            <ActiveSubTabsStrip />
            {children}
          </main>

          {/* Agent panel (slide-in with dynamic suggestions) */}
          <AgentPanel
            open={agentPanelOpen}
            onClose={() => setAgentPanelOpen(false)}
          />
        </div>

        {/* ============================================================== */}
        {/* Quick Activity FAB                                              */}
        {/* ============================================================== */}
        <QuickActivityModal
          orgAddress={orgs[0]?.address ?? ''}
          showFab={true}
          {...fabDefaults}
        />

        <CommandPalette />

        {createOrgOpen && activeHub && (
          <CreateOrgDialog
            hubAddress={activeHub.address}
            hubName={activeHub.name}
            hubId={profile.id}
            onCancel={() => setCreateOrgOpen(false)}
            onCreated={() => {
              setCreateOrgOpen(false)
              window.location.reload()
            }}
          />
        )}
        {issueCredentialType && (
          <IssueCredentialDialog
            credentialType={issueCredentialType}
            context={activeHub ? { hubAddress: activeHub.address, hubName: activeHub.name } : undefined}
            onCancel={() => setIssueCredentialType(null)}
            onIssued={() => setIssueCredentialType(null)}
          />
        )}
      </HubShell>
    </CatalystViewCtx.Provider>
  )
}

// ---------------------------------------------------------------------------
// Sub-tabs strip — renders horizontal pills for the nav item that matches
// the current pathname.
// ---------------------------------------------------------------------------
function ActiveSubTabsStrip() {
  const { activeSubTabs } = useHubContext()
  const pathname = usePathname() ?? ''
  if (!activeSubTabs || activeSubTabs.length === 0) return null
  return (
    <nav
      aria-label="Section navigation"
      style={{
        display: 'flex',
        gap: '0.4rem',
        flexWrap: 'wrap',
        margin: '0.6rem 0 1rem',
        paddingBottom: '0.6rem',
        borderBottom: '1px solid #ece6db',
      }}
    >
      {activeSubTabs.map(t => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              padding: '0.4rem 0.85rem',
              borderRadius: 999,
              background: active ? '#8b5e3c' : '#ffffff',
              color: active ? '#fff' : '#5c4a3a',
              border: `1px solid ${active ? '#8b5e3c' : '#ece6db'}`,
              textDecoration: 'none',
            }}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Hub Layout (wraps in HubProvider) — used by the authenticated layout
// ---------------------------------------------------------------------------
export function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <HubProvider>
      <HubLayoutInner>{children}</HubLayoutInner>
    </HubProvider>
  )
}
