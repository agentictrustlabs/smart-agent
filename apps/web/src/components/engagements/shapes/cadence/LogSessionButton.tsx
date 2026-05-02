'use client'

/**
 * LogSessionButton — opens an inline composer for "I just had a session
 * with the other party". Date defaults to now, optional notes.
 *
 * For sensitive engagements (Rosa-style), the notes field is hidden so
 * only date + duration persist.
 *
 * Auto-opens when the page URL hash is `#log-activity` so the NextStepCard
 * "Log the first session" CTA both scrolls here AND opens the composer in
 * one click.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { logSession } from '@/lib/actions/engagements/sessions.action'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
}

export function LogSessionButton({
  engagementId,
  orgAddress,
  hideNotes,
  sessionNoun = 'session',
  activityTitleHint,
  variant = 'primary',
}: {
  engagementId: string
  orgAddress: string
  hideNotes?: boolean
  sessionNoun?: string
  activityTitleHint: string
  variant?: 'primary' | 'secondary'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState<string>(today)
  const [notes, setNotes] = useState<string>('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  // Auto-open when the URL hash points us at the log-activity surface
  // (NextStepCard's "Log the first session" CTA links to #log-activity).
  useEffect(() => {
    if (typeof window === 'undefined') return
    function maybeOpen() {
      if (window.location.hash === '#log-activity') setOpen(true)
    }
    maybeOpen()
    window.addEventListener('hashchange', maybeOpen)
    return () => window.removeEventListener('hashchange', maybeOpen)
  }, [])

  function submit() {
    setErr(null)
    start(async () => {
      const r = await logSession({
        engagementId,
        occurredAt: new Date(date).toISOString(),
        notes: hideNotes ? undefined : notes || undefined,
        orgAddress,
        activityTitle: activityTitleHint,
        capacityConsumed: 1,
        withActivity: true,
      })
      if ('error' in r) setErr(r.error)
      else {
        setOpen(false)
        setNotes('')
        router.refresh()
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '0.5rem 1.05rem',
          background: variant === 'primary' ? C.accent : '#fff',
          color: variant === 'primary' ? '#fff' : C.accent,
          border: variant === 'primary' ? 'none' : `1px solid ${C.accent}`,
          borderRadius: 8,
          fontSize: '0.82rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Log {sessionNoun}
      </button>
    )
  }

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: '0.7rem 0.85rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      minWidth: 260,
      flex: 1,
    }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Log this {sessionNoun}
      </div>
      <label style={{ fontSize: '0.78rem', color: C.text }}>
        Date
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          max={today}
          style={{
            display: 'block', marginTop: '0.2rem', width: '100%',
            padding: '0.4rem 0.55rem', borderRadius: 6,
            border: `1px solid ${C.border}`, fontSize: '0.85rem',
          }}
        />
      </label>
      {!hideNotes && (
        <label style={{ fontSize: '0.78rem', color: C.text }}>
          Notes (optional)
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={`A line about how the ${sessionNoun} went…`}
            rows={2}
            style={{
              display: 'block', marginTop: '0.2rem', width: '100%',
              padding: '0.4rem 0.55rem', borderRadius: 6,
              border: `1px solid ${C.border}`, fontSize: '0.85rem',
              fontFamily: 'inherit', resize: 'vertical',
            }}
          />
        </label>
      )}
      {hideNotes && (
        <div style={{ fontSize: '0.7rem', color: C.textMuted, fontStyle: 'italic' }}>
          Quiet mode — only the date and duration are recorded. No notes are stored.
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => { setOpen(false); setNotes(''); setErr(null) }}
          disabled={pending}
          style={{
            padding: '0.4rem 0.85rem',
            background: '#fff',
            color: C.textMuted,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          style={{
            padding: '0.4rem 1rem',
            background: C.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {err && <div style={{ fontSize: '0.75rem', color: '#991b1b' }}>{err}</div>}
    </div>
  )
}
