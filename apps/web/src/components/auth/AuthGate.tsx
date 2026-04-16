'use client'

import { useAuth } from '@/hooks/use-auth'
import { useA2ASession } from '@/hooks/use-a2a-session'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

const PRIVY_CONNECT_INTENT_KEY = 'smart-agent:privy-connect-intent'

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
  const { authenticated, ready, user, authMethod } = useAuth()
  const a2a = useA2ASession()
  const router = useRouter()
  const hasStarted = useRef(false)
  const [phase, setPhase] = useState<SetupPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || !authenticated || !user || hasStarted.current) return
    if (authMethod !== 'privy') return
    if (!user.wallet?.address) return
    if (typeof window === 'undefined') return
    if (window.sessionStorage.getItem(PRIVY_CONNECT_INTENT_KEY) !== 'true') return

    hasStarted.current = true
    window.sessionStorage.removeItem(PRIVY_CONNECT_INTENT_KEY)

    // Clear stale demo cookies
    document.cookie = 'demo-user=; path=/; max-age=0'

    const googleUser = user as unknown as Record<string, { name?: string } | undefined>

    async function setup() {
      try {
        // ─── Step 1: Ensure user in DB ────────────────────────────
        setPhase('ensuring-user')
        await fetch('/api/auth/ensure-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: user!.wallet!.address,
            email: user!.email?.address ?? null,
            name: googleUser.google?.name ?? 'Agent User',
          }),
        })

        // ─── Step 2: Check profile completeness ──────────────────
        setPhase('checking-profile')
        const profileRes = await fetch('/api/auth/profile')
        const profile = await profileRes.json()

        if (!profile.name || profile.name === 'Agent User' || !profile.email) {
          router.push('/onboarding')
          return
        }

        // ─── Step 3: Bootstrap A2A session ────────────────────────
        setPhase('bootstrapping-agent')

        // Try server-side first (works if user has stored key, e.g., returning user)
        const serverRes = await fetch('/api/a2a/bootstrap', { method: 'POST' })
        const serverData = await serverRes.json()

        if (serverData.success) {
          setPhase('done')
          router.push('/catalyst')
          return
        }

        // Server-side failed — need client-side MetaMask signing (one signature)
        setPhase('bootstrapping-agent')
        const token = await a2a.bootstrap((p) => setPhase(p as SetupPhase))

        if (token) {
          setPhase('done')
          router.push('/catalyst')
          return
        }

        // Bootstrap failed — go to home anyway, user can retry from profile
        if (a2a.error) {
          console.warn('[AuthGate] A2A bootstrap failed:', a2a.error)
        }
        router.push('/catalyst')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Setup failed')
        // Still redirect after error — user can fix from profile page
        setTimeout(() => router.push('/catalyst'), 2000)
      }
    }

    setup()
  }, [ready, authenticated, user, authMethod, router, a2a])

  // Only show the spinner when we're actively setting up
  if (phase === 'idle' || phase === 'done') return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(250, 248, 243, 0.97)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1.5rem',
    }}>
      {/* Spinner */}
      <div style={{
        width: 48,
        height: 48,
        border: '4px solid #ece6db',
        borderTopColor: '#8b5e3c',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }} />

      {/* Phase label */}
      <div style={{
        fontSize: '1rem',
        fontWeight: 600,
        color: '#5c4a3a',
        textAlign: 'center',
        maxWidth: 300,
      }}>
        {PHASE_LABELS[phase]}
      </div>

      {/* Subtitle */}
      {phase === 'signing-delegation' && (
        <div style={{
          fontSize: '0.82rem',
          color: '#9a8c7e',
          textAlign: 'center',
          maxWidth: 280,
        }}>
          A signature request will appear in your wallet. This authorizes your AI agent to act on your behalf.
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          fontSize: '0.82rem',
          color: '#c62828',
          textAlign: 'center',
          maxWidth: 300,
          marginTop: '0.5rem',
        }}>
          {error}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
