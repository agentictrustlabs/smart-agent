'use client'

import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

const PRIVY_CONNECT_INTENT_KEY = 'smart-agent:privy-connect-intent'

export function AuthGate() {
  const { authenticated, ready, user, authMethod } = useAuth()
  const router = useRouter()
  const hasRedirected = useRef(false)

  useEffect(() => {
    if (!ready || !authenticated || !user || hasRedirected.current) return
    if (authMethod !== 'privy') return
    if (!user.wallet?.address) return
    if (typeof window === 'undefined') return
    if (window.sessionStorage.getItem(PRIVY_CONNECT_INTENT_KEY) !== 'true') return

    hasRedirected.current = true
    window.sessionStorage.removeItem(PRIVY_CONNECT_INTENT_KEY)

    const googleUser = user as unknown as Record<string, { name?: string } | undefined>

    // Ensure user in DB
    fetch('/api/auth/ensure-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: user.wallet.address,
        email: user.email?.address ?? null,
        name: googleUser.google?.name ?? 'Agent User',
      }),
    })
      .then((r) => r.json())
      .then((_data) => {
        return fetch('/api/auth/profile')
      })
      .then((r) => r.json())
      .then(async (profile) => {
        // Clear stale demo cookies (but NOT a2a-session — it may still be valid
        // for this wallet, and re-bootstrapping requires MetaMask popups)
        document.cookie = 'demo-user=; path=/; max-age=0'

        // Try server-side A2A bootstrap (works for demo users).
        // For Privy users this will fail gracefully — they bootstrap
        // via the "Connect Agent Session" button on the profile page.
        try {
          await fetch('/api/a2a/bootstrap', { method: 'POST' })
        } catch { /* expected for Privy users */ }

        if (!profile.name || profile.name === 'Agent User' || !profile.email) {
          router.push('/onboarding')
        } else {
          router.push('/catalyst')
        }
      })
  }, [ready, authenticated, user, authMethod, router])

  return null
}
