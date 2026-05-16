'use client'

/**
 * UserMenu — avatar + dropdown menu for the authenticated user.
 *
 * Factored out of HubLayout.tsx. Handles:
 *   - Avatar initial + .agent name display
 *   - Role badge
 *   - Dropdown with account links, admin tools, personalized sections
 *   - "Sign out" (never "Disconnect")
 *   - Accessible: aria-expanded, aria-haspopup, outside-click dismissal,
 *     ESC to close, min touch target 44px on the trigger.
 */

import { useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/use-auth'
import { listIssuableKinds } from '@/lib/credentials/registry'

interface UserNavSection {
  key: string
  label: string
  items: Array<{
    href: string
    label: string
    sublabel?: string
    badge?: string
    icon?: string
  }>
}

interface AdminNavItem {
  href: string
  label: string
}

interface UserMenuProps {
  userName: string
  userInitial: string
  userSubtitle?: string
  roleLabel?: string
  /** The hub slug used to build the tasks link */
  hubSlug: string
  /** Whether the current user has admin privileges */
  isAdmin: boolean
  adminNav: AdminNavItem[]
  userNav: UserNavSection[]
  /** Whether to show the "Create organization" option */
  showCreateOrg: boolean
  /** Hub address for Create org context */
  activeHubAddress?: string | null
  activeHubName?: string
  /** Hub profile ID for passing to org creation */
  hubId: string
  /** Theme tokens */
  accent: string
  accentLight: string
  text: string
  textMuted: string
  border: string
  onCreateOrg: () => void
  onIssueCredential: (type: string) => void
}

export function UserMenu({
  userName,
  userInitial,
  userSubtitle,
  roleLabel,
  hubSlug,
  isAdmin,
  adminNav,
  userNav,
  showCreateOrg,
  activeHubAddress,
  accent,
  accentLight,
  text,
  textMuted,
  border,
  onCreateOrg,
  onIssueCredential,
}: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { logout } = useAuth()

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Close on ESC
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const issuableKinds = listIssuableKinds({ hasActiveHub: Boolean(activeHubAddress) })

  function close() {
    setOpen(false)
  }

  const linkStyle = (weight = 500): React.CSSProperties => ({
    display: 'block',
    padding: '0.5rem 1rem',
    fontSize: '0.82rem',
    color: text,
    textDecoration: 'none',
    fontWeight: weight,
  })

  const sectionLabel: React.CSSProperties = {
    padding: '0.4rem 1rem 0.2rem',
    fontSize: '0.62rem',
    fontWeight: 700,
    color: textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  }

  const dividerStyle: React.CSSProperties = {
    borderTop: `1px solid ${border}`,
    margin: '0.3rem 0',
  }

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      {/* Trigger — 44px min height for touch compliance */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`User menu for ${userName}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: '0.2rem',
          borderRadius: 8,
          minHeight: 44,
          minWidth: 44,
        }}
      >
        {/* Avatar */}
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: accent,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '0.85rem',
            flexShrink: 0,
          }}
        >
          {userInitial}
        </span>

        {/* Name + role badge */}
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
          <span style={{ fontWeight: 600, fontSize: '0.8rem', color: text }}>
            {userName}
          </span>
          {userSubtitle && (
            <span style={{ fontSize: '0.65rem', color: textMuted }}>
              {userSubtitle}
            </span>
          )}
          {roleLabel && (
            <span
              style={{
                fontSize: '0.6rem',
                fontWeight: 600,
                color: accent,
                background: accentLight,
                padding: '1px 5px',
                borderRadius: 8,
                textTransform: 'capitalize',
              }}
            >
              {roleLabel}
            </span>
          )}
        </span>

        {/* Chevron */}
        <span aria-hidden="true" style={{ fontSize: '0.55rem', color: textMuted, marginLeft: 2 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          aria-label="User account menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            background: '#fff',
            border: `1px solid ${border}`,
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
            zIndex: 100,
            minWidth: 200,
            padding: '0.5rem 0',
          }}
        >
          {/* Identity header */}
          <div style={{ padding: '0.4rem 1rem 0.3rem', ...sectionLabel }}>
            Your Account
          </div>
          <div style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: accent,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.9rem',
                flexShrink: 0,
              }}
            >
              {userInitial}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: text }}>{userName}</div>
              {roleLabel && <div style={{ fontSize: '0.72rem', color: textMuted }}>{roleLabel}</div>}
            </div>
          </div>

          <div style={dividerStyle} />

          {/* Core links */}
          <Link
            role="menuitem"
            href={`/h/${hubSlug}/tasks`}
            onClick={close}
            style={{ ...linkStyle(600), display: 'block' }}
            data-testid="user-dropdown-inbox"
          >
            Funding milestones
          </Link>
          <Link
            role="menuitem"
            href="/wallet"
            onClick={close}
            style={{ ...linkStyle(), display: 'block' }}
            data-testid="user-dropdown-wallet"
          >
            Wallet
          </Link>
          <Link
            role="menuitem"
            href="/catalyst/me"
            onClick={close}
            style={{ ...linkStyle(), display: 'block' }}
          >
            Profile
          </Link>
          <Link
            role="menuitem"
            href="/catalyst/me/settings"
            onClick={close}
            style={{ ...linkStyle(), display: 'block' }}
          >
            Settings
          </Link>

          {/* Create org */}
          {showCreateOrg && activeHubAddress && (
            <button
              role="menuitem"
              type="button"
              onClick={() => { close(); onCreateOrg() }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.5rem 1rem',
                fontSize: '0.82rem',
                color: text,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 500,
              }}
              data-testid="hub-dropdown-create-org"
            >
              + Register organization
            </button>
          )}

          {/* Credential issuance */}
          {issuableKinds.map((kind) => (
            <button
              role="menuitem"
              key={kind.descriptor.credentialType}
              type="button"
              onClick={() => { close(); onIssueCredential(kind.descriptor.credentialType) }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.5rem 1rem',
                fontSize: '0.82rem',
                color: text,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 500,
              }}
              data-testid={`hub-dropdown-get-${kind.descriptor.noun}-credential`}
            >
              + Get {kind.descriptor.noun} credential
            </button>
          ))}

          {/* Admin tools */}
          {isAdmin && adminNav.length > 0 && (
            <>
              <div style={dividerStyle} />
              <div style={sectionLabel}>Admin Tools</div>
              {adminNav.map((item) => (
                <Link
                  role="menuitem"
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  style={{ ...linkStyle(), display: 'block' }}
                >
                  {item.label}
                </Link>
              ))}
            </>
          )}

          {/* Personalised nav sections */}
          {userNav.map((section) => (
            <div key={section.key}>
              <div style={dividerStyle} />
              <div style={sectionLabel}>{section.label}</div>
              {section.items.map((item, idx) => (
                <Link
                  role="menuitem"
                  key={`${section.key}-${idx}`}
                  href={item.href}
                  onClick={close}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.4rem 1rem',
                    fontSize: '0.82rem',
                    color: text,
                    textDecoration: 'none',
                    fontWeight: 500,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: item.icon === 'person' ? '50%' : 6,
                      background:
                        item.icon === 'ai'
                          ? '#7c3aed'
                          : item.icon === 'group'
                            ? accent
                            : accentLight,
                      color: item.icon === 'ai' || item.icon === 'group' ? '#fff' : text,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {item.icon === 'group'
                      ? 'G'
                      : item.icon === 'person'
                        ? item.label.charAt(0)
                        : item.icon === 'ai'
                          ? 'AI'
                          : item.label.charAt(0)}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.label}
                    </span>
                    {item.sublabel && (
                      <span style={{ fontSize: '0.68rem', color: textMuted, textTransform: 'capitalize' }}>
                        {item.sublabel}
                      </span>
                    )}
                  </span>
                  {item.badge && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        color: accent,
                        background: accentLight,
                        padding: '1px 6px',
                        borderRadius: 8,
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}

          {/* Sign out */}
          <div style={dividerStyle} />
          <button
            role="menuitem"
            onClick={async () => {
              close()
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
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
