'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { acceptMatch, rejectMatch } from '@/lib/actions/discover.action'

const C = { accent: '#8b5e3c', text: '#5c4a3a', border: '#ece6db', card: '#ffffff' }

export function MatchActions({ matchId, hubSlug }: { matchId: string; hubSlug: string }) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()

  function onAccept() {
    setErr(null)
    start(async () => {
      const r = await acceptMatch(matchId)
      if ('error' in r) setErr(r.error)
      else router.refresh()
    })
  }
  function onReject() {
    setErr(null)
    start(async () => {
      const r = await rejectMatch(matchId)
      if ('error' in r) setErr(r.error)
      else router.refresh()
    })
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
        Decide
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onAccept}
          disabled={pending}
          style={{
            padding: '0.55rem 1rem',
            background: C.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: pending ? 'wait' : 'pointer',
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? 'Working…' : 'Accept match'}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={pending}
          style={{
            padding: '0.55rem 1rem',
            background: '#fff',
            color: '#991b1b',
            border: '1px solid #991b1b',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: pending ? 'wait' : 'pointer',
            opacity: pending ? 0.6 : 1,
          }}
        >
          Decline
        </button>
        <a
          href={`/h/${hubSlug}/discover`}
          style={{
            padding: '0.55rem 1rem',
            background: '#fff',
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '0.85rem',
            textDecoration: 'none',
          }}
        >
          Back to Discover
        </a>
      </div>
      {err && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#991b1b' }}>Error: {err}</div>
      )}
      <div style={{ marginTop: '0.65rem', fontSize: '0.72rem', color: '#9a8c7e' }}>
        Accepting mints a role-assignment if the need has a role requirement, transitions the need to
        in-progress, and sends an actionable message to the offerer.
      </div>
    </div>
  )
}
