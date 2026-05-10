'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const C = {
  card: '#ffffff', border: '#ece6db', text: '#5c4a3a', textMuted: '#9a8c7e',
  accent: '#8b5e3c', accentLight: 'rgba(139,94,60,0.08)',
  danger: '#b91c1c', dangerBg: 'rgba(185,28,28,0.08)',
  ok: '#0f766e',
}

type DurationKey = 'h1' | 'h24' | 'h168'

const DURATIONS: Record<DurationKey, string> = {
  h1: '1 hour',
  h24: '24 hours',
  h168: '7 days',
}

interface Props {
  currentDurationKey: DurationKey
  active: boolean
  sessionId: string | null
  rootGrantHash: `0x${string}` | null
}

export function PermissionsActions({ currentDurationKey, active, sessionId, rootGrantHash }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  function changeDuration(next: DurationKey) {
    router.push(`/sessions/permissions?duration=${next}`)
  }

  function grant() {
    setMsg(null)
    start(async () => {
      try {
        const res = await fetch('/api/a2a/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration: currentDurationKey }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.success) {
          setMsg({ kind: 'error', text: `Grant failed: ${data.error ?? res.statusText}` })
          return
        }
        setMsg({ kind: 'info', text: 'Session granted.' })
        router.refresh()
      } catch (e) {
        setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Grant failed' })
      }
    })
  }

  function revoke() {
    setMsg(null)
    if (!confirm('Revoke this session now? Any in-flight agent calls will be denied.')) return
    start(async () => {
      try {
        const res = await fetch('/api/a2a/revoke', { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.success) {
          setMsg({ kind: 'error', text: `Revoke failed: ${data.error ?? res.statusText}` })
          return
        }
        let text = 'Session revoked.'
        if (data.txHash) text += ` On-chain tx ${String(data.txHash).slice(0, 10)}…`
        if (data.partial) text += ` (partial: ${data.error ?? 'cookie cleared only'})`
        setMsg({ kind: 'info', text })
        router.refresh()
      } catch (e) {
        setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Revoke failed' })
      }
    })
  }

  return (
    <section data-component="permissions-actions" style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: '1rem 1.25rem', marginBottom: '1rem',
    }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
        Manage session
      </div>

      <div data-component="duration-picker" style={{ display: 'flex', gap: 8, marginBottom: '0.7rem', flexWrap: 'wrap' }}>
        {(Object.keys(DURATIONS) as DurationKey[]).map((k) => (
          <button
            key={k}
            onClick={() => changeDuration(k)}
            disabled={pending}
            data-component="duration-option"
            data-active={k === currentDurationKey ? 'true' : 'false'}
            style={{
              padding: '0.45rem 0.85rem', borderRadius: 8, cursor: 'pointer',
              fontSize: '0.82rem', fontWeight: 600,
              border: `1px solid ${k === currentDurationKey ? C.accent : C.border}`,
              background: k === currentDurationKey ? C.accentLight : '#fff',
              color: k === currentDurationKey ? C.accent : C.text,
            }}
          >
            {DURATIONS[k]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={grant}
          disabled={pending}
          data-component="grant-session"
          style={{
            padding: '0.55rem 1rem', borderRadius: 8, cursor: pending ? 'not-allowed' : 'pointer',
            fontSize: '0.86rem', fontWeight: 700,
            background: C.accent, color: '#fff', border: 'none',
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? 'Working…' : active ? `Re-grant for ${DURATIONS[currentDurationKey]}` : `Grant session (${DURATIONS[currentDurationKey]})`}
        </button>

        {active && (
          <button
            onClick={revoke}
            disabled={pending}
            data-component="revoke-session"
            style={{
              padding: '0.55rem 1rem', borderRadius: 8, cursor: pending ? 'not-allowed' : 'pointer',
              fontSize: '0.86rem', fontWeight: 700,
              background: '#fff', color: C.danger, border: `1px solid ${C.danger}`,
              opacity: pending ? 0.6 : 1,
            }}
            title={rootGrantHash ? `Will revoke ${rootGrantHash.slice(0, 10)}… on-chain` : 'No rootGrantHash — local cleanup only'}
          >
            Revoke session now
          </button>
        )}

        <Link href="/dashboard" data-component="cancel-link" style={{
          padding: '0.55rem 1rem', borderRadius: 8,
          fontSize: '0.86rem', fontWeight: 600,
          color: C.textMuted, border: `1px solid ${C.border}`, textDecoration: 'none',
          alignSelf: 'center',
        }}>
          Cancel
        </Link>
      </div>

      {msg && (
        <div data-component="actions-message" style={{
          marginTop: '0.7rem', padding: '0.55rem 0.8rem', borderRadius: 8,
          background: msg.kind === 'error' ? C.dangerBg : 'rgba(15,118,110,0.08)',
          color: msg.kind === 'error' ? C.danger : C.ok,
          fontSize: '0.82rem',
        }}>
          {msg.text}
        </div>
      )}

      {!rootGrantHash && active && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.72rem', color: C.textMuted, fontStyle: 'italic' }}>
          Note: no rootGrantHash recorded for this session yet — revoke will mark it locally but skip the on-chain revoke step until the session has performed at least one action.
        </div>
      )}
    </section>
  )
}
