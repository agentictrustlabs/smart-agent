/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Prior stats block (T035).
 *
 * Server component. Renders the prior-cycle stats on the round detail
 * page (Story 2 AC#3 — explicit empty state on first-cycle rounds).
 *
 * Fields:
 *   - proposalsReceived (prior cycle)
 *   - awarded (prior cycle)
 *   - medianAward (prior cycle)
 *   - isFirstCycle — when true, render "first cycle — no prior data"
 *
 * Data is populated by the downstream award spec; v1 returns empty
 * stats (`isFirstCycle: true` + zeroes) which renders the empty state.
 */

import type { RoundPriorStats } from '@smart-agent/sdk'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
}

function formatBudget(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n}`
}

export function PriorStatsBlock({ stats }: { stats: RoundPriorStats }) {
  const empty = stats.isFirstCycle || (stats.proposalsReceived === 0 && stats.awarded === 0)

  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.95rem 1rem',
        marginBottom: '0.85rem',
      }}
    >
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem' }}>
        Prior cycle
      </h2>

      {empty ? (
        <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>
          First cycle — no prior data yet.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <Stat label="Proposals received" value={String(stats.proposalsReceived)} />
          <Stat label="Awarded" value={`${stats.awarded} of ${stats.proposalsReceived}`} />
          {stats.medianAward !== undefined && (
            <Stat label="Median award" value={formatBudget(stats.medianAward)} />
          )}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text }}>
        {value}
      </div>
    </div>
  )
}
