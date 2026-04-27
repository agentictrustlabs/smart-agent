'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Demo sign-in flow with a progress dialog instead of a silent spinner:
 *
 *   1. Pre-flight /api/system-readiness BEFORE calling demo-login. If
 *      the boot-seed for the community is still running, the dialog
 *      stays in "system not ready" mode (live phase) and *no* session
 *      is minted yet — so we never end up with a half-provisioned
 *      cookie that bounces /dashboard back to /.
 *   2. Once communityReady flips true, fire /api/demo-login. From here
 *      the cookie is set; subsequent readiness fetches show user-side
 *      items resolving (person agent registered, orgs linked, hub
 *      resolved).
 *   3. When userReady is true, navigate directly to the resolved hub
 *      home (e.g. /h/catalyst/home) — bypassing /dashboard's redirect
 *      chain to avoid the flicker the user reported.
 *
 * Cancel at any time bails out without leaving session state.
 */

type ReadinessItem = { label: string; ok: boolean; detail?: string }
type ReadinessPayload = {
  user: ReadinessItem[]
  communityReady: boolean
  userReady: boolean
  bootPhase: string
}

type Phase = 'idle' | 'opening' | 'progressing' | 'connecting-agent' | 'navigating' | 'error'

// internal hub id (server-side `getUserHubId`) → URL slug
const HUB_SLUG: Record<string, string> = {
  catalyst: 'catalyst',
  cil: 'mission',
  'global-church': 'globalchurch',
}

function pickHubHomePath(user: ReadinessItem[]): string {
  const item = user.find(i => i.label.toLowerCase().includes('hub'))
  const m = item?.detail?.match(/hubId=([\w-]+)/)
  const hubId = m?.[1]
  if (!hubId || hubId === 'generic') return '/dashboard'
  const slug = HUB_SLUG[hubId]
  return slug ? `/h/${slug}/home` : '/dashboard'
}

export function DemoLoginButton({ userKey, accent }: { userKey: string; accent: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [name, setName] = useState<string>('')
  const [agentConnected, setAgentConnected] = useState(false)
  const [navTarget, setNavTarget] = useState<string | null>(null)
  const router = useRouter()
  // userCancelled is a *user-action* flag (Cancel button only). The polling
  // loop's own teardown (when we transition phase to 'navigating') must NOT
  // set it, otherwise the scheduled router.push is suppressed and the
  // dialog hangs at "Ready. Loading…".
  const userCancelled = useRef(false)
  const signedInRef = useRef(false)

  // ── Polling loop: drives readiness fetches + sign-in. Stops when
  //    userReady triggers a navTarget; cleanup only flips the local
  //    `stopped` flag so the navigation effect below can still fire.
  useEffect(() => {
    if (phase !== 'progressing') return
    let stopped = false

    async function tick() {
      while (!stopped && !userCancelled.current) {
        let d: ReadinessPayload | null = null
        try {
          const r = await fetch('/api/system-readiness', { cache: 'no-store' })
          d = await r.json() as ReadinessPayload
          if (userCancelled.current) return
          setReadiness(d)
        } catch { /* network blip — keep polling */ }

        // Step A — community seed must be done before we mint a session.
        if (d?.communityReady && !signedInRef.current) {
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
            signedInRef.current = true
            setSignedIn(true)
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'demo-login failed')
            setPhase('error')
            return
          }
          // loop again immediately to refetch readiness with the cookie now set
          continue
        }

        // Step B — user-side readiness flips true → bootstrap the A2A
        // session BEFORE navigating, so the profile / anoncred surfaces
        // don't pop a fresh prompt the moment the user lands.
        // Demo users have a stored privateKey, so this is a server-only
        // sign + an httpOnly cookie set on the response. No UI prompt.
        if (d?.userReady && signedInRef.current) {
          setPhase('connecting-agent')
          try {
            const r = await fetch('/api/a2a/bootstrap', { method: 'POST' })
            const body = await r.json().catch(() => ({})) as { success?: boolean; error?: string }
            if (!body.success) {
              // Don't fail the whole login — log it and continue. Profile
              // page will retry lazily if the cookie isn't set.
              console.warn('[demo-login] A2A bootstrap failed (non-fatal):', body.error)
            } else {
              setAgentConnected(true)
            }
          } catch (e) {
            console.warn('[demo-login] A2A bootstrap threw:', (e as Error).message)
          }
          setNavTarget(pickHubHomePath(d.user))
          setPhase('navigating')
          return
        }

        await new Promise(res => setTimeout(res, 800))
      }
    }
    tick()
    return () => { stopped = true }
  }, [phase, userKey])

  // ── Navigation effect: fires once a navTarget is set. Independent of
  //    the polling effect so its setTimeout can't be cancelled by the
  //    poller's teardown.
  useEffect(() => {
    if (!navTarget) return
    const id = setTimeout(() => {
      if (!userCancelled.current) router.push(navTarget)
    }, 350)
    return () => clearTimeout(id)
  }, [navTarget, router])

  function go() {
    setErr(null)
    setReadiness(null)
    setSignedIn(false)
    signedInRef.current = false
    userCancelled.current = false
    setNavTarget(null)
    setPhase('opening')
    // The dialog opens synchronously; readiness polling kicks in via
    // the effect once we transition to 'progressing'.
    setTimeout(() => setPhase('progressing'), 0)
  }

  function cancel() {
    userCancelled.current = true
    setPhase('idle')
    setSignedIn(false)
    signedInRef.current = false
    setReadiness(null)
    setNavTarget(null)
  }

  const inFlight = phase !== 'idle' && phase !== 'error'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <button
        type="button"
        onClick={go}
        disabled={inFlight}
        style={{
          padding: '0.3rem 0.7rem',
          background: accent, color: '#fff',
          border: 'none', borderRadius: 6,
          fontSize: 11, fontWeight: 600,
          cursor: inFlight ? 'wait' : 'pointer',
          opacity: inFlight ? 0.5 : 1,
        }}
        data-testid={`demo-login-${userKey}`}
      >
        {inFlight ? '…' : 'Sign in'}
      </button>
      {err && phase === 'error' && (
        <span style={{ fontSize: 10, color: '#b91c1c' }}>{err}</span>
      )}

      {inFlight && (
        <ProgressModal
          name={name || userKey}
          signedIn={signedIn}
          agentConnected={agentConnected}
          readiness={readiness}
          phase={phase}
          accent={accent}
          onCancel={cancel}
        />
      )}
    </div>
  )
}

function ProgressModal({
  name, signedIn, agentConnected, readiness, phase, accent, onCancel,
}: {
  name: string
  signedIn: boolean
  agentConnected: boolean
  readiness: ReadinessPayload | null
  phase: Phase
  accent: string
  onCancel: () => void
}) {
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
        zIndex: 9999, padding: 16,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, padding: '1.4rem 1.5rem',
        maxWidth: 460, width: '100%',
        boxShadow: '0 20px 60px rgba(15,23,42,0.30)',
        border: '1px solid #e5e7eb',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>
          {seedRunning ? 'System not ready yet' : phase === 'navigating' ? 'Loading' : 'Connecting'}
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 14px' }}>
          {name}
        </h2>

        <Step
          status={readiness ? 'ok' : 'pending'}
          label="Connected to backend"
        />
        <Step
          status={!readiness ? 'pending' : readiness.communityReady ? 'ok' : 'pending'}
          label="Demo community on chain"
          detail={readiness && !readiness.communityReady ? `phase: ${readiness.bootPhase}` : undefined}
        />
        <Step
          status={signedIn ? 'ok' : seedRunning ? 'blocked' : 'pending'}
          label="Session minted"
        />

        {/* User-readiness checklist (only shown once we have a session
            and the cookie has had a chance to propagate). */}
        {readiness && readiness.communityReady && signedIn && readiness.user.map((it) => (
          <Step
            key={it.label}
            status={it.ok ? 'ok' : 'pending'}
            label={it.label}
            detail={it.detail}
          />
        ))}

        {/* A2A session bootstrap — fires once the user is fully ready.
            Demo users sign server-side (no prompt); the cookie that lands
            here is what /catalyst/me uses to skip the bootstrap modal. */}
        {readiness?.userReady && (
          <Step
            status={agentConnected ? 'ok' : 'pending'}
            label="Connecting your agent (A2A session)"
          />
        )}

        {noneYet && (
          <div style={{ marginTop: 12, fontSize: 11, color: '#64748b' }}>
            Checking system status…
          </div>
        )}

        {seedRunning && (
          <div style={{ marginTop: 12, padding: '0.7rem 0.9rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
              Demo data is still being seeded.
            </div>
            <div style={{ fontSize: 11, color: '#92400e' }}>
              Current phase: <code style={{ fontFamily: 'ui-monospace, monospace' }}>{readiness.bootPhase}</code>
            </div>
            <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
              Sign-in is paused until seeding finishes — the dialog will continue automatically.
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

function Step({ status, label, detail }: {
  status: 'ok' | 'pending' | 'blocked' | 'fail'
  label: string
  detail?: string
}) {
  const dot =
    status === 'ok' ? '#10b981' :
    status === 'fail' ? '#ef4444' :
    status === 'blocked' ? '#fbbf24' :
    '#cbd5e1'
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
