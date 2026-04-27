'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Sign in as a specific demo user via /api/demo-login. After the JWT
 * cookie lands, poll /api/system-readiness with the cookie applied so
 * the user can see exactly which step is still resolving (person agent
 * registered, orgs linked, hub resolved). When everything is green, we
 * navigate to /dashboard. When boot-seed is still mid-flight, the modal
 * shows "system not ready yet" with the current phase instead of
 * spinning silently.
 */

type ReadinessItem = { label: string; ok: boolean; detail?: string }
type ReadinessPayload = {
  infra: ReadinessItem[]
  services: ReadinessItem[]
  community: ReadinessItem[]
  user: ReadinessItem[]
  infraReady: boolean
  servicesReady: boolean
  communityReady: boolean
  userReady: boolean
  allReady: boolean
  bootPhase: string
}

type Phase = 'idle' | 'signing-in' | 'progressing' | 'error'

export function DemoLoginButton({ userKey, accent }: { userKey: string; accent: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [name, setName] = useState<string>('')
  const router = useRouter()
  const cancelled = useRef(false)

  // Poll readiness while in the 'progressing' phase. Stops when
  // userReady flips true (then navigate) or when the user cancels.
  useEffect(() => {
    if (phase !== 'progressing') return
    cancelled.current = false
    let stopped = false

    async function tick() {
      while (!stopped && !cancelled.current) {
        try {
          const r = await fetch('/api/system-readiness', { cache: 'no-store' })
          const d = await r.json() as ReadinessPayload
          if (cancelled.current) return
          setReadiness(d)
          if (d.userReady) {
            stopped = true
            // Brief pause so the user sees all-green before navigation.
            setTimeout(() => { if (!cancelled.current) router.push('/dashboard') }, 400)
            return
          }
        } catch { /* network blip — keep polling */ }
        await new Promise(res => setTimeout(res, 800))
      }
    }
    tick()
    return () => { stopped = true; cancelled.current = true }
  }, [phase, router])

  async function go() {
    setErr(null)
    setReadiness(null)
    setSignedIn(false)
    setPhase('signing-in')
    try {
      const res = await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: userKey }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        setErr(j.error ?? `HTTP ${res.status}`)
        setPhase('error')
        return
      }
      const body = await res.json().catch(() => ({})) as { user?: { name?: string } }
      if (body.user?.name) setName(body.user.name)
      setSignedIn(true)
      setPhase('progressing')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
      setPhase('error')
    }
  }

  function cancel() {
    cancelled.current = true
    setPhase('idle')
    setSignedIn(false)
    setReadiness(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <button
        type="button"
        onClick={go}
        disabled={phase === 'signing-in' || phase === 'progressing'}
        style={{
          padding: '0.3rem 0.7rem',
          background: accent, color: '#fff',
          border: 'none', borderRadius: 6,
          fontSize: 11, fontWeight: 600,
          cursor: (phase === 'signing-in' || phase === 'progressing') ? 'wait' : 'pointer',
          opacity: (phase === 'signing-in' || phase === 'progressing') ? 0.5 : 1,
        }}
        data-testid={`demo-login-${userKey}`}
      >
        {phase === 'signing-in' || phase === 'progressing' ? '…' : 'Sign in'}
      </button>
      {err && phase === 'error' && (
        <span style={{ fontSize: 10, color: '#b91c1c' }}>{err}</span>
      )}

      {(phase === 'signing-in' || phase === 'progressing') && (
        <ProgressModal
          name={name || userKey}
          signedIn={signedIn}
          readiness={readiness}
          accent={accent}
          onCancel={cancel}
        />
      )}
    </div>
  )
}

function ProgressModal({
  name, signedIn, readiness, accent, onCancel,
}: {
  name: string
  signedIn: boolean
  readiness: ReadinessPayload | null
  accent: string
  onCancel: () => void
}) {
  // Three views, in priority order:
  //   1. Boot-seed for the whole community is still running → tell the
  //      user the system isn't ready yet (with the live phase).
  //   2. User-specific readiness still resolving → show the per-step
  //      checklist so they can see what's catching up.
  //   3. Everything ready → "Loading dashboard…" (we'll redirect in a
  //      few hundred ms).
  const noneYet = !readiness
  const seedRunning = readiness && !readiness.communityReady
  const userResolving = readiness && readiness.communityReady && !readiness.userReady
  const allReady = readiness && readiness.userReady

  return (
    <div
      role="dialog"
      aria-label="Demo login progress"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, padding: '1.4rem 1.5rem',
        maxWidth: 460, width: '100%',
        boxShadow: '0 20px 60px rgba(15,23,42,0.30)',
        border: '1px solid #e5e7eb',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>
          {seedRunning ? 'System not ready' : 'Connecting'}
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 14px' }}>
          {name}
        </h2>

        {noneYet && (
          <Step status="pending" label="Signing in…" />
        )}

        {readiness && (
          <>
            <Step status={signedIn ? 'ok' : 'pending'} label="Signed in" />

            {/* User-readiness checklist (only meaningful once community-
                seed is done — otherwise the cookie hasn't picked up the
                fully-provisioned user yet). */}
            {readiness.communityReady && readiness.user.map((it) => (
              <Step
                key={it.label}
                status={it.ok ? 'ok' : 'pending'}
                label={it.label}
                detail={it.detail}
              />
            ))}

            {seedRunning && (
              <div style={{ marginTop: 12, padding: '0.7rem 0.9rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                  Demo data is still being seeded.
                </div>
                <div style={{ fontSize: 11, color: '#92400e' }}>
                  Current phase: <code style={{ fontFamily: 'ui-monospace, monospace' }}>{readiness.bootPhase}</code>
                </div>
                <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                  This usually takes a few minutes after a fresh start. The dialog will continue when seeding finishes.
                </div>
              </div>
            )}

            {userResolving && (
              <div style={{ marginTop: 12, fontSize: 11, color: '#64748b' }}>
                Resolving your on-chain agent and hub membership…
              </div>
            )}

            {allReady && (
              <div style={{ marginTop: 12, padding: '0.55rem 0.8rem', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 12, color: '#047857', fontWeight: 600 }}>
                Ready. Loading your hub home…
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '0.45rem 0.9rem',
              background: 'transparent',
              color: accent,
              border: `1px solid ${accent}55`,
              borderRadius: 6,
              fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function Step({ status, label, detail }: { status: 'ok' | 'pending' | 'fail'; label: string; detail?: string }) {
  const dot = status === 'ok' ? '#10b981' : status === 'fail' ? '#ef4444' : '#cbd5e1'
  const pulse = status === 'pending' ? { animation: 'sa-pulse 1.4s ease-in-out infinite' as const } : {}
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '0.32rem 0' }}>
      <span
        aria-hidden
        style={{
          width: 10, height: 10, borderRadius: '50%',
          background: dot, marginTop: 5, flexShrink: 0,
          ...pulse,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 500 }}>{label}</div>
        {detail && (
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{detail}</div>
        )}
      </div>
      <style jsx>{`
        @keyframes sa-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  )
}
