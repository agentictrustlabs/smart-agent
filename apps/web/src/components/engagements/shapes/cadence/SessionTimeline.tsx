/**
 * SessionTimeline — primary surface for Cadence-shape engagements.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Next session — Tuesday Apr 14 at 2:00pm                      │
 *   │ [Schedule next]   [Log this week's session]                  │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Past sessions (8 of 26)                                      │
 *   │   ✓ Apr 8 — "Sofia explored Berthoud G2 candidates"          │
 *   │   ✓ Apr 1 — "First coaching call — set 6-month goals"        │
 *   │   ...                                                         │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The 8-stop ribbon, Commitment Thread, evidence pin, and Determination
 * panel live behind disclosures further down the page. This is what users
 * came here to see.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 Cadence
 */

import type { SessionRow, SessionTimelineView } from '@/lib/actions/engagements/sessions.action'
import { LogSessionButton } from './LogSessionButton'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  heroBg: '#fdf6ed', heroBorder: '#e9b87a',
  doneBg: '#fafaf6',
  upcomingBg: '#eff6ff', upcomingFg: '#1d4ed8',
}

export function SessionTimeline({
  view,
  engagementId,
  orgAddress,
  isParty,
  topic,
  counterpartyName,
  capacityRemaining,
  capacityGranted,
  cadenceLabel,
  sessionNoun = 'session',
  sessionVerb = 'Schedule next',
  hideNotes = false,
}: {
  view: SessionTimelineView
  engagementId: string
  orgAddress: string | null
  isParty: boolean
  topic: string
  counterpartyName: string
  capacityRemaining: number
  capacityGranted: number
  cadenceLabel: string
  /** "session" | "prayer time" | "care visit" — set by subtype. */
  sessionNoun?: string
  /** "Schedule next" | "Commit to next prayer time" — set by subtype. */
  sessionVerb?: string
  /** Hide notes field for sensitive engagements (Rosa-style). */
  hideNotes?: boolean
}) {
  const next = view.upcoming[0] ?? null
  const lastOccurred = view.past[0] ?? null

  return (
    <section
      id="log-activity"
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: '0 0 0.4rem',
        marginBottom: '1rem',
        overflow: 'hidden',
        scrollMarginTop: '1rem',
      }}>
      {/* Hero: next session */}
      <div style={{
        background: C.heroBg,
        borderBottom: `1px solid ${C.heroBorder}`,
        padding: '1rem 1.2rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>
          {sessionNoun === 'session' ? 'Next session' : `Next ${sessionNoun}`}
        </div>
        {next ? (
          <>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text }}>
              {fmtDateTime(next.scheduledFor)} with {counterpartyName}
            </div>
            {next.notes && !hideNotes && (
              <div style={{ fontSize: '0.78rem', color: C.textMuted, marginTop: '0.25rem' }}>{next.notes}</div>
            )}
          </>
        ) : (
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text }}>
            Not scheduled yet — pick a time, or log {sessionNoun === 'session' ? 'one' : 'one'} that just happened.
          </div>
        )}

        {isParty && orgAddress && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
            <LogSessionButton
              engagementId={engagementId}
              orgAddress={orgAddress}
              hideNotes={hideNotes}
              sessionNoun={sessionNoun}
              activityTitleHint={`${sessionNoun.charAt(0).toUpperCase() + sessionNoun.slice(1)} on ${topic}`}
              variant="primary"
            />
            {/* Schedule-next button could go here in a future R-phase. For v0,
                Maria/Sofia coordinate via the Commitment Thread message composer
                (which lives below the disclosures). */}
            <span style={{ fontSize: '0.7rem', color: C.textMuted, alignSelf: 'center' }}>
              ({sessionVerb} via thread message · upcoming inline scheduler)
            </span>
          </div>
        )}
      </div>

      {/* Capacity inline chip */}
      <div style={{ padding: '0.55rem 1.2rem', borderBottom: `1px solid ${C.border}`, background: '#fafaf6' }}>
        <span style={{ fontSize: '0.75rem', color: C.textMuted }}>
          <strong style={{ color: C.text }}>{capacityRemaining}</strong> of {capacityGranted} {sessionNoun === 'prayer time' ? 'prayer slots' : `${sessionNoun}s`} remaining · {cadenceLabel}
          {lastOccurred && (
            <> · last {sessionNoun} {fmtRelative(lastOccurred.occurredAt!)}</>
          )}
        </span>
      </div>

      {/* Past sessions */}
      <div style={{ padding: '0.6rem 1.2rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
          Past {sessionNoun === 'session' ? 'sessions' : `${sessionNoun}s`} ({view.totalOccurred})
        </div>
        {view.past.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: C.textMuted, fontStyle: 'italic' }}>
            None yet — log your first to start the rhythm.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {view.past.slice(0, 8).map(s => <SessionRow key={s.id} session={s} hideNotes={hideNotes} />)}
            {view.past.length > 8 && (
              <details style={{ marginTop: '0.4rem' }}>
                <summary style={{ fontSize: '0.72rem', color: C.textMuted, cursor: 'pointer' }}>
                  + {view.past.length - 8} earlier {sessionNoun === 'session' ? 'sessions' : `${sessionNoun}s`}
                </summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.4rem' }}>
                  {view.past.slice(8).map(s => <SessionRow key={s.id} session={s} hideNotes={hideNotes} />)}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function SessionRow({ session, hideNotes }: { session: SessionRow; hideNotes?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.55rem',
      padding: '0.45rem 0.7rem',
      background: C.doneBg,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
    }}>
      <span style={{ fontSize: '0.72rem' }}>✓</span>
      <span style={{ fontSize: '0.78rem', color: C.text, fontWeight: 600 }}>
        {fmtDate(session.occurredAt!)}
      </span>
      {session.notes && !hideNotes && (
        <span style={{ fontSize: '0.78rem', color: C.textMuted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          — {session.notes}
        </span>
      )}
      {hideNotes && (
        <span style={{ fontSize: '0.7rem', color: C.textMuted, fontStyle: 'italic' }}>
          (notes private)
        </span>
      )}
    </div>
  )
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return iso }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return 'TBD'
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return iso }
}

function fmtRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime()
    const days = Math.floor(ms / 86_400_000)
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    return fmtDate(iso)
  } catch { return iso }
}
