'use client'

import { useAuth } from '@/hooks/use-auth'

export function ConnectWalletButton() {
  const { login, authenticated, ready } = useAuth()

  if (!ready) {
    return (
      <div data-component="connect-area">
        <button disabled data-component="connect-wallet-btn" data-state="loading">
          <span data-component="spinner-dot" />
          Connecting to Privy...
        </button>
        <p data-component="connect-hint">
          Make sure you are accessing via <strong>http://localhost:3000</strong>
        </p>
      </div>
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
