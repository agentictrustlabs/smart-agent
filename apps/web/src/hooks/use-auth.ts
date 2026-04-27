'use client'

import { useCallback, useEffect, useState } from 'react'

export interface AuthenticatedUser {
  id: string
  walletAddress: string | null
  smartAccountAddress: string | null
  name: string
  email: string | null
  /** Identifies the auth method used to obtain this session. */
  via?: 'demo' | 'passkey' | 'siwe' | 'google' | null
}

interface SessionResponse {
  user: AuthenticatedUser | null
}

/**
 * Native session hook. Reads the current session from /api/auth/session.
 *
 *   - `authenticated` — true when a server-validated session cookie is present.
 *   - `ready` — true once the initial fetch has settled.
 *   - `user` — claims-derived user object, or null.
 *   - `login()` — scrolls to the demo-login picker (production passkey/SIWE
 *     buttons sit alongside it on the same page).
 *   - `logout()` — clears the session cookie via /api/auth/logout.
 *   - `refresh()` — re-fetch the session (for after a fresh login).
 */
export function useAuth() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [ready, setReady] = useState(false)

  // Stable identity so consumers can put `refresh` in useEffect deps
  // without causing infinite re-render loops.
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/session', { cache: 'no-store' })
      const body = (await r.json()) as SessionResponse
      setUser(body.user)
    } catch {
      setUser(null)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await load()
      if (cancelled) setUser(null)
    })()
    return () => { cancelled = true }
  }, [load])

  return {
    user,
    ready,
    authenticated: !!user,
    refresh: load,
    login: () => {
      if (typeof document === 'undefined') return
      const picker = document.getElementById('demo-login-picker')
      picker?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    logout: async () => {
      // For SIWE sessions, also revoke the MetaMask account permission so the
      // dApp disappears from the wallet's "Connected sites" list. Other auth
      // paths (passkey, demo) never asked for the permission, so we skip.
      // Always check for an injected provider — even non-SIWE users may have
      // connected MetaMask earlier in the session via another flow.
      if (typeof window !== 'undefined') {
        const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown }) => Promise<unknown> } }).ethereum
        if (eth) {
          try {
            await eth.request({
              method: 'wallet_revokePermissions',
              params: [{ eth_accounts: {} }],
            })
          } catch (err) {
            // EIP-2255 not supported, or no permission to revoke (already
            // disconnected, or never connected). Log so we can tell the
            // difference when debugging — UI flow continues either way.
            console.warn('[logout] wallet_revokePermissions failed:', (err as Error).message)
          }
        }
      }
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
      setUser(null)
    },
  }
}
