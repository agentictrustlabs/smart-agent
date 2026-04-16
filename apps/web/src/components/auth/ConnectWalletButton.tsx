'use client'

import { useAuth } from '@/hooks/use-auth'

const PRIVY_CONNECT_INTENT_KEY = 'smart-agent:privy-connect-intent'

export function ConnectWalletButton() {
  const { login, ready, privyAuthenticated, canLoginWithPrivy, resetPrivySession } = useAuth()

  async function handleClick() {
    if (canLoginWithPrivy && typeof window !== 'undefined') {
      if (privyAuthenticated) {
        window.sessionStorage.removeItem(PRIVY_CONNECT_INTENT_KEY)
        await resetPrivySession()
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      window.sessionStorage.setItem(PRIVY_CONNECT_INTENT_KEY, 'true')
      login()
      return
    }

    if (!canLoginWithPrivy) {
      login()
      return
    }
  }

  if (!ready) {
    return (
      <button disabled data-component="connect-wallet-btn" data-state="loading">
        Loading...
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      data-component="connect-wallet-btn"
      data-state={privyAuthenticated ? 'connected' : 'disconnected'}
    >
      Connect Wallet
    </button>
  )
}
