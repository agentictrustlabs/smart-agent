'use client'

import { useAuth } from '@/hooks/use-auth'
import { useA2ASession } from '@/hooks/use-a2a-session'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Set this in sessionStorage right BEFORE you initiate a fresh login (passkey,
 * SIWE, or any future method). AuthGate watches for it: when authenticated +
 * the flag is present, it runs the post-login bootstrap (ensure-user → profile
 * check → A2A bootstrap) and routes to /catalyst. Without the flag, an already-
 * authenticated user just keeps browsing — no setup re-runs.
 */
export const FRESH_LOGIN_INTENT_KEY = 'smart-agent:fresh-login-intent'

type SetupPhase =
  | 'idle'
  | 'ensuring-user'
  | 'checking-profile'
  | 'bootstrapping-agent'
  | 'signing-delegation'
  | 'done'

const PHASE_LABELS: Record<SetupPhase, string> = {
  'idle': '',
  'ensuring-user': 'Creating your account...',
  'checking-profile': 'Checking profile...',
  'bootstrapping-agent': 'Setting up your agent...',
  'signing-delegation': 'Authorize your agent in your wallet...',
  'done': 'Ready!',
}

export function AuthGate() {
  const { authenticated, ready, user } = useAuth()
  const a2a = useA2ASession()
  const router = useRouter()
  const hasStarted = useRef(false)
  const [phase, setPhase] = useState<SetupPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || !authenticated || !user || hasStarted.current) return
    if (typeof window === 'undefined') return
    if (window.sessionStorage.getItem(FRESH_LOGIN_INTENT_KEY) !== 'true') return
    // Demo users go through their own picker flow which already provisions
    // wallets — no extra bootstrap needed.
    if (user.via === 'demo') {
      window.sessionStorage.removeItem(FRESH_LOGIN_INTENT_KEY)
      return
    }
    if (!user.walletAddress) return

    hasStarted.current = true
    window.sessionStorage.removeItem(FRESH_LOGIN_INTENT_KEY)

    async function setup() {
      // Always settle the spinner before navigating away — leaving the phase
      // mid-flight while pushing to a new route would mean the overlay sticks
      // on top of the destination page indefinitely.
      const finish = (target: string) => { setPhase('idle'); router.push(target) }

      try {
        setPhase('ensuring-user')
        await fetch('/api/auth/ensure-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: user!.walletAddress,
            email: user!.email ?? null,
            name: user!.name ?? 'Agent User',
          }),
        })

        setPhase('checking-profile')
        const profileRes = await fetch('/api/auth/profile')
        const profile = await profileRes.json()
        if (!profile.name || profile.name === 'Agent User' || !profile.email) {
          finish('/onboarding')
          return
        }

        // Passkey-native and Google-OAuth users have no client-side EOA, so
        // the wallet-bootstrap path (which calls eth_requestAccounts) doesn't
        // apply. The server-side /api/a2a/bootstrap path doesn't apply either:
        // it requires an EOA private key on the user row, which neither auth
        // method stores. Phase 4 (passkey-signed wallet actions) will fill
        // this gap with ERC-1271 signing; for now, just skip a2a-session
        // bootstrap entirely and let the user onto /catalyst.
        if (user!.via === 'passkey' || user!.via === 'google') {
          finish('/catalyst')
          return
        }

        setPhase('bootstrapping-agent')
        const serverRes = await fetch('/api/a2a/bootstrap', { method: 'POST' })
        const serverData = await serverRes.json()
        if (serverData.success) {
          finish('/catalyst')
          return
        }

        setPhase('bootstrapping-agent')
        const token = await a2a.bootstrap((p) => setPhase(p as SetupPhase))
        if (token) {
          finish('/catalyst')
          return
        }

        if (a2a.error) console.warn('[AuthGate] A2A bootstrap failed:', a2a.error)
        finish('/catalyst')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Setup failed')
        setTimeout(() => finish('/catalyst'), 2000)
      }
    }

    void setup()
  }, [ready, authenticated, user, router, a2a])

  if (phase === 'idle' || phase === 'done') return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(250, 248, 243, 0.97)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '1.5rem',
    }}>
      <div style={{
        width: 48, height: 48,
        border: '4px solid #ece6db', borderTopColor: '#8b5e3c',
        borderRadius: '50%', animation: 'spin 1s linear infinite',
      }} />
      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#5c4a3a', textAlign: 'center', maxWidth: 300 }}>
        {PHASE_LABELS[phase]}
      </div>
      {phase === 'signing-delegation' && (
        <div style={{ fontSize: '0.82rem', color: '#9a8c7e', textAlign: 'center', maxWidth: 280 }}>
          A signature request will appear in your wallet. This authorizes your AI agent to act on your behalf.
        </div>
      )}
      {error && (
        <div style={{ fontSize: '0.82rem', color: '#c62828', textAlign: 'center', maxWidth: 300, marginTop: '0.5rem' }}>
          {error}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
