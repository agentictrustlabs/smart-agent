'use client'

/**
 * DelegationConsentCard — shown BEFORE any wallet/delegation prompt.
 *
 * Discloses in plain language:
 *   - What authority the agent is being granted
 *   - Who the authority is granted to
 *   - How long it lasts
 *   - What the limits are (caveats)
 *   - Where to revoke it
 *
 * Design constraints:
 *   - Light corporate palette, white card (#ffffff)
 *   - No dark mode
 *   - Uses ConfirmActionModal shape when the action requires explicit consent,
 *     or renders inline as a card when it's informational before a prompt
 *   - Revoke link always visible
 *   - Default to least privilege (scopeList should be minimal)
 */

import Link from 'next/link'

export interface DelegationConsentCardProps {
  /**
   * Plain-language list of what the agent can do.
   * Example: ['View your profile', 'Submit funding proposals on your behalf']
   */
  scopeList: string[]
  /**
   * Who receives this authority.
   * Example: 'your Smart Agent assistant'
   */
  grantee: string
  /**
   * How long the authority lasts.
   * Example: '24 hours', 'this session', '30 days'
   */
  duration: string
  /**
   * Limits on the authority (caveats).
   * Example: ['Maximum 500 USDC per transaction', 'Only to addresses you approve']
   */
  limits?: string[]
  /**
   * Where the user can revoke this authority.
   * Defaults to /wallet/sessions.
   */
  revokeHref?: string
  /** Called when the user explicitly accepts. If omitted, no accept button shown. */
  onAccept?: () => void
  /** Called when the user declines. If omitted, no decline button shown. */
  onDecline?: () => void
  /** Whether this is a compact/inline variant (no border card chrome). */
  inline?: boolean
}

const C = {
  card: '#ffffff',
  border: '#ece6db',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.08)',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  danger: '#b91c1c',
  noteBg: '#fff8f4',
  noteBorder: 'rgba(139,94,60,0.20)',
}

export function DelegationConsentCard({
  scopeList,
  grantee,
  duration,
  limits,
  revokeHref = '/wallet/sessions',
  onAccept,
  onDecline,
  inline = false,
}: DelegationConsentCardProps) {
  const cardStyle: React.CSSProperties = inline
    ? {}
    : {
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: '1.25rem 1.5rem',
        boxShadow: '0 2px 12px rgba(92,74,58,0.08)',
      }

  return (
    <div style={cardStyle} role="region" aria-label="Agent permissions">
      {/* Header */}
      <div style={{ marginBottom: '0.75rem' }}>
        <h2
          style={{
            fontSize: '1rem',
            fontWeight: 700,
            color: C.text,
            margin: 0,
            marginBottom: '0.25rem',
          }}
        >
          Your agent will be able to
        </h2>
        <p style={{ fontSize: '0.82rem', color: C.textMuted, margin: 0 }}>
          Granted to {grantee} for {duration}.
        </p>
      </div>

      {/* Scope list */}
      <ul
        style={{
          margin: '0 0 0.75rem',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
        }}
      >
        {scopeList.map((scope, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.55rem',
              fontSize: '0.85rem',
              color: C.text,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: C.accent,
                marginTop: '0.4rem',
                display: 'inline-block',
              }}
            />
            {scope}
          </li>
        ))}
      </ul>

      {/* Limits (caveats) */}
      {limits && limits.length > 0 && (
        <div
          style={{
            background: C.noteBg,
            border: `1px solid ${C.noteBorder}`,
            borderRadius: 8,
            padding: '0.6rem 0.8rem',
            marginBottom: '0.75rem',
            fontSize: '0.8rem',
            color: C.text,
          }}
          role="note"
          aria-label="Permission limits"
        >
          <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>Limits</div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {limits.map((limit, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                <span aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.1rem' }}>{'•'}</span>
                {limit}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Revoke link — always visible */}
      <div style={{ marginBottom: onAccept || onDecline ? '1rem' : 0 }}>
        <Link
          href={revokeHref}
          style={{
            fontSize: '0.78rem',
            color: C.accent,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          Revoke these permissions any time
        </Link>
      </div>

      {/* Action buttons (optional) */}
      {(onAccept || onDecline) && (
        <div
          style={{
            display: 'flex',
            gap: '0.6rem',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          {onDecline && (
            <button
              type="button"
              onClick={onDecline}
              style={{
                padding: '0.5rem 1rem',
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                background: '#fff',
                color: C.text,
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              Decline
            </button>
          )}
          {onAccept && (
            <button
              type="button"
              onClick={onAccept}
              style={{
                padding: '0.5rem 1.1rem',
                border: 'none',
                borderRadius: 8,
                background: C.accent,
                color: '#fff',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              Allow
            </button>
          )}
        </div>
      )}
    </div>
  )
}
