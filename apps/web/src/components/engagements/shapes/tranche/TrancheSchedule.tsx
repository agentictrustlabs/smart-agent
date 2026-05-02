/**
 * TrancheSchedule — primary surface for Money engagements.
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ $25,000 · 2 of 4 tranches released                          │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ ✓ Tranche 1 — $6,250 · released Jan 4                       │
 *   │ ✓ Tranche 2 — $6,250 · released Apr 4                       │
 *   │ ◯ Tranche 3 — $6,250 · scheduled Jul 4 · ⏳ Q2 report due    │
 *   │ ◯ Tranche 4 — $6,250 · scheduled Oct 4                      │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Per-tranche state machine:
 *   scheduled  → (provider clicks Request report) → report-due
 *   report-due → (holder submits report)          → reported
 *   reported   → (provider clicks Release)        → released
 *
 * The first tranche skips the report-required gate (initial disbursement).
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 Tranche.
 */

import type { TrancheRow, TrancheSummary } from '@/lib/actions/engagements/tranches.action'
import { SubmitReportButton } from './SubmitReportButton'
import { ReleaseTrancheButton, RequestReportButton } from './ReleaseTrancheButton'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  releasedBg: '#dcfce7', releasedFg: '#166534',
  reportDueBg: '#fef3c7', reportDueFg: '#92400e',
  reportedBg: '#dbeafe', reportedFg: '#1d4ed8',
  scheduledBg: '#fafaf6', scheduledFg: '#6b7280',
  heldBg: '#fee2e2', heldFg: '#991b1b',
  currentTint: '#fdf6ed',
}

export function TrancheSchedule({
  summary,
  role,
  engagementId,
  totalGrantDollars,
  validUntil,
  reportPrompt,
  restrictionLabel,
}: {
  summary: TrancheSummary
  role: 'holder' | 'provider' | 'observer'
  engagementId: string
  totalGrantDollars: number
  validUntil: string | null
  reportPrompt: string
  restrictionLabel?: string
}) {
  const dollars = (cents: number) => Math.round(cents / 100)

  return (
    <section style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: '1rem',
    }}>
      {/* Top: total / progress */}
      <div style={{
        background: '#fdfcf8',
        borderBottom: `1px solid ${C.border}`,
        padding: '0.85rem 1.1rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
          Tranche schedule · {summary.releasedCount} of {summary.totalCount} released
        </div>
        <div style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text }}>
          ${dollars(summary.releasedCents).toLocaleString()}
          <span style={{ fontSize: '0.85rem', color: C.textMuted, fontWeight: 600 }}>
            {' '}of ${totalGrantDollars.toLocaleString()} disbursed
          </span>
        </div>
        <div style={{ height: 8, background: '#fafaf6', borderRadius: 999, marginTop: '0.55rem', overflow: 'hidden' }}>
          <div style={{
            width: `${(summary.releasedCents / Math.max(1, summary.totalCents)) * 100}%`,
            height: '100%',
            background: '#10b981',
          }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.72rem', color: C.textMuted, marginTop: '0.45rem' }}>
          {restrictionLabel && (
            <>
              <span style={{ fontWeight: 600 }}>Restriction:</span>
              <span>{restrictionLabel}</span>
            </>
          )}
          {validUntil && (
            <>
              {restrictionLabel && <span>·</span>}
              <span>through {new Date(validUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </>
          )}
        </div>
      </div>

      {/* Tranche rows */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {summary.tranches.map((t, i) => (
          <TrancheRow
            key={t.id}
            tranche={t}
            engagementId={engagementId}
            role={role}
            isCurrent={summary.currentTranche?.id === t.id}
            reportPrompt={reportPrompt}
            isLast={i === summary.tranches.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

function TrancheRow({
  tranche,
  engagementId,
  role,
  isCurrent,
  reportPrompt,
  isLast,
}: {
  tranche: TrancheRow
  engagementId: string
  role: 'holder' | 'provider' | 'observer'
  isCurrent: boolean
  reportPrompt: string
  isLast: boolean
}) {
  const dollars = Math.round(tranche.amountCents / 100)
  const tone = STATE_TONE[tranche.state]
  const isParty = role === 'holder' || role === 'provider'
  const showActions = isParty && tranche.state !== 'released' && tranche.state !== 'held'

  return (
    <div style={{
      padding: '0.8rem 1.1rem',
      background: isCurrent ? C.currentTint : '#fff',
      borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.85rem',
    }}>
      <div style={{
        flexShrink: 0,
        width: 32, height: 32, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: tranche.state === 'released' ? '#10b981' : isCurrent ? C.accent : C.scheduledBg,
        color: tranche.state === 'released' || isCurrent ? '#fff' : C.scheduledFg,
        fontSize: '0.78rem', fontWeight: 700,
        border: tranche.state === 'released' || isCurrent ? 'none' : `1px solid ${C.border}`,
      }}>
        {tranche.state === 'released' ? '✓' : tranche.idx}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text }}>
            Tranche {tranche.idx} — ${dollars.toLocaleString()}
          </span>
          <span style={{
            fontSize: '0.6rem', fontWeight: 700,
            padding: '0.18rem 0.5rem', borderRadius: 999,
            background: tone.bg, color: tone.fg,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {tone.label}
          </span>
        </div>
        <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.2rem' }}>
          {tranche.releasedAt && <>released {fmtDate(tranche.releasedAt)}</>}
          {!tranche.releasedAt && tranche.scheduledFor && <>scheduled {fmtDate(tranche.scheduledFor)}</>}
          {tranche.reportRequired && tranche.idx > 1 && tranche.state !== 'released' && (
            <> · {tranche.state === 'reported' ? '✓ report attached' : 'report required before release'}</>
          )}
        </div>
        {/* Holder side — submit report */}
        {role === 'holder' && tranche.state === 'report-due' && (
          <div style={{ marginTop: '0.6rem' }}>
            <SubmitReportButton
              engagementId={engagementId}
              trancheIdx={tranche.idx}
              prompt={reportPrompt}
            />
          </div>
        )}
        {/* Provider side — request report (only when scheduled), then release */}
        {role === 'provider' && showActions && (
          <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {tranche.idx > 1 && tranche.reportRequired && tranche.state === 'scheduled' && (
              <RequestReportButton engagementId={engagementId} trancheIdx={tranche.idx} />
            )}
            {(tranche.state === 'reported' || tranche.idx === 1 || !tranche.reportRequired) && (
              <ReleaseTrancheButton
                engagementId={engagementId}
                trancheIdx={tranche.idx}
                amountDollars={dollars}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const STATE_TONE: Record<TrancheRow['state'], { bg: string; fg: string; label: string }> = {
  scheduled:    { bg: C.scheduledBg, fg: C.scheduledFg, label: 'Scheduled' },
  'report-due': { bg: C.reportDueBg, fg: C.reportDueFg, label: 'Report due' },
  reported:     { bg: C.reportedBg,  fg: C.reportedFg,  label: 'Report received' },
  released:     { bg: C.releasedBg,  fg: C.releasedFg,  label: 'Released' },
  held:         { bg: C.heldBg,      fg: C.heldFg,      label: 'Held' },
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}
