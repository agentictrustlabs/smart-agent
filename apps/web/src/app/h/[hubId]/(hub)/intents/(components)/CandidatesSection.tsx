/**
 * Spec 001 — Intent Marketplace (Direct Lane). CandidatesSection.
 *
 * Server component that renders the ranked counter-intents for a viewed
 * intent. Each row shows the rank cue ("1 hop · 4 fulfilled / 0 abandoned"
 * or "no prior history yet" for cold-start candidates) and a propose-match
 * button. When a pending MatchInitiation already exists for the pair from
 * this viewer, the row shows "View existing match" instead (FR-019).
 *
 * Skipped by the parent page when the viewed intent is not in
 * expressed/acknowledged status (FR-007 / Story 2 AC#2).
 */

import Link from 'next/link'
import type { CandidateRowForUI } from '@/lib/actions/matchInitiations.action'
import { ProposeMatchButton } from './ProposeMatchButton'

const C = {
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  card: '#ffffff', border: '#ece6db',
  receiveBg: 'rgba(13,148,136,0.06)', receiveFg: '#0f766e', receiveBorder: 'rgba(13,148,136,0.20)',
  giveBg:    'rgba(217,119,6,0.06)',   giveFg:    '#92400e', giveBorder:    'rgba(217,119,6,0.25)',
}

interface CandidatesSectionProps {
  hubSlug: string
  viewedIntentId: string
  candidates: CandidateRowForUI[]
  /**
   * True iff a public-mirror or self-MCP pending initiation already exists
   * on the viewed intent. Disables propose-match across all candidates and
   * surfaces a "view existing match" link.
   */
  hasAnyActiveInitiation?: boolean
  /** Recent propose-match outcome (URL-driven). */
  flash?: { matched?: boolean; error?: string }
}

export function CandidatesSection({
  hubSlug,
  viewedIntentId,
  candidates,
  hasAnyActiveInitiation,
  flash,
}: CandidatesSectionProps) {
  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
        Compatible counter-intents ({candidates.length})
      </h2>

      {flash?.matched && (
        <div style={{ background: '#dcfce7', border: '1px solid #166534', color: '#166534', borderRadius: 8, padding: '0.55rem 0.75rem', fontSize: '0.78rem', marginBottom: '0.6rem' }}>
          Match proposed. Both intents are now <strong>acknowledged</strong>. Next step: commitment.
        </div>
      )}
      {flash?.error && (
        <div style={{ background: '#fee2e2', border: '1px solid #991b1b', color: '#991b1b', borderRadius: 8, padding: '0.55rem 0.75rem', fontSize: '0.78rem', marginBottom: '0.6rem' }}>
          {prettyError(flash.error)}
        </div>
      )}

      {candidates.length === 0 ? (
        <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 10, padding: '1rem', fontSize: '0.85rem', color: C.textMuted, textAlign: 'center' }}>
          No matches yet. When someone expresses a complementary intent in this hub, it will appear here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {candidates.map((c) => (
            <CandidateRow
              key={c.intent.id}
              hubSlug={hubSlug}
              viewedIntentId={viewedIntentId}
              candidate={c}
              disabled={hasAnyActiveInitiation || c.alreadyPaired}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function prettyError(err: string): string {
  const map: Record<string, string> = {
    'stale-candidate': 'That candidate is no longer available — the list has been refreshed.',
    'duplicate-pending': 'A match initiation already exists for this pair.',
    'self-match-excluded': 'You can\'t propose a match between two of your own intents.',
    'visibility-blocked': 'This intent is private and only credentialed agents can propose a match.',
    'validation': 'The proposal failed validation — please try again.',
  }
  return map[err] ?? `Could not propose match: ${err}`
}

interface CandidateRowProps {
  hubSlug: string
  viewedIntentId: string
  candidate: CandidateRowForUI
  disabled: boolean
}

function CandidateRow({ hubSlug, viewedIntentId, candidate, disabled }: CandidateRowProps) {
  const c = candidate.intent
  const isRecv = c.direction === 'receive'
  const dirChip = isRecv
    ? { bg: C.receiveBg, fg: C.receiveFg, border: C.receiveBorder, icon: '📥', label: 'Receive' }
    : { bg: C.giveBg, fg: C.giveFg, border: C.giveBorder, icon: '📤', label: 'Give' }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.7rem 0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999, background: dirChip.bg, color: dirChip.fg, border: `1px solid ${dirChip.border}`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {dirChip.icon} {dirChip.label}
        </span>
        <span style={{ fontSize: '0.6rem', fontWeight: 600, color: C.accent, padding: '0.1rem 0.45rem', borderRadius: 999, background: 'rgba(139,94,60,0.08)', border: `1px solid rgba(139,94,60,0.20)`, letterSpacing: '0.03em' }}>
          {candidate.cue}
        </span>
        {candidate.alreadyPaired && (
          <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#1d4ed8', padding: '0.1rem 0.45rem', borderRadius: 999, background: '#dbeafe', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            paired
          </span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/h/${hubSlug}/intents/${c.id}`} style={{ fontSize: '0.92rem', fontWeight: 700, color: C.text, textDecoration: 'none', display: 'block', marginBottom: '0.15rem' }}>
            {c.title}
          </Link>
          <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
            {c.intentTypeLabel}
            {c.topic && <> · {c.topic}</>}
          </div>
        </div>
        <div>
          {candidate.alreadyPaired ? (
            <Link
              href={`/h/${hubSlug}/intents/${viewedIntentId}`}
              style={{ display: 'inline-block', padding: '0.4rem 0.8rem', background: '#fff', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, fontWeight: 600, fontSize: '0.78rem', textDecoration: 'none' }}
            >
              View existing match
            </Link>
          ) : (
            <ProposeMatchButton
              hubSlug={hubSlug}
              viewedIntentId={viewedIntentId}
              candidateIntentId={c.id}
              basis={candidate.basis}
              disabled={disabled}
            />
          )}
        </div>
      </div>
      {candidate.basis.isColdStart && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.68rem', color: C.textMuted, fontStyle: 'italic' }}>
          Cold-start ranking — outcome history will refine this once activities are validated.
        </div>
      )}
    </div>
  )
}
