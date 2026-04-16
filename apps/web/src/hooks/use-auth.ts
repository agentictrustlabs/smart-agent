'use client'

import { useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''

type PrivyUser = ReturnType<typeof usePrivy>['user']

interface DemoAuthResponse {
  user: {
    userId: string
    walletAddress: string
    email: string
    name: string
  } | null
}

// Demo-user cookie is httpOnly — can't read from client.
// The GET /api/demo-login endpoint reads it server-side and returns user data.

function buildDemoUser(data: NonNullable<DemoAuthResponse['user']>): PrivyUser {
  return {
    id: data.userId,
    wallet: { address: data.walletAddress },
    email: { address: data.email },
    google: { name: data.name },
  } as PrivyUser
}

export function useAuth() {
  const privy = usePrivy()
  const [demoReady, setDemoReady] = useState(!SKIP_AUTH)
  const [demoAuthenticated, setDemoAuthenticated] = useState(false)
  const [demoUser, setDemoUser] = useState<PrivyUser>(null)

  useEffect(() => {
    if (!SKIP_AUTH) return

    let cancelled = false

    async function loadDemoUser() {
      // Cookie is httpOnly — check via server API
      try {
        const res = await fetch('/api/demo-login', { cache: 'no-store' })
        const data = await res.json() as DemoAuthResponse
        if (!data.user) {
          if (!cancelled) {
            setDemoAuthenticated(false)
            setDemoUser(null)
            setDemoReady(true)
          }
          return
        }
        if (!cancelled) {
          setDemoAuthenticated(Boolean(data.user))
          setDemoUser(data.user ? buildDemoUser(data.user) : null)
        }
      } catch {
        if (!cancelled) {
          setDemoAuthenticated(false)
          setDemoUser(null)
        }
      } finally {
        if (!cancelled) {
          setDemoReady(true)
        }
      }
    }

    loadDemoUser()

    return () => {
      cancelled = true
    }
  }, [])

  const privyEnabled = Boolean(PRIVY_APP_ID)
  const privyReady = privyEnabled ? privy.ready : true
  const privyAuthenticated = privyEnabled ? privy.authenticated : false

  const authMethod = privyAuthenticated
    ? 'privy'
    : demoAuthenticated
      ? 'demo'
      : null

  const authenticated = privyAuthenticated || demoAuthenticated
  const ready = privyReady && demoReady
  const user = privyAuthenticated ? privy.user : demoUser

  return {
    authenticated,
    ready,
    user,
    authMethod,
    privyAuthenticated,
    demoAuthenticated,
    canLoginWithPrivy: privyEnabled,
    login: () => {
      if (privyEnabled) {
        privy.login()
        return
      }

      if (typeof document === 'undefined') return
      const picker = document.getElementById('demo-login-picker')
      picker?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    resetPrivySession: async () => {
      if (privyEnabled && privyAuthenticated) {
        await privy.logout()
      }
    },
    logout: async () => {
      // Clear demo cookie. Keep a2a-session — it's tied to the smart account
      // and stays valid across reconnects (24h TTL). Only cleared when
      // switching demo users (see DemoLoginPicker).
      // Clear httpOnly cookies via server
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
      setDemoAuthenticated(false)
      setDemoUser(null)

      if (privyAuthenticated) {
        await privy.logout()
      }
    },
  }
}
