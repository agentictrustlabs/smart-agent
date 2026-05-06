/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pools index empty-state (FR-004).
 *
 * Server component. Friendly empty surface for the pools index when no
 * pools match the current filters.
 */

import Link from 'next/link'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
}

export function EmptyState({
  hubSlug,
  hasFilters,
}: {
  hubSlug: string
  hasFilters: boolean
}) {
  const title = hasFilters ? 'No pools match these filters' : 'No open pools yet'
  const body = hasFilters
    ? 'Try widening your filters — different domain, governance model, or geo.'
    : 'Pools accepting pledges in this hub will appear here once they are seeded.'
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: '1.5rem 1.25rem',
      textAlign: 'center',
    }}>
      <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>{title}</h2>
      <p style={{ fontSize: '0.85rem', color: C.textMuted, marginBottom: '0.85rem' }}>{body}</p>
      {hasFilters && (
        <Link
          href={`/h/${hubSlug}/pools`}
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
          Clear filters
        </Link>
      )}
    </div>
  )
}
