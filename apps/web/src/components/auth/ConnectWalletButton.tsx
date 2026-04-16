'use client'

import { useAuth } from '@/hooks/use-auth'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'
const PRIVY_CONNECT_INTENT_KEY = 'smart-agent:privy-connect-intent'

export function ConnectWalletButton() {
  const { login, ready, privyAuthenticated, canLoginWithPrivy, resetPrivySession } = useAuth()

  async function handleClick() {
    if (canLoginWithPrivy && typeof window !== 'undefined') {
      // If already authenticated with a stale session, logout first and
      // wait a tick for Privy to settle before opening the login modal.
      if (privyAuthenticated) {
        window.sessionStorage.removeItem(PRIVY_CONNECT_INTENT_KEY)
        await resetPrivySession()
        // Give Privy one render cycle to tear down before re-opening login
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

  if (!canLoginWithPrivy) {
    return (
      <button
        onClick={handleClick}
        data-component="connect-wallet-btn"
        data-state="disconnected"
      >
        {SKIP_AUTH ? 'Choose Demo User' : 'Connect Wallet'}
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
