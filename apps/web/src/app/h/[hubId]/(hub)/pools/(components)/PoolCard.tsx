/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pool card (US1 + US4).
 *
 * Server component. Renders one pool in the index list:
 *   - Headline (name + domain badge)
 *   - Mandate snippet
 *   - Capacity widgets (pledged / available / ceiling)
 *   - Soft warnings (capacity-near-ceiling, capacity-reached)
 *   - Rank cue (proximity + outcome) per FR-016
 */

import Link from 'next/link'
import type { PoolListItem, RankBasis } from '@smart-agent/sdk'
import { rankCue } from '@smart-agent/sdk'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  warnBg: 'rgba(217,119,6,0.08)',
  warnFg: '#92400e',
  warnBorder: 'rgba(217,119,6,0.30)',
  privateFg: '#991b1b',
  matchBg: 'rgba(13,148,136,0.08)',
  matchFg: '#0f766e',
}

function formatAmount(n: number, unit = 'USD'): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (unit === 'USD') {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
    return `$${n}`
  }
  return `${n} ${unit}`
}

export function PoolCard({
  pool,
  hubSlug,
}: {
  pool: PoolListItem
  hubSlug: string
}) {
  const primaryUnit = pool.acceptedUnits[0] ?? 'USD'
  // Encode the pool id so URN-style ids round-trip cleanly.
  const safeId = encodeURIComponent(pool.id)
  const ratio = pool.capacityCeiling && pool.capacityCeiling > 0
    ? Math.min(1, pool.pledgedTotal / pool.capacityCeiling)
    : 0

  return (
    <Link
      href={`/h/${hubSlug}/pools/${safeId}`}
      style={{
        display: 'block',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.85rem 1rem',
        textDecoration: 'none',
        color: C.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          padding: '0.18rem 0.55rem',
          borderRadius: 999,
          background: C.matchBg,
          color: C.matchFg,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {pool.domain || 'pool'}
        </span>
        <span style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          padding: '0.18rem 0.55rem',
          borderRadius: 999,
          background: '#fafaf6',
          color: C.textMuted,
          border: `1px solid ${C.border}`,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {pool.governanceModel}
        </span>
        {pool.warnings.includes('capacity-near-ceiling') && (
          <span style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            padding: '0.15rem 0.5rem',
            borderRadius: 999,
            background: C.warnBg,
            color: C.warnFg,
            border: `1px solid ${C.warnBorder}`,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            Near ceiling
          </span>
        )}
        {pool.warnings.includes('capacity-reached') && (
          <span style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            padding: '0.15rem 0.5rem',
            borderRadius: 999,
            background: '#f3f4f6',
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            Ceiling reached
          </span>
        )}
        {pool.visibility === 'private' && (
          <span style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            color: C.privateFg,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            Private
          </span>
        )}
      </div>

      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text, marginBottom: '0.2rem' }}>
        {pool.name || 'Unnamed pool'}
      </div>

      {pool.mandate && (
        <div style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.5rem' }}>
          {pool.mandate.length > 160 ? pool.mandate.slice(0, 157) + '…' : pool.mandate}
        </div>
      )}

      {pool.basis ? <RankCueRow basis={pool.basis as RankBasis} /> : null}

      <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
        <span style={{ color: C.text }}>
          <strong style={{ color: C.accent, fontWeight: 700 }}>Pledged:</strong> {formatAmount(pool.pledgedTotal, primaryUnit)}
        </span>
        {pool.capacityCeiling && pool.capacityCeiling > 0 ? (
          <span style={{ color: C.text }}>
            <strong style={{ color: C.accent, fontWeight: 700 }}>Ceiling:</strong> {formatAmount(pool.capacityCeiling, primaryUnit)} ({Math.round(ratio * 100)}%)
          </span>
        ) : null}
        <span style={{ color: C.text }}>
          <strong style={{ color: C.accent, fontWeight: 700 }}>Available:</strong> {formatAmount(pool.availableTotal, primaryUnit)}
        </span>
        {pool.acceptedUnits.length > 0 && (
          <span style={{ color: C.textMuted }}>
            Units: {pool.acceptedUnits.slice(0, 3).join(', ')}
          </span>
        )}
      </div>
    </Link>
  )
}

function RankCueRow({ basis }: { basis: RankBasis }) {
  const cueText = rankCue(basis)
  return (
    <details style={{ marginBottom: '0.4rem' }}>
      <summary style={{
        listStyle: 'none',
        cursor: 'pointer',
        fontSize: '0.7rem',
        color: C.textMuted,
        display: 'inline-flex',
        gap: '0.35rem',
        alignItems: 'center',
      }}>
        <span style={{ color: C.accent, fontWeight: 600 }}>Why rank:</span>
        <span>{cueText}</span>
      </summary>
      <div style={{ marginTop: '0.3rem', fontSize: '0.7rem', color: C.text, paddingLeft: '0.5rem' }}>
        <div>
          <strong style={{ color: C.accent }}>Proximity:</strong> {basis.proximityHops} hop{basis.proximityHops === 1 ? '' : 's'}
          <span style={{ color: C.textMuted }}> · score {basis.proximityScore.toFixed(2)}</span>
        </div>
        <div>
          <strong style={{ color: C.accent }}>Outcomes:</strong>{' '}
          {basis.isColdStart
            ? 'no prior history yet'
            : `${basis.priorOutcomes.fulfilled} fulfilled / ${basis.priorOutcomes.abandoned} abandoned`}
          <span style={{ color: C.textMuted }}> · score {basis.outcomeScore.toFixed(2)}</span>
        </div>
        <div>
          <strong style={{ color: C.accent }}>Composite:</strong> {basis.composite.toFixed(3)}
          <span style={{ color: C.textMuted }}> · 0.6 × proximity + 0.4 × outcome</span>
        </div>
      </div>
    </details>
  )
}
