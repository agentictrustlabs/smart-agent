'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useUserContext } from '@/components/user/UserContext'
import { HubProvider, useHubContext } from '@/components/hub/HubContext'
import { CreateOrgDialog } from '@/components/org/CreateOrgDialog'
import { AnonOrgRegistrationDialog } from '@/components/org/AnonOrgRegistrationDialog'
import type { HubId } from '@/lib/hub-profiles'
import { CatalystViewCtx } from '@/components/catalyst/CatalystViewContext'
import type { ViewMode } from '@/components/catalyst/CatalystViewContext'
import QuickActivityModal from '@/components/catalyst/QuickActivityModal'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { useAuth } from '@/hooks/use-auth'

// No hardcoded tabs — primary navigation comes from the hub profile via HubContext

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
  'groups': 'Circles',
  'steward': 'Steward',
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
  'governance': 'Governance',
  'coaching': 'Coaching',
  'revenue': 'Revenue',
  'portfolio': 'Portfolio',
  'command-center': 'Command Center',
  'training': 'Training',
  'reports': 'Reports',
  'dashboard': 'Dashboard',
}

// Maps standalone routes to their parent intent tab
const PARENT_INTENT: Record<string, { label: string; href: string }> = {
  '/treasury': { label: 'Steward', href: '/steward' },
  '/reviews': { label: 'Steward', href: '/steward' },
  '/network': { label: 'Steward', href: '/steward' },
  '/trust': { label: 'Steward', href: '/steward' },
  '/settings': { label: 'Steward', href: '/steward' },
  '/agents': { label: 'Steward', href: '/steward' },
  '/team': { label: 'Steward', href: '/steward' },
  '/genmap': { label: 'Build', href: '/groups' },
  '/members': { label: 'Build', href: '/groups' },
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

  // For standalone routes that belong to a parent intent, inject parent
  const parentIntent = PARENT_INTENT[pathname] ?? PARENT_INTENT['/' + segments[0]]
  if (parentIntent && segments.length >= 1) {
    const crumbs: Array<{ label: string; href: string }> = [
      { label: parentIntent.label, href: parentIntent.href },
    ]
    // Add current page as second crumb
    const seg = segments[segments.length - 1]
    const label = SEGMENT_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1)
    crumbs.push({ label, href: pathname })
    return crumbs
  }

  if (segments.length <= 1) return []

  const crumbs: Array<{ label: string; href: string }> = []
  let currentPath = ''

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    currentPath += '/' + seg

    // Check if this segment looks like an address or ID (hex or long string)
    if (seg.startsWith('0x') || (seg.length > 20 && /^[a-f0-9]+$/i.test(seg))) {
      // Use org name if available, otherwise truncate
      const label = orgName || (seg.substring(0, 6) + '...' + seg.substring(seg.length - 4))
      crumbs.push({ label, href: currentPath })
    } else {
      const label = SEGMENT_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1)
      crumbs.push({ label, href: currentPath })
    }
  }

  return crumbs
}

// ---------------------------------------------------------------------------
// Logo SVG — small network icon in rounded blue square
// ---------------------------------------------------------------------------
function LogoIcon({ accent }: { accent: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
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
  const { logout } = useAuth()

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [createOrgOpen, setCreateOrgOpen] = useState(false)
  const [anonOrgOpen, setAnonOrgOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // Pick the active hub's address (used to scope "Create organization"). The
  // hub the user is currently viewing is the first one in the list whose
  // identity matches the active profile id; for users in a single hub this
  // is just hubs[0].
  const activeHub = hubs.find(h => hubProfileMatches(h, profile.id)) ?? hubs[0] ?? null

  const isAdmin = hasRole('owner') || hasRole('admin') || hasRole('ceo')

  // Close menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Prefer the .agent primary name (e.g. "joe.catalyst.agent") for the
  // upper-right identity surface — that's the canonical handle once a user
  // has registered one. Fall back to the friendly displayName, then 'User'.
  const userPrimaryName = personAgent?.primaryName || ''
  const userName = userPrimaryName || personAgent?.name || 'User'
  const userSubtitle = userPrimaryName && personAgent?.name && personAgent.name !== userPrimaryName
    ? personAgent.name
    : ''
  const userInitial = (personAgent?.name || userName).charAt(0).toUpperCase()
  const orgName = orgs[0]?.name ?? profile.name

  // Role label from view modes or fallback
  const roleLabel = availableViewModes.length > 0
    ? (availableViewModes.find(m => m.key === viewMode)?.label ?? viewMode)
    : ''

  // Bridge to CatalystViewCtx for backward compat
  const catalystViewMode = (viewMode === 'coach' ? 'coach' : 'disciple') as ViewMode
  const setCatalystViewMode = (m: ViewMode) => setViewMode(m)

  // Visible admin items
  const visibleAdminItems = isAdmin ? adminNav : []

  // Breadcrumbs
  const breadcrumbs = deriveBreadcrumbs(pathname, orgName)
  const showBreadcrumbs = breadcrumbs.length > 1

  // Status bar items (hardcoded samples for now)
  // Derive FAB defaults based on current route
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

  // Hub-specific status bar items
  const statusItems = profile.id === 'cil' ? [
    { icon: '\uD83D\uDD14', label: '2 agent insights', href: '/h/mission/home' },
    { icon: '\uD83D\uDCB0', label: '1 report pending', href: '/activity' },
    { icon: '\uD83D\uDFE1', label: '1 business at risk', href: '/groups' },
    { icon: '\uD83D\uDCC8', label: '34% recovered', href: '/steward' },
  ] : profile.id === 'catalyst' ? [
    { icon: '\uD83D\uDD14', label: '3 agent insights', href: '/h/catalyst/home' },
    { icon: '\uD83D\uDE4F', label: '1 prayer due today', href: '/nurture/prayer' },
    { icon: '\uD83D\uDCCA', label: '2 circles need attention', href: '/groups' },
    { icon: '\u2709', label: '1 follow-up pending', href: '/activity' },
  ] : [
    { icon: '\uD83D\uDD14', label: `${orgs.length} organization${orgs.length !== 1 ? 's' : ''}`, href: '/agents' },
    { icon: '\uD83E\uDD16', label: 'Agent registry', href: '/agents' },
    { icon: '\uD83D\uDD17', label: 'Trust graph', href: '/steward' },
  ]

  // Show a neutral loading shell until user context resolves.
  // This prevents hydration mismatch between SSR (generic theme) and client (hub theme).
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
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: T.bg,
      }}>
        {/* ============================================================== */}
        {/* Top Header Bar                                                  */}
        {/* ============================================================== */}
        <header className="sticky top-0 z-40 bg-white border-b border-outline-variant flex-shrink-0 shadow-elevation-1">
          {/* Primary row: logo + tabs + mode toggle + agent + user */}
          <div className="flex items-center justify-between px-4 h-14 gap-3">
            {/* ── Left: Logo + Brand ── */}
            <Link href="/" className="flex items-center gap-2 no-underline flex-shrink-0">
              <LogoIcon accent={T.accent} />
              <span className="font-bold text-title-md text-on-surface tracking-tight">
                {loading ? 'Loading...' : profile.name}
              </span>
            </Link>

            {/* ── Center: Intent-based primary tabs ── */}
            <nav className="flex items-center gap-1 flex-wrap justify-center flex-1 min-w-0">
              {primaryNav.map(tab => {
                const active = tab.activePrefixes
                  ? tab.activePrefixes.some(p => pathname === p || pathname.startsWith(p + '/'))
                  : (tab.exact ? pathname === tab.href : pathname.startsWith(tab.href + '/'))
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`px-4 py-1.5 rounded-full text-label-lg no-underline transition-all duration-200 whitespace-nowrap ${
                      active
                        ? 'bg-primary text-on-primary font-semibold shadow-elevation-1'
                        : 'text-on-surface-variant hover:bg-surface-variant hover:text-on-surface font-medium'
                    }`}
                  >
                    {tab.label}
                  </Link>
                )
              })}
            </nav>

            {/* ── Right: Mode toggle + Agent button + User dropdown ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              {/* Agent panel toggle */}
              <button
                onClick={() => setAgentPanelOpen(prev => !prev)}
                title="Toggle agent panel"
                style={{
                  border: 'none',
                  background: agentPanelOpen ? T.accentLight : 'transparent',
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  transition: 'background 0.15s',
                }}
              >
                {'\uD83E\uDD16'}
              </button>

              {/* User avatar + dropdown */}
              <div ref={userMenuRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: '0.2rem',
                    borderRadius: 8,
                  }}
                >
                  <span style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: T.accent,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                  }}>
                    {userInitial}
                  </span>
                  <span style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    lineHeight: 1.2,
                  }}>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '0.8rem',
                        color: T.text,
                      }}
                      title={userSubtitle || undefined}
                    >
                      {loading ? '...' : userName}
                    </span>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        color: T.textMuted,
                        // Always render the slot — keeps the DOM shape stable
                        // across the loading→ready transition so React's
                        // reconciler doesn't reposition siblings.
                        display: userSubtitle ? 'inline' : 'none',
                      }}
                    >
                      {userSubtitle}
                    </span>
                    {roleLabel && (
                      <span style={{
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        color: T.accent,
                        background: T.accentLight,
                        padding: '1px 5px',
                        borderRadius: 8,
                        textTransform: 'capitalize',
                      }}>
                        {roleLabel}
                      </span>
                    )}
                  </span>
                  <span style={{
                    fontSize: '0.55rem',
                    color: T.textMuted,
                    marginLeft: 2,
                  }}>
                    {userMenuOpen ? '\u25B2' : '\u25BC'}
                  </span>
                </button>

                {/* User dropdown */}
                {userMenuOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 6,
                    background: '#fff',
                    border: `1px solid ${T.border}`,
                    borderRadius: 12,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                    zIndex: 100,
                    minWidth: 200,
                    padding: '0.5rem 0',
                  }}>
                    <div style={{
                      padding: '0.4rem 1rem 0.3rem',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      color: T.textMuted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}>
                      Your Account
                    </div>
                    <div style={{
                      padding: '0.5rem 1rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}>
                      <span style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: T.accent,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        flexShrink: 0,
                      }}>
                        {userInitial}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: T.text }}>
                          {userName}
                        </div>
                        {roleLabel && (
                          <div style={{ fontSize: '0.72rem', color: T.textMuted }}>
                            {roleLabel}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ borderTop: `1px solid ${T.border}`, margin: '0.3rem 0' }} />
                    <Link
                      href="/catalyst/me"
                      onClick={() => setUserMenuOpen(false)}
                      style={{
                        display: 'block',
                        padding: '0.5rem 1rem',
                        fontSize: '0.82rem',
                        color: T.text,
                        textDecoration: 'none',
                        fontWeight: 500,
                      }}
                    >
                      Profile
                    </Link>
                    <Link
                      href="/catalyst/me/settings"
                      onClick={() => setUserMenuOpen(false)}
                      style={{
                        display: 'block',
                        padding: '0.5rem 1rem',
                        fontSize: '0.82rem',
                        color: T.text,
                        textDecoration: 'none',
                        fontWeight: 500,
                      }}
                    >
                      Settings
                    </Link>

                    {activeHub && (
                      <button
                        type="button"
                        onClick={() => { setUserMenuOpen(false); setCreateOrgOpen(true) }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '0.5rem 1rem', fontSize: '0.82rem',
                          color: T.text, background: 'transparent',
                          border: 'none', cursor: 'pointer', fontWeight: 500,
                        }}
                        data-testid="hub-dropdown-create-org"
                      >
                        + Create organization
                      </button>
                    )}
                    {activeHub && (
                      <button
                        type="button"
                        onClick={() => { setUserMenuOpen(false); setAnonOrgOpen(true) }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '0.5rem 1rem', fontSize: '0.82rem',
                          color: T.text, background: 'transparent',
                          border: 'none', cursor: 'pointer', fontWeight: 500,
                        }}
                        data-testid="hub-dropdown-anon-org"
                      >
                        + Anonymous org registration
                      </button>
                    )}

                    {/* ── Admin tools (moved from center nav) ── */}
                    {visibleAdminItems.length > 0 && (
                      <>
                        <div style={{ borderTop: `1px solid ${T.border}`, margin: '0.3rem 0' }} />
                        <div style={{
                          padding: '0.4rem 1rem 0.2rem',
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          color: T.textMuted,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}>
                          Admin Tools
                        </div>
                        {visibleAdminItems.map(item => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setUserMenuOpen(false)}
                            style={{
                              display: 'block',
                              padding: '0.4rem 1rem',
                              fontSize: '0.82rem',
                              color: T.text,
                              textDecoration: 'none',
                              fontWeight: 500,
                            }}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </>
                    )}

                    {/* ── Personalized nav sections ── */}
                    {userNav.map(section => (
                      <div key={section.key}>
                        <div style={{ borderTop: `1px solid ${T.border}`, margin: '0.3rem 0' }} />
                        <div style={{
                          padding: '0.4rem 1rem 0.2rem',
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          color: T.textMuted,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}>
                          {section.label}
                        </div>
                        {section.items.map((item, idx) => (
                          <Link
                            key={`${section.key}-${idx}`}
                            href={item.href}
                            onClick={() => setUserMenuOpen(false)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              padding: '0.4rem 1rem',
                              fontSize: '0.82rem',
                              color: T.text,
                              textDecoration: 'none',
                              fontWeight: 500,
                            }}
                          >
                            <span style={{
                              width: 22,
                              height: 22,
                              borderRadius: item.icon === 'person' ? '50%' : 6,
                              background: item.icon === 'ai' ? '#7c3aed' : item.icon === 'group' ? T.accent : T.accentLight,
                              color: (item.icon === 'ai' || item.icon === 'group') ? '#fff' : T.text,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.6rem',
                              fontWeight: 700,
                              flexShrink: 0,
                            }}>
                              {item.icon === 'group' ? 'G' : item.icon === 'person' ? item.label.charAt(0) : item.icon === 'ai' ? 'AI' : item.label.charAt(0)}
                            </span>
                            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                              <span style={{
                                fontSize: '0.82rem',
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                {item.label}
                              </span>
                              {item.sublabel && (
                                <span style={{
                                  fontSize: '0.68rem',
                                  color: T.textMuted,
                                  textTransform: 'capitalize',
                                }}>
                                  {item.sublabel}
                                </span>
                              )}
                            </span>
                            {item.badge && (
                              <span style={{
                                marginLeft: 'auto',
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                color: T.accent,
                                background: T.accentLight,
                                padding: '1px 6px',
                                borderRadius: 8,
                              }}>
                                {item.badge}
                              </span>
                            )}
                          </Link>
                        ))}
                      </div>
                    ))}

                    <div style={{ borderTop: `1px solid ${T.border}`, margin: '0.3rem 0' }} />
                    <button
                      onClick={async () => {
                        setUserMenuOpen(false)
                        await logout()
                        window.location.href = '/'
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.5rem 1rem',
                        fontSize: '0.82rem',
                        color: '#dc2626',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ============================================================== */}
          {/* Breadcrumb bar (only when navigated deep)                       */}
          {/* ============================================================== */}
          {showBreadcrumbs && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0 1.25rem',
              height: 32,
              borderTop: `1px solid ${T.border}`,
              background: T.bg,
              fontSize: '0.75rem',
              color: T.textMuted,
            }}>
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.href} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  {i > 0 && (
                    <span style={{ color: T.textMuted, opacity: 0.5, fontSize: '0.65rem' }}>{'>'}</span>
                  )}
                  {i < breadcrumbs.length - 1 ? (
                    <Link
                      href={crumb.href}
                      style={{
                        color: T.textMuted,
                        textDecoration: 'none',
                        fontWeight: 500,
                        transition: 'color 0.15s',
                      }}
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span style={{ color: T.text, fontWeight: 600 }}>{crumb.label}</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </header>

        {/* ============================================================== */}
        {/* Main content area + optional agent panel                        */}
        {/* ============================================================== */}
        <div style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
        }}>
          <main className="flex-1 px-6 py-5 pb-12 min-w-0">
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

        {/* ============================================================== */}
        {/* Bottom status bar                                               */}
        {/* ============================================================== */}
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          height: 36,
          background: '#1e293b',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          fontSize: '0.72rem',
          fontWeight: 500,
        }}>
          {statusItems.map((item, i) => (
            <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {i > 0 && (
                <span style={{ color: 'rgba(255,255,255,0.3)', margin: '0 0.25rem' }}>{'\u00B7'}</span>
              )}
              <Link
                href={item.href}
                style={{
                  color: '#fff',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  transition: 'opacity 0.15s',
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </span>
          ))}
        </div>

        {createOrgOpen && activeHub && (
          <CreateOrgDialog
            hubAddress={activeHub.address}
            hubName={activeHub.name}
            hubId={profile.id}
            onCancel={() => setCreateOrgOpen(false)}
            onCreated={() => {
              setCreateOrgOpen(false)
              // Hard reload so /api/user-context picks up the new org
              // membership and downstream views (org list, dashboards) refresh.
              window.location.reload()
            }}
          />
        )}
        {anonOrgOpen && activeHub && (
          <AnonOrgRegistrationDialog
            hubAddress={activeHub.address}
            hubName={activeHub.name}
            onCancel={() => setAnonOrgOpen(false)}
            onIssued={() => {
              setAnonOrgOpen(false)
              // The held-credentials panel on /h/{slug}/home loads on demand,
              // so a hard reload isn't required. Just close — user can hit
              // "Show held credentials" to confirm the new entry.
            }}
          />
        )}
      </div>
    </CatalystViewCtx.Provider>
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
