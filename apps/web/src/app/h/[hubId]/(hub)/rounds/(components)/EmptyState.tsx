/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Empty state (T031).
 *
 * Server component. Renders a friendly empty message when filters
 * yield zero rounds (FR-004). Suggests one corrective action depending
 * on which filter the caller indicates is the likely culprit.
 */

import Link from 'next/link'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
}

export type EmptyHint = 'widen-filters' | 'include-closed' | 'no-rounds'

export function EmptyState({
  hubSlug,
  hint = 'widen-filters',
  hasFilters = false,
}: {
  hubSlug: string
  hint?: EmptyHint
  hasFilters?: boolean
}) {
  let title = 'No open rounds'
  let body = 'There are no rounds open right now in this hub.'
  let cta: { href: string; label: string } | null = null

  if (hint === 'include-closed') {
    title = 'No open rounds match'
    body = 'All rounds matching your filters are closed.'
    cta = { href: `/h/${hubSlug}/rounds?includeClosed=1`, label: 'Include closed rounds' }
  } else if (hint === 'widen-filters' && hasFilters) {
    title = 'No rounds match your filters'
    body = 'Try widening your filters or removing some criteria.'
    cta = { href: `/h/${hubSlug}/rounds`, label: 'Clear filters' }
  } else if (hint === 'no-rounds') {
    title = 'No rounds yet'
    body = 'No funds in this hub have opened a round.'
  }

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>
        {title}
      </div>
      <div style={{ fontSize: '0.82rem', color: C.textMuted, marginBottom: cta ? '0.85rem' : 0 }}>
        {body}
      </div>
      {cta && (
        <Link
          href={cta.href}
          style={{
            display: 'inline-block',
            padding: '0.5rem 0.9rem',
            background: C.accent,
            color: '#fff',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '0.85rem',
            textDecoration: 'none',
          }}
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}
