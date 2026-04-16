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
    if (ready && authenticated && user?.wallet?.address) {
      initialAddress.current = user.wallet.address
    }
    if (!authenticated) {
      initialAddress.current = null
    }
  }, [ready, authenticated, user?.wallet?.address])

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
    if (!authenticated && pathname !== '/' && !pathname.startsWith('/invite') && !pathname.startsWith('/h/')) {
      router.push('/')
    }
  }, [ready, authenticated, pathname, router])

  return null
}
