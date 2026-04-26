'use client'

import { useAuth } from '@/hooks/use-auth'

/**
 * Top-bar Connect button. Native auth replaces the auth modal — clicking
 * scrolls the user to the demo-login picker (and the eventual passkey/SIWE
 * buttons that sit on the same page).
 */
export function ConnectWalletButton() {
  const { login, ready, authenticated } = useAuth()

  if (!ready) {
    return (
      <button disabled data-component="connect-wallet-btn" data-state="loading">
        Loading...
      </button>
    )
  }

  return (
    <button
      onClick={() => login()}
      data-component="connect-wallet-btn"
      data-state={authenticated ? 'connected' : 'disconnected'}
    >
      {authenticated ? 'Connected' : 'Connect Wallet'}
    </button>
  )
}
