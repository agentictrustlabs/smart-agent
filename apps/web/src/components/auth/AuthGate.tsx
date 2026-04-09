'use client'

import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

export function AuthGate() {
  const { authenticated, ready, user } = useAuth()
  const router = useRouter()
  const hasRedirected = useRef(false)

  useEffect(() => {
    if (!ready || !authenticated || !user || hasRedirected.current) return
    if (!user.wallet?.address) return

    hasRedirected.current = true

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
      .then((data) => {
        // Check if profile is complete
        return fetch('/api/auth/profile')
      })
      .then((r) => r.json())
      .then((profile) => {
        if (!profile.name || profile.name === 'Agent User' || !profile.email) {
          router.push('/onboarding')
        } else {
          router.push('/dashboard')
        }
      })
  }, [ready, authenticated, user, router])

  return null
}
