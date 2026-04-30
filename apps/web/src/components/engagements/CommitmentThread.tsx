/**
 * CommitmentThread — the persistent typed backbone of an engagement.
 *
 * Renders every stage's typed entry: intent_ref, match_accept, contract_term,
 * work_item, activity, message, evidence_pin, witness_sig, confirmation,
 * trust_deposit. Reading this top-to-bottom is the audit story of the
 * engagement.
 *
 * This is a server component; the entries are fetched in the page and
 * passed in. Two-way message composer is a client island (R4).
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §5
 */

import Link from 'next/link'
import type { ThreadEntryRow, ThreadEntryKind } from '@/lib/actions/engagements/thread.action'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  rule: '#ece6db',
  // Per-stage tints — light, restrained, distinguishable.
  stage: {
    1: { bg: '#f5f3ff', fg: '#6d28d9', label: '1 · Marketplace' },
    2: { bg: '#eff6ff', fg: '#1d4ed8', label: '2 · Match' },
    3: { bg: '#fdf4ff', fg: '#a21caf', label: '3 · Contract' },
    4: { bg: '#fffbeb', fg: '#92400e', label: '4 · Workflow' },
    5: { bg: '#ecfdf5', fg: '#065f46', label: '5 · Activities' },
    6: { bg: '#fff7ed', fg: '#9a3412', label: '6 · Provenance' },
    7: { bg: '#fef2f2', fg: '#991b1b', label: '7 · Validation' },
    8: { bg: '#fafaf6', fg: '#5c4a3a', label: '8 · Trust deposit' },
  } as const,
}

const KIND_TO_STAGE: Record<ThreadEntryKind, keyof typeof C.stage> = {
  intent_ref:    1,
  match_accept:  2,
  contract_term: 3,
  work_item:     4,
  activity:      5,
  message:       5,  // human messages flow alongside the activity stream
  evidence_pin:  6,
  witness_sig:   6,
  confirmation:  7,
  trust_deposit: 8,
}

const ACTIVITY_ICON: Record<string, string> = {
  meeting: '🤝', visit: '🏠', training: '📖', outreach: '🚶',
  coaching: '🎯', 'follow-up': '📞', prayer: '🙏', service: '❤️',
  assessment: '📊', other: '📝',
}

export function CommitmentThread({
  entries,
  agentNameByAddress,
  hubSlug,
}: {
  entries: ThreadEntryRow[]
  agentNameByAddress: Record<string, string>
  hubSlug: string
}) {
  if (entries.length === 0) {
    return (
      <div style={{ fontSize: '0.82rem', color: C.textMuted, padding: '0.8rem 1rem', background: C.card, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
        Commitment thread is empty.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {entries.map(entry => (
        <ThreadRow
          key={entry.id}
          entry={entry}
          agentNameByAddress={agentNameByAddress}
          hubSlug={hubSlug}
        />
      ))}
    </div>
  )
}

function ThreadRow({
  entry,
  agentNameByAddress,
  hubSlug,
}: {
  entry: ThreadEntryRow
  agentNameByAddress: Record<string, string>
  hubSlug: string
}) {
  const stage = C.stage[KIND_TO_STAGE[entry.kind]]
  const fromName = entry.fromAgent
    ? (agentNameByAddress[entry.fromAgent.toLowerCase()] ?? shortAddr(entry.fromAgent))
    : 'system'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.6rem',
      padding: '0.65rem 0.85rem',
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
    }}>
      <div style={{ flexShrink: 0 }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 700,
          padding: '0.18rem 0.5rem', borderRadius: 999,
          background: stage.bg, color: stage.fg,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          whiteSpace: 'nowrap',
        }}>
          {stage.label}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <ThreadBody entry={entry} hubSlug={hubSlug} fromName={fromName} />
      </div>
      <div style={{ flexShrink: 0, fontSize: '0.7rem', color: C.textMuted, whiteSpace: 'nowrap' }}>
        {fmtTime(entry.createdAt)}
      </div>
    </div>
  )
}

function ThreadBody({
  entry,
  hubSlug,
  fromName,
}: {
  entry: ThreadEntryRow
  hubSlug: string
  fromName: string
}) {
  // Type-narrowed body access via cast — server-trusted rendering.
  const body = entry.body as Record<string, unknown>

  switch (entry.kind) {
    case 'intent_ref': {
      const side = body.side as 'holder' | 'provider'
      const intentId = body.intentId as string
      const title = body.title as string
      const outcome = (body.outcome as string | null) ?? null
      return (
        <>
          <div style={{ fontSize: '0.85rem', color: C.text }}>
            <strong>{side === 'holder' ? 'Holder' : 'Provider'}</strong> intent: <Link href={`/h/${hubSlug}/intents/${intentId}`} style={{ color: C.accent }}>{title}</Link>
          </div>
          {outcome && (
            <div style={{ fontSize: '0.75rem', color: C.textMuted, marginTop: '0.15rem' }}>
              Their outcome: {outcome}
            </div>
          )}
        </>
      )
    }
    case 'match_accept': {
      const score = body.score as number
      const satisfies = (body.satisfies as string[]) ?? []
      const misses = (body.misses as string[]) ?? []
      return (
        <>
          <div style={{ fontSize: '0.85rem', color: C.text }}>
            Match accepted at <strong>{score}%</strong>
          </div>
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
            {satisfies.length > 0 && <>satisfies: {satisfies.join(', ')}</>}
            {satisfies.length > 0 && misses.length > 0 && ' · '}
            {misses.length > 0 && <>misses: {misses.join(', ')}</>}
          </div>
        </>
      )
    }
    case 'contract_term': {
      const cadence = body.cadence as string
      const validUntil = body.validUntil as string | null
      const granted = body.capacityGranted as number
      const unit = (body.capacityUnit as string).split(':').pop()
      return (
        <>
          <div style={{ fontSize: '0.85rem', color: C.text }}>
            Contract terms set: <strong>{granted} {unit}</strong> on a <strong>{cadence}</strong> cadence
          </div>
          {validUntil && (
            <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
              valid through {fmtDate(validUntil)}
            </div>
          )}
        </>
      )
    }
    case 'work_item': {
      const title = body.title as string
      const taskKind = body.taskKind as string
      return (
        <>
          <div style={{ fontSize: '0.85rem', color: C.text }}>
            <strong>{taskKind.split(':').pop()}</strong> · {title}
          </div>
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
            assigned to {fromName}
          </div>
        </>
      )
    }
    case 'activity': {
      const title = body.title as string
      const activityType = body.activityType as string
      const consumed = body.capacityConsumed as number | null
      const icon = ACTIVITY_ICON[activityType] ?? '📝'
      return (
        <>
          <div style={{ fontSize: '0.85rem', color: C.text }}>
            <span style={{ marginRight: '0.35rem' }}>{icon}</span>
            <strong>{fromName}</strong> logged: {title}
          </div>
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem', textTransform: 'capitalize' }}>
            {activityType}{consumed ? ` · consumed ${consumed}` : ''}
          </div>
        </>
      )
    }
    case 'message': {
      const text = body.text as string
      return (
        <>
          <div style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.15rem' }}>
            <strong style={{ color: C.text }}>{fromName}</strong>
          </div>
          <div style={{ fontSize: '0.85rem', color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
            {text}
          </div>
          {entry.attachmentUri && (
            <a href={entry.attachmentUri} style={{ fontSize: '0.72rem', color: C.accent, marginTop: '0.2rem', display: 'inline-block' }}>
              ↗ attachment
            </a>
          )}
        </>
      )
    }
    case 'evidence_pin': {
      const activityIds = (body.activityIds as string[]) ?? []
      const attachments = (body.attachments as { uri: string; description?: string }[]) ?? []
      return (
        <>
          <div style={{ fontSize: '0.85rem', color: C.text }}>
            <strong>{fromName}</strong> pinned the evidence bundle
          </div>
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
            {activityIds.length} activit{activityIds.length === 1 ? 'y' : 'ies'} · {attachments.length} attachment{attachments.length === 1 ? '' : 's'}
            {entry.hashAnchor && <> · hash <code style={{ fontSize: '0.7rem' }}>{entry.hashAnchor.slice(0, 12)}…</code></>}
          </div>
        </>
      )
    }
    case 'witness_sig': {
      return (
        <>
          <div style={{ fontSize: '0.85rem', color: C.text }}>
            Witness signature from <strong>{fromName}</strong>
          </div>
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
            signed at {fmtTime((body.signedAt as string) ?? entry.createdAt)}
          </div>
        </>
      )
    }
    case 'confirmation': {
      const side = body.side as 'holder' | 'provider'
      return (
        <div style={{ fontSize: '0.85rem', color: C.text }}>
          <strong>{fromName}</strong> ({side}) confirmed the outcome
        </div>
      )
    }
    case 'trust_deposit': {
      const reviewIds = (body.reviewIds as string[]) ?? []
      const skillClaimIds = (body.skillClaimIds as string[]) ?? []
      return (
        <>
          <div style={{ fontSize: '0.85rem', color: C.text }}>
            🏛️ Trust deposit minted
          </div>
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
            {reviewIds.length} review{reviewIds.length === 1 ? '' : 's'} · {skillClaimIds.length} skill claim{skillClaimIds.length === 1 ? '' : 's'}
            {entry.hashAnchor && <> · tx <code style={{ fontSize: '0.7rem' }}>{entry.hashAnchor.slice(0, 12)}…</code></>}
          </div>
        </>
      )
    }
  }
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return iso }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}
