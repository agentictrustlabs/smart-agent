/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Round card (T030).
 *
 * Server component. Renders one round in the index list:
 *   - Headline (mandate text — narrative + accepted kinds)
 *   - Key metadata (deadline relative + absolute, budget ceiling,
 *     expected awards, fund display name)
 *   - Mandate-match badge (FR-001 / Research R2):
 *       "✓ matches your <kind> intent · deadline 14d · budget ceiling $250k"
 *     when `matchedIntentIds.length > 0`.
 *   - Soft warnings (FR-001):
 *       - `budget-below-intent` — fund's ceiling is below the viewer's
 *         stated need (proposers may want to ask elsewhere)
 *       - `deadline-imminent` — deadline within 3 days
 *   - Click-through link to `[roundId]/page.tsx`.
 *
 * Visual baseline matches the intents/intents-page card pattern (light
 * corporate palette per memory `feedback_light_mode`).
 */

import Link from 'next/link'
import type { RoundListItem, RankBasis } from '@smart-agent/sdk'
import { rankCue } from '@smart-agent/sdk'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  matchBg: 'rgba(13,148,136,0.08)',
  matchFg: '#0f766e',
  matchBorder: 'rgba(13,148,136,0.25)',
  warnBg: 'rgba(217,119,6,0.08)',
  warnFg: '#92400e',
  warnBorder: 'rgba(217,119,6,0.30)',
  privateFg: '#991b1b',
}

function formatDeadline(iso: string): { rel: string; abs: string; daysLeft: number | null } {
  if (!iso) return { rel: '—', abs: '', daysLeft: null }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { rel: '—', abs: iso, daysLeft: null }
  const now = Date.now()
  const ms = d.getTime() - now
  const days = Math.round(ms / (1000 * 60 * 60 * 24))
  const abs = d.toISOString().slice(0, 10)
  if (ms < 0) return { rel: 'closed', abs, daysLeft: days }
  if (days === 0) return { rel: 'closes today', abs, daysLeft: 0 }
  if (days === 1) return { rel: 'closes tomorrow', abs, daysLeft: 1 }
  if (days < 14) return { rel: `${days}d left`, abs, daysLeft: days }
  if (days < 60) return { rel: `${days}d left`, abs, daysLeft: days }
  return { rel: abs, abs, daysLeft: days }
}

function formatBudget(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n}`
}

export function RoundCard({
  round,
  hubSlug,
}: {
  round: RoundListItem
  hubSlug: string
}) {
  const dl = formatDeadline(round.deadline)
  const matched = round.matchedIntentIds.length > 0
  const isClosed = dl.daysLeft !== null && dl.daysLeft < 0
  const fundLabel = round.fundAgentId
    ? `${round.fundAgentId.slice(0, 6)}…${round.fundAgentId.slice(-4)}`
    : 'Unknown fund'

  const mandateNarrative = (round.mandate.acceptedKinds ?? []).slice(0, 3).join(', ') || 'Open mandate'

  return (
    <Link
      href={`/h/${hubSlug}/rounds/${round.id}`}
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
        {matched && (
          <span style={{
            fontSize: '0.62rem',
            fontWeight: 700,
            padding: '0.18rem 0.55rem',
            borderRadius: 999,
            background: C.matchBg,
            color: C.matchFg,
            border: `1px solid ${C.matchBorder}`,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            ✓ Matches your {(round.mandate.acceptedKinds[0] ?? 'intent').replace(/^.*:/, '')}
          </span>
        )}
        {round.warnings.includes('deadline-imminent') && (
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
            Deadline soon
          </span>
        )}
        {round.warnings.includes('budget-below-intent') && (
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
            Budget below your need
          </span>
        )}
        {round.visibility === 'private' && (
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
        {isClosed && (
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
            Closed
          </span>
        )}
      </div>

      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text, marginBottom: '0.2rem' }}>
        {mandateNarrative}
      </div>

      <div style={{ fontSize: '0.72rem', color: C.textMuted, marginBottom: '0.4rem' }}>
        {fundLabel}
        {round.mandate.acceptedGeo?.length > 0 && <> · {round.mandate.acceptedGeo.slice(0, 2).join(', ')}</>}
      </div>

      {round.basis ? <RankCueRow basis={round.basis as RankBasis} domainMatch={round.domainMatch ?? false} /> : null}

      <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
        <span style={{ color: C.text }}>
          <strong style={{ color: C.accent, fontWeight: 700 }}>Deadline:</strong> {dl.rel}
        </span>
        <span style={{ color: C.text }}>
          <strong style={{ color: C.accent, fontWeight: 700 }}>Ceiling:</strong> {formatBudget(round.mandate.budgetCeiling)}
        </span>
        {round.mandate.expectedAwards > 0 && (
          <span style={{ color: C.text }}>
            <strong style={{ color: C.accent, fontWeight: 700 }}>Awards:</strong> {round.mandate.expectedAwards}
          </span>
        )}
        {round.proposalsReceived > 0 && (
          <span style={{ color: C.textMuted }}>
            {round.proposalsReceived} submitted
          </span>
        )}
      </div>
    </Link>
  )
}

/**
 * One-line rank cue with an expand affordance — FR-018. The `<details>` is
 * a native HTML element so it works without a `'use client'` boundary
 * (server-rendered, opens with native browser interactivity).
 */
function RankCueRow({ basis, domainMatch }: { basis: RankBasis; domainMatch: boolean }) {
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
        {!domainMatch && !basis.isColdStart && (
          <span style={{ fontSize: '0.62rem', color: C.textMuted, fontStyle: 'italic' }}>
            (fund-wide)
          </span>
        )}
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
