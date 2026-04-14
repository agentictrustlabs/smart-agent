'use client'

import Link from 'next/link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AgentCardProps {
  agentName: string
  agentType: 'personal' | 'organization' | 'ai'
  message: string
  actions?: Array<{ label: string; onClick?: () => void; href?: string }>
  onDismiss?: () => void
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const P = {
  bg: '#faf8f3',
  text: '#5c4a3a',
  textMuted: '#9a8b7a',
  border: '#ece6db',
  accent: '#8b5e3c',
}

const TYPE_COLORS: Record<AgentCardProps['agentType'], string> = {
  personal: '#8b5e3c',
  organization: '#2e7d32',
  ai: '#7c3aed',
}

const TYPE_LABELS: Record<AgentCardProps['agentType'], string> = {
  personal: 'Personal',
  organization: 'Organization',
  ai: 'AI',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AgentCard({ agentName, agentType, message, actions, onDismiss }: AgentCardProps) {
  const color = TYPE_COLORS[agentType]

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 12,
        border: `1px solid ${P.border}`,
        background: P.bg,
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          width: 3,
          flexShrink: 0,
          background: color,
          borderRadius: '12px 0 0 12px',
        }}
      />

      <div style={{ flex: 1, padding: '0.7rem 0.85rem' }}>
        {/* Agent identity row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.4rem',
          }}
        >
          {/* Avatar */}
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: color,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.72rem',
              flexShrink: 0,
            }}
          >
            {agentName.charAt(0)}
          </span>

          <span style={{ fontWeight: 650, fontSize: '0.82rem', color: P.text }}>
            {agentName}
          </span>

          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 600,
              color,
              background: `${color}15`,
              padding: '1px 6px',
              borderRadius: 8,
            }}
          >
            {TYPE_LABELS[agentType]}
          </span>
        </div>

        {/* Message */}
        <p
          style={{
            fontSize: '0.85rem',
            color: P.text,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>

        {/* Action buttons */}
        {actions && actions.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: '0.4rem',
              marginTop: '0.55rem',
              flexWrap: 'wrap',
            }}
          >
            {actions.map((action, idx) => {
              const btnStyle: React.CSSProperties = {
                border: `1px solid ${P.border}`,
                borderRadius: 14,
                padding: '0.22rem 0.65rem',
                fontSize: '0.72rem',
                fontWeight: 550,
                color: P.accent,
                background: '#fff',
                cursor: 'pointer',
                textDecoration: 'none',
                display: 'inline-block',
                transition: 'background 0.15s',
              }

              if (action.href) {
                return (
                  <Link key={idx} href={action.href} style={btnStyle}>
                    {action.label}
                  </Link>
                )
              }

              return (
                <button
                  key={idx}
                  onClick={action.onClick}
                  style={btnStyle}
                >
                  {action.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: P.textMuted,
            fontSize: '0.78rem',
            lineHeight: 1,
            padding: 2,
          }}
        >
          &#x2715;
        </button>
      )}
    </div>
  )
}
