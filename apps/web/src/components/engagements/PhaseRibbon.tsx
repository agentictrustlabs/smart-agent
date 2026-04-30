/**
 * PhaseRibbon — 8-stop linear stepper covering the full engagement round trip.
 *
 *   1. Marketplace ▸ 2. Match ▸ 3. Contract ▸ 4. Workflow ▸
 *   5. Activities ▸ 6. Provenance ▸ 7. Validation ▸ 8. Trust Update
 *
 * Each stop is "completed", "active", or "upcoming" based on engagement
 * timestamps. Stops 1-2 are pre-engagement and always render as completed
 * (the engagement only exists because Marketplace + Match already happened).
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §3.2
 */

import type { EntitlementRow } from '@/lib/actions/entitlements.action'

const C = {
  doneBg: '#10b981', doneFg: '#ffffff',
  activeBg: '#8b5e3c', activeFg: '#ffffff',
  upcomingBg: '#fafaf6', upcomingFg: '#9a8c7e', upcomingBorder: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e',
  rule: '#ece6db', ruleDone: '#10b981',
}

// Plain-language labels — the underlying eight-stage round trip is the same,
// but end users shouldn't have to learn audit vocabulary to read it.
const STOPS: { key: string; label: string; sublabel: string }[] = [
  { key: 'marketplace', label: 'Asked',       sublabel: 'Intent expressed' },
  { key: 'match',       label: 'Matched',     sublabel: 'Found a fit' },
  { key: 'contract',    label: 'Agreed',      sublabel: 'Commitment made' },
  { key: 'workflow',    label: 'Planned',     sublabel: 'First step set' },
  { key: 'activities',  label: 'Working',     sublabel: 'Doing the thing' },
  { key: 'provenance',  label: 'Wrap up',     sublabel: 'Pin what counted' },
  { key: 'validation',  label: 'Confirmed',   sublabel: 'Both signed off' },
  { key: 'trust',       label: 'Closed',      sublabel: 'Trust banked' },
] as const

export interface PhaseDerivation {
  doneIdx: number   // last completed stop (0-based; -1 means none)
  activeIdx: number // current active stop (0-based)
}

/**
 * Derive which 8-stop position the engagement is in from its row.
 *
 * Stops 1-2 (Marketplace, Match) are always completed because the
 * engagement exists. The active stop is the first not-yet-completed.
 */
export function derivePhase(ent: {
  status: EntitlementRow['status']
  phase: EntitlementRow['phase']
  capacityRemaining: number
  capacityGranted: number
  holderConfirmedAt: string | null
  providerConfirmedAt: string | null
  evidencePinnedAt: string | null
  assertionId: string | null
  hasWorkItems: boolean
  hasActivities: boolean
}): PhaseDerivation {
  // Terminal short-circuits.
  if (ent.assertionId) return { doneIdx: 7, activeIdx: 7 }
  if (ent.holderConfirmedAt && ent.providerConfirmedAt) return { doneIdx: 6, activeIdx: 7 }
  if (ent.evidencePinnedAt) return { doneIdx: 5, activeIdx: 6 }
  if (ent.hasActivities) return { doneIdx: 4, activeIdx: 5 }
  if (ent.hasWorkItems) return { doneIdx: 3, activeIdx: 4 }
  // Engagement exists → through stop 3 (Contract).
  return { doneIdx: 2, activeIdx: 3 }
}

export function PhaseRibbon({
  derivation,
}: {
  derivation: PhaseDerivation
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 0,
      padding: '0.85rem 1rem',
      background: '#ffffff',
      border: `1px solid ${C.rule}`,
      borderRadius: 12,
      marginBottom: '1rem',
      overflowX: 'auto',
    }}>
      {STOPS.map((stop, i) => {
        const isDone = i <= derivation.doneIdx
        const isActive = i === derivation.activeIdx && !isDone
        const showRule = i < STOPS.length - 1
        const ruleDone = i < derivation.doneIdx
        return (
          <div key={stop.key} style={{
            display: 'flex',
            alignItems: 'flex-start',
            flex: 1,
            minWidth: 0,
            position: 'relative',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, minWidth: 60 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: isDone ? C.doneBg : isActive ? C.activeBg : C.upcomingBg,
                color: isDone ? C.doneFg : isActive ? C.activeFg : C.upcomingFg,
                border: isDone || isActive ? 'none' : `1px solid ${C.upcomingBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 700,
                marginBottom: '0.35rem',
              }}>
                {isDone ? '✓' : i + 1}
              </div>
              <div style={{
                fontSize: '0.68rem', fontWeight: 700,
                color: isActive ? C.text : isDone ? C.text : C.textMuted,
                textAlign: 'center', whiteSpace: 'nowrap',
              }}>
                {stop.label}
              </div>
              <div style={{
                fontSize: '0.6rem', color: C.textMuted,
                textAlign: 'center', whiteSpace: 'nowrap',
              }}>
                {stop.sublabel}
              </div>
            </div>
            {showRule && (
              <div style={{
                flex: 1,
                height: 2,
                background: ruleDone ? C.ruleDone : C.rule,
                marginTop: 14,
                marginLeft: 4, marginRight: 4,
                borderRadius: 1,
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}
