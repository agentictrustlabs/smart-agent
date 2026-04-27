'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Sign in as a specific demo user via /api/demo-login. After the JWT
 * cookie lands, redirect to /dashboard which will route into the
 * user's hub home.
 */
export function DemoLoginButton({ userKey, accent }: { userKey: string; accent: string }) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()

  function go() {
    setErr(null)
    start(async () => {
      try {
        const res = await fetch('/api/demo-login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: userKey }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({})) as { error?: string }
          setErr(j.error ?? `HTTP ${res.status}`)
          return
        }
        router.push('/dashboard')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'failed')
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <button
        type="button"
        onClick={go}
        disabled={pending}
        style={{
          padding: '0.3rem 0.7rem',
          background: accent, color: '#fff',
          border: 'none', borderRadius: 6,
          fontSize: 11, fontWeight: 600,
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.5 : 1,
        }}
        data-testid={`demo-login-${userKey}`}
      >
        {pending ? '…' : 'Sign in'}
      </button>
      {err && <span style={{ fontSize: 10, color: '#b91c1c' }}>{err}</span>}
    </div>
  )
}
