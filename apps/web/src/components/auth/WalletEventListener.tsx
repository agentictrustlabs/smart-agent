'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter, usePathname } from 'next/navigation'

export function WalletEventListener() {
  const { authenticated, ready, logout, user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const initialAddress = useRef<string | null>(null)

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
  }, [ready, authenticated, logout, router])

  useEffect(() => {
    if (!ready) return
    // Public paths an unauthenticated visitor is allowed to reach. Keep this
    // in sync with PUBLIC_PATHS in middleware.ts.
    const isPublic =
      pathname === '/' ||
      pathname.startsWith('/sign-in') ||
      pathname.startsWith('/sign-up') ||
      pathname.startsWith('/recover') ||
      pathname.startsWith('/invite') ||
      pathname.startsWith('/h/')
    if (!authenticated && !isPublic) {
      router.push('/sign-in')
    }
  }, [ready, authenticated, pathname, router])

  return null
}
