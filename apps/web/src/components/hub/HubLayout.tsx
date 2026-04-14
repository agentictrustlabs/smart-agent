'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useUserContext } from '@/components/user/UserContext'
import { HubProvider, useHubContext } from '@/components/hub/HubContext'
import { CatalystViewCtx } from '@/components/catalyst/CatalystViewContext'
import type { ViewMode } from '@/components/catalyst/CatalystViewContext'
import QuickActivityModal from '@/components/catalyst/QuickActivityModal'
import { AgentPanel } from '@/components/agent/AgentPanel'

// ---------------------------------------------------------------------------
// Tab definitions — intent-based primary navigation
// ---------------------------------------------------------------------------
interface IntentTab {
  label: string
  href: string
  matchPaths: string[]
}

const INTENT_TABS: IntentTab[] = [
  {
    label: 'Home',
    href: '/catalyst',
    matchPaths: ['/', '/catalyst', '/dashboard'],
  },
  {
    label: 'Nurture',
    href: '/nurture',
    matchPaths: ['/nurture', '/catalyst/prayer', '/catalyst/grow', '/catalyst/coach', '/nurture/prayer', '/nurture/grow', '/nurture/coaching'],
  },
  {
    label: 'Oikos',
    href: '/oikos',
    matchPaths: ['/oikos', '/circles', '/catalyst/circles'],
  },
  {
    label: 'Build',
    href: '/groups',
    matchPaths: ['/groups', '/catalyst/groups', '/catalyst/members', '/catalyst/map', '/catalyst/activities'],
  },
  {
    label: 'Steward',
    href: '/steward',
    matchPaths: ['/steward', '/treasury', '/reviews', '/network', '/trust', '/steward/treasury', '/steward/reviews', '/steward/network', '/steward/governance'],
  },
  {
    label: 'Activity',
    href: '/activity',
    matchPaths: ['/activity', '/catalyst/activities', '/activities'],
  },
]

function isTabActive(pathname: string, tab: IntentTab): boolean {
  return tab.matchPaths.some(p => pathname === p || pathname.startsWith(p + '/'))
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
  '/onboarding': { label: 'Home', href: '/catalyst' },
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
  const { personAgent, orgs, hasRole, loading } = useUserContext()
  const hub = useHubContext()
  const { profile, adminNav, availableViewModes, viewMode, setViewMode, userNav } = hub
  const T = profile.theme

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

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

  const userName = personAgent?.name ?? 'User'
  const userInitial = userName.charAt(0).toUpperCase()
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

  const statusItems = [
    { icon: '\uD83D\uDD14', label: '3 agent insights', href: '/catalyst' },
    { icon: '\uD83D\uDE4F', label: '1 prayer due today', href: '/nurture/prayer' },
    { icon: '\uD83D\uDCCA', label: '2 circles need attention', href: '/groups' },
    { icon: '\u2709', label: '1 follow-up pending', href: '/activity' },
  ]

  // Show a neutral loading shell until user context resolves.
  // This prevents hydration mismatch between SSR (generic theme) and client (hub theme).
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#fafafa' }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 40, background: '#fff', borderBottom: '1px solid #e0e0e0', height: 56, display: 'flex', alignItems: 'center', padding: '0 1rem' }}>
          <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#37474f' }}>Smart Agent</span>
        </header>
        <main style={{ flex: 1, padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#9e9e9e', fontSize: '0.9rem' }}>Loading...</span>
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
        <header style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: T.headerBg,
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}>
          {/* Primary row: logo + tabs + mode toggle + agent + user */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 1rem',
            height: 56,
            gap: '0.75rem',
          }}>
            {/* ── Left: Logo + Brand ── */}
            <Link href="/" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              textDecoration: 'none',
              flexShrink: 0,
            }}>
              <LogoIcon accent={T.accent} />
              <span style={{
                fontWeight: 700,
                fontSize: '1.05rem',
                color: T.text,
                letterSpacing: '-0.01em',
              }}>
                Smart Agent
              </span>
            </Link>

            {/* ── Center: Intent-based primary tabs ── */}
            <nav style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              flexWrap: 'wrap',
              justifyContent: 'center',
              flex: 1,
              minWidth: 0,
            }}>
              {INTENT_TABS.map(tab => {
                const active = isTabActive(pathname, tab)
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    style={{
                      padding: '0.35rem 0.85rem',
                      borderRadius: 20,
                      fontSize: '0.82rem',
                      fontWeight: active ? 650 : 500,
                      color: active ? '#fff' : T.text,
                      background: active ? T.accent : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap',
                    }}
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
                    <span style={{
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      color: T.text,
                    }}>
                      {loading ? '...' : userName}
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
                      onClick={() => {
                        setUserMenuOpen(false)
                        // Clear demo cookie and redirect to landing
                        document.cookie = 'demo-user=; path=/; max-age=0'
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
          <main style={{
            flex: 1,
            padding: '1.25rem 1.5rem 3rem',
            minWidth: 0,
          }}>
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
