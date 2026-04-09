'use client'

import { useAuth } from '@/hooks/use-auth'

export function ConnectWalletButton() {
  const { login, authenticated, ready } = useAuth()

  if (!ready) {
    return (
      <button disabled data-component="connect-wallet-btn" data-state="loading">
        Loading...
      </button>
    )
  }

  if (authenticated) {
    return (
      <button disabled data-component="connect-wallet-btn" data-state="connected">
        Connected
      </button>
    )
  }

  return (
    <button
      onClick={login}
      data-component="connect-wallet-btn"
      data-state="disconnected"
    >
      Connect Wallet
    </button>
  )
}
