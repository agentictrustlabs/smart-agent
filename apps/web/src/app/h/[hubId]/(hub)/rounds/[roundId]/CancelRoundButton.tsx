'use client'

/**
 * Cancellation guardian button — visible only to users authorised on the
 * round's fund (caller decides this server-side and passes `visible`).
 *
 * Click → modal asking for reasonKind + optional reasonURI → POST to
 * /h/[hubId]/rounds/[roundId]/cancel → page refresh.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  warnBg: '#fef3c7',
  warnFg: '#92400e',
  errorBg: '#fef2f2',
  errorFg: '#991b1b',
}

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'dispute', label: 'Dispute upheld' },
  { value: 'security-incident', label: 'Security incident' },
  { value: 'mandate-change', label: 'Mandate change' },
  { value: 'steward-action', label: 'Steward action' },
  { value: 'other', label: 'Other' },
]

interface Props {
  hubSlug: string
  roundId: string
}

export function CancelRoundButton({ hubSlug, roundId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reasonKind, setReasonKind] = useState('dispute')
  const [reasonURI, setReasonURI] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/h/${hubSlug}/rounds/${encodeURIComponent(roundId)}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reasonKind, reasonURI: reasonURI || undefined }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(j.error ?? `Cancel failed: ${res.status}`)
          return
        }
        setOpen(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '0.55rem 0.95rem',
          background: 'transparent',
          color: C.warnFg,
          border: `1px solid ${C.warnFg}`,
          borderRadius: 8,
          fontSize: '0.82rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Cancel round
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '1rem',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '1.25rem 1.4rem',
          width: '100%',
          maxWidth: '32rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text, margin: '0 0 0.4rem' }}>
          Cancel round
        </h2>
        <p style={{ fontSize: '0.78rem', color: C.textMuted, margin: '0 0 0.9rem' }}>
          Cancellation guardian path. Emits <code>sa:RoundCanceledAssertion</code> on
          chain and revokes any in-flight session delegation. Use this when a dispute
          within the 72&nbsp;h window is upheld or a security incident requires rolling
          back the round.
        </p>

        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: C.text, marginBottom: '0.3rem' }}>
          Reason
        </label>
        <select
          value={reasonKind}
          onChange={e => setReasonKind(e.target.value)}
          style={{ width: '100%', padding: '0.45rem 0.55rem', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: '0.85rem', marginBottom: '0.7rem' }}
        >
          {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: C.text, marginBottom: '0.3rem' }}>
          Reason URI (optional)
        </label>
        <input
          type="text"
          value={reasonURI}
          placeholder="urn:dispute-record:..."
          onChange={e => setReasonURI(e.target.value)}
          style={{ width: '100%', padding: '0.45rem 0.55rem', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: '0.85rem', marginBottom: '0.9rem' }}
        />

        {error && (
          <div style={{ marginBottom: '0.6rem', padding: '0.45rem 0.6rem', background: C.errorBg, color: C.errorFg, borderRadius: 6, fontSize: '0.78rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={isPending}
            style={{ padding: '0.45rem 0.85rem', background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            Back
          </button>
          <button
            type="submit"
            disabled={isPending}
            style={{ padding: '0.45rem 0.95rem', background: C.warnFg, color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}
          >
            {isPending ? 'Canceling…' : 'Confirm cancel'}
          </button>
        </div>
      </form>
    </div>
  )
}
