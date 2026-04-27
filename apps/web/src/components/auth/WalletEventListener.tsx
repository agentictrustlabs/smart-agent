'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter, usePathname } from 'next/navigation'

export function WalletEventListener() {
  const { authenticated, ready, logout, user, refresh } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const initialAddress = useRef<string | null>(null)

  // Resync local auth state whenever the route changes. useAuth's load
  // runs once on mount, so a sign-in that happened later (e.g. via the
  // /demo dialog → POST /api/demo-login) leaves this component with
  // user=null even though the session cookie is now valid. Without
  // this resync the next SPA navigation sees authenticated=false and
  // bounces the user to /sign-in (which redirects to /).
  useEffect(() => {
    refresh()
  }, [pathname, refresh])

  useEffect(() => {
    if (ready && authenticated && user?.walletAddress) {
      initialAddress.current = user.walletAddress
    }
    if (!authenticated) {
      initialAddress.current = null
    }
  }, [ready, authenticated, user?.walletAddress])

  useEffect(() => {
    if (!ready || !authenticated) return
    // accountsChanged is only meaningful for SIWE sessions — those are
    // the only ones whose `user.walletAddress` is the actual MetaMask
    // account. Demo / passkey / google sessions store an
    // application-managed wallet (demo: a generated EOA; passkey/google:
    // the smart-account address) which never matches MetaMask's view of
    // the world. Listening to accountsChanged for those sessions caused
    // a forced logout + redirect to / whenever MetaMask emitted any
    // event — even in tabs the user wasn't actively interacting with.
    if (user?.via !== 'siwe') return

    const ethereum = typeof window !== 'undefined'
      ? (window as unknown as { ethereum?: { on?: (event: string, cb: (accounts: string[]) => void) => void; removeListener?: (event: string, cb: (accounts: string[]) => void) => void } }).ethereum
      : undefined

    if (!ethereum?.on) return

    function handleAccountsChanged(accounts: string[]) {
      if (!initialAddress.current) return

      if (accounts.length === 0) {
        logout().then(() => router.push('/'))
        return
      }

      const newAddress = accounts[0]?.toLowerCase()
      const currentAddress = initialAddress.current?.toLowerCase()
      if (newAddress && currentAddress && newAddress !== currentAddress) {
        logout().then(() => router.push('/'))
      }
    }

    ethereum.on('accountsChanged', handleAccountsChanged)
    return () => { ethereum.removeListener?.('accountsChanged', handleAccountsChanged) }
  }, [ready, authenticated, user?.via, logout, router])

  useEffect(() => {
    if (!ready) return
    if (authenticated) return
    // Public paths an unauthenticated visitor is allowed to reach. Keep this
    // in sync with PUBLIC_PATHS in middleware.ts.
    const isPublic =
      pathname === '/' ||
      pathname.startsWith('/sign-in') ||
      pathname.startsWith('/sign-up') ||
      pathname.startsWith('/recover') ||
      pathname.startsWith('/invite') ||
      pathname.startsWith('/demo') ||
      pathname.startsWith('/h/')
    if (isPublic) return

    // Local state may be stale (the demo-login dialog mints a session
    // cookie without resetting useAuth's mount-time fetch result). Verify
    // with a fresh /api/auth/session before redirecting — only push to
    // /sign-in when the server agrees we have no session.
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/auth/session', { cache: 'no-store' })
        const body = await r.json() as { user: { id?: string } | null }
        if (cancelled) return
        if (body.user) {
          // Stale local state — refresh and stay on the page.
          refresh()
        } else {
          router.push('/sign-in')
        }
      } catch {
        if (!cancelled) router.push('/sign-in')
      }
    })()
    return () => { cancelled = true }
  }, [ready, authenticated, pathname, router, refresh])

  return null
}
