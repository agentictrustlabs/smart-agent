'use client'

import { useMemo } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface StatusItem {
  icon: string
  label: string
  href: string
  count?: number
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useStatusItems(hubId?: string): StatusItem[] {
  return useMemo<StatusItem[]>(
    () => hubId === 'cil' ? [
      { icon: '\uD83D\uDD14', label: 'agent insights', href: '/h/mission/home', count: 2 },
      { icon: '\uD83D\uDCB0', label: 'report pending', href: '/activity', count: 1 },
      { icon: '\uD83D\uDFE1', label: 'business at risk', href: '/groups', count: 1 },
      { icon: '\uD83D\uDCC8', label: 'recovered', href: '/steward', count: 34 },
    ] : [
      { icon: '\uD83D\uDD14', label: 'agent insights', href: '/h/catalyst/home', count: 3 },
      { icon: '\uD83D\uDE4F', label: 'prayer due today', href: '/nurture/prayer', count: 1 },
      { icon: '\uD83D\uDCCA', label: 'circles need attention', href: '/groups', count: 2 },
      { icon: '\u2709', label: 'follow-up pending', href: '/activity', count: 1 },
    ],
    [hubId],
  )
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const P = {
  text: '#5c4a3a',
  textMuted: '#9a8b7a',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.08)',
  border: '#ece6db',
}

// ---------------------------------------------------------------------------
// Render helper: display a row of status items (e.g. in a status bar)
// ---------------------------------------------------------------------------
export function StatusBar() {
  const items = useStatusItems()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
    >
      {items.map((item, idx) => (
        <a
          key={idx}
          href={item.href}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            textDecoration: 'none',
            fontSize: '0.78rem',
            color: P.text,
            padding: '0.2rem 0.5rem',
            borderRadius: 12,
            background: P.accentLight,
            border: `1px solid ${P.border}`,
            transition: 'background 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '0.85rem' }}>{item.icon}</span>
          {item.count !== undefined && item.count > 0 && (
            <span
              style={{
                fontWeight: 700,
                fontSize: '0.72rem',
                color: P.accent,
              }}
            >
              {item.count}
            </span>
          )}
          <span style={{ color: P.textMuted, fontSize: '0.72rem' }}>
            {item.label}
          </span>
        </a>
      ))}
    </div>
  )
}
