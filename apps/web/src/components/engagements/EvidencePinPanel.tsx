'use client'

/**
 * EvidencePinPanel — Stage 6 Provenance Capture.
 *
 * Pick activities + (optional) attachments, optionally name a witness,
 * pin the bundle. After pinning, the bundle is hashed and frozen — only
 * the pinned set counts toward the trust deposit.
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §5.1, §3.2 stop 6
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { pinEvidence, attachWitnessSignature, setWitnessAgent } from '@/lib/actions/engagements/evidence.action'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  pinBg: '#fff7ed', pinBorder: '#fed7aa', pinFg: '#9a3412',
  doneBg: '#dcfce7', doneFg: '#166534',
}

export interface EvidencePinPanelProps {
  engagementId: string
  /** Activities logged against this engagement, oldest first. */
  activities: Array<{ id: string; title: string; activityType: string; activityDate: string }>
  /** Already-pinned bundle hash, if any. */
  pinnedBundleHash: string | null
  pinnedAt: string | null
  /** Witness state. */
  witnessAgent: string | null
  witnessSignedAt: string | null
  /** Whether this user is a party (provider or holder). */
  isParty: boolean
  /** Whether this user is the witness. */
  isWitness: boolean
}

export function EvidencePinPanel({
  engagementId,
  activities,
  pinnedBundleHash,
  pinnedAt,
  witnessAgent,
  witnessSignedAt,
  isParty,
  isWitness,
}: EvidencePinPanelProps) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  // Pre-select all activities by default.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(activities.map(a => a.id)),
  )
  const [attachmentUri, setAttachmentUri] = useState('')
  const [attachmentDesc, setAttachmentDesc] = useState('')
  const [pendingWitness, setPendingWitness] = useState(witnessAgent ?? '')

  const allChecked = activities.length > 0 && selectedIds.size === activities.length
  const someChecked = selectedIds.size > 0

  // ── Already pinned: show summary card ────────────────────────────
  if (pinnedBundleHash) {
    return (
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.85rem 1rem',
        marginBottom: '1rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.pinFg, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
          📌 Evidence pinned
        </div>
        <div style={{ fontSize: '0.85rem', color: C.text, marginBottom: '0.3rem' }}>
          Bundle hash <code style={{ fontSize: '0.78rem' }}>{pinnedBundleHash.slice(0, 18)}…</code>
        </div>
        <div style={{ fontSize: '0.72rem', color: C.textMuted, marginBottom: '0.5rem' }}>
          Pinned {pinnedAt ? new Date(pinnedAt).toLocaleString() : ''}
        </div>

        <WitnessRow
          witnessAgent={witnessAgent}
          witnessSignedAt={witnessSignedAt}
          isWitness={isWitness}
          engagementId={engagementId}
          pending={pending}
          start={start}
          setErr={setErr}
          router={router}
        />
        {err && <div style={{ marginTop: '0.45rem', fontSize: '0.75rem', color: '#991b1b' }}>{err}</div>}
      </div>
    )
  }

  // ── Not yet pinned: composer ─────────────────────────────────────
  if (!isParty) return null

  function toggle(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(allChecked ? new Set() : new Set(activities.map(a => a.id)))
  }

  function submit() {
    if (!someChecked) {
      setErr('Pick at least one activity to pin.')
      return
    }
    setErr(null)
    const attachments = attachmentUri.trim()
      ? [{ uri: attachmentUri.trim(), description: attachmentDesc.trim() || undefined }]
      : []
    start(async () => {
      const r = await pinEvidence({
        engagementId,
        activityIds: Array.from(selectedIds),
        attachments,
      })
      if ('error' in r) setErr(r.error)
      else router.refresh()
    })
  }

  function applyWitness() {
    const w = pendingWitness.trim()
    if (!w) return
    setErr(null)
    start(async () => {
      const r = await setWitnessAgent({ engagementId, witnessAgent: w })
      if ('error' in r) setErr(r.error)
      else router.refresh()
    })
  }

  return (
    <div style={{
      background: C.pinBg,
      border: `1px solid ${C.pinBorder}`,
      borderRadius: 12,
      padding: '1rem 1.1rem',
      marginBottom: '1rem',
    }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.pinFg, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
        📌 Provenance Capture · Stage 6
      </div>
      <div style={{ fontSize: '0.85rem', color: C.text, marginBottom: '0.7rem', lineHeight: 1.4 }}>
        Pin the evidence that this engagement actually happened. The bundle is hashed and frozen — only this set counts toward the trust deposit. Activities logged afterward will not.
      </div>

      {/* Activity selector */}
      <div style={{ marginBottom: '0.7rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Activities to include ({selectedIds.size}/{activities.length})
          </div>
          {activities.length > 0 && (
            <button type="button" onClick={toggleAll} style={{
              fontSize: '0.7rem', color: C.accent, background: 'none', border: 'none', cursor: 'pointer',
            }}>
              {allChecked ? 'clear all' : 'select all'}
            </button>
          )}
        </div>
        {activities.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: C.textMuted, fontStyle: 'italic', padding: '0.5rem', background: '#fff', border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            No activities logged yet. Log at least one before pinning.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 220, overflowY: 'auto' }}>
            {activities.map(a => (
              <label key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.4rem 0.6rem', background: '#fff',
                border: `1px solid ${C.border}`, borderRadius: 8,
                fontSize: '0.82rem', cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(a.id)}
                  onChange={() => toggle(a.id)}
                />
                <span style={{ flex: 1, color: C.text, fontWeight: 600 }}>{a.title}</span>
                <span style={{ fontSize: '0.7rem', color: C.textMuted, textTransform: 'capitalize' }}>{a.activityType}</span>
                <span style={{ fontSize: '0.7rem', color: C.textMuted, flexShrink: 0 }}>{a.activityDate}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Optional attachment */}
      <div style={{ marginBottom: '0.7rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>
          Optional external attachment
        </div>
        <input
          type="url"
          value={attachmentUri}
          onChange={e => setAttachmentUri(e.target.value)}
          placeholder="https:// link to a doc, photo, gist, file…"
          style={{
            width: '100%', fontSize: '0.82rem',
            padding: '0.4rem 0.6rem', borderRadius: 8,
            border: `1px solid ${C.border}`, background: '#fff', color: C.text,
            marginBottom: '0.35rem',
          }}
        />
        <input
          type="text"
          value={attachmentDesc}
          onChange={e => setAttachmentDesc(e.target.value)}
          placeholder="Short description (optional)"
          style={{
            width: '100%', fontSize: '0.82rem',
            padding: '0.4rem 0.6rem', borderRadius: 8,
            border: `1px solid ${C.border}`, background: '#fff', color: C.text,
          }}
        />
      </div>

      {/* Optional witness */}
      <div style={{ marginBottom: '0.85rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>
          Optional witness (trusted third-party)
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <input
            type="text"
            value={pendingWitness}
            onChange={e => setPendingWitness(e.target.value)}
            placeholder="Witness agent address — 0x…"
            style={{
              flex: 1, fontSize: '0.82rem',
              padding: '0.4rem 0.6rem', borderRadius: 8,
              border: `1px solid ${C.border}`, background: '#fff', color: C.text,
            }}
          />
          <button
            type="button"
            onClick={applyWitness}
            disabled={pending || pendingWitness.trim() === '' || pendingWitness.toLowerCase() === (witnessAgent ?? '').toLowerCase()}
            style={{
              padding: '0.4rem 0.85rem',
              background: '#fff', color: C.accent,
              border: `1px solid ${C.accent}`, borderRadius: 8,
              fontSize: '0.78rem', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Set witness
          </button>
        </div>
        <div style={{ fontSize: '0.68rem', color: C.textMuted, marginTop: '0.25rem' }}>
          Witness signs after pin · their signature lifts the weight of resulting reviews.
          {witnessAgent && <> Currently set: <code>{witnessAgent.slice(0, 10)}…</code></>}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !someChecked}
          style={{
            padding: '0.5rem 1.1rem',
            background: someChecked ? C.accent : '#f3f4f6',
            color: someChecked ? '#fff' : '#9ca3af',
            border: 'none', borderRadius: 8,
            fontSize: '0.82rem', fontWeight: 600,
            cursor: someChecked ? 'pointer' : 'not-allowed',
          }}
        >
          {pending ? 'Pinning…' : '📌 Pin evidence bundle'}
        </button>
      </div>
      {err && <div style={{ marginTop: '0.45rem', fontSize: '0.75rem', color: '#991b1b' }}>{err}</div>}
    </div>
  )
}

function WitnessRow({
  witnessAgent,
  witnessSignedAt,
  isWitness,
  engagementId,
  pending,
  start,
  setErr,
  router,
}: {
  witnessAgent: string | null
  witnessSignedAt: string | null
  isWitness: boolean
  engagementId: string
  pending: boolean
  start: (cb: () => void) => void
  setErr: (s: string | null) => void
  router: ReturnType<typeof useRouter>
}) {
  if (!witnessAgent) {
    return (
      <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
        No witness named for this engagement.
      </div>
    )
  }
  if (witnessSignedAt) {
    return (
      <div style={{
        fontSize: '0.72rem', color: C.doneFg,
        background: C.doneBg, border: `1px solid #bbf7d0`,
        padding: '0.4rem 0.6rem', borderRadius: 8,
      }}>
        ✓ Witness signed {new Date(witnessSignedAt).toLocaleString()}
      </div>
    )
  }
  if (!isWitness) {
    return (
      <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
        Awaiting witness signature from <code>{witnessAgent.slice(0, 10)}…</code>
      </div>
    )
  }
  // I'm the witness and haven't signed yet.
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setErr(null)
        start(async () => {
          const r = await attachWitnessSignature({ engagementId })
          if ('error' in r) setErr(r.error)
          else router.refresh()
        })
      }}
      style={{
        padding: '0.4rem 0.85rem',
        background: C.accent, color: '#fff',
        border: 'none', borderRadius: 8,
        fontSize: '0.78rem', fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      ✍ Sign as witness
    </button>
  )
}
