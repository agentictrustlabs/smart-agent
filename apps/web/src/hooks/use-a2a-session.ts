'use client'

import { useState, useCallback } from 'react'

/**
 * Client-side A2A session bootstrap for the SIWE / wallet-connect path.
 *
 * Reads the injected EIP-1193 provider from `window.ethereum` (MetaMask,
 * Rabby, Coinbase Wallet, OKX, …). For passkey-only users, A2A is
 * bootstrapped server-side at signup time using the deployer relayer, so
 * this hook isn't needed on that path.
 *
 * Flow:
 *   1. POST /api/a2a/bootstrap/client → server prepares delegation, returns hash
 *   2. ONE wallet popup: user signs the delegation hash
 *   3. POST /api/a2a/bootstrap/complete → session activated, cookie set
 */
type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

function getInjected(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum
  return eth ?? null
}

export function useA2ASession() {
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)

  const bootstrap = useCallback(async (onPhase?: (phase: string) => void) => {
    const provider = getInjected()
    if (!provider) {
      setError('No injected wallet detected (install MetaMask, Rabby, Coinbase Wallet, …)')
      return null
    }

    setBootstrapping(true)
    setError(null)
    try {
      // Make sure the wallet is connected and grab the active address.
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[]
      const userAddress = accounts[0]
      if (!userAddress) throw new Error('Wallet returned no accounts')

      onPhase?.('bootstrapping-agent')
      const initRes = await fetch('/api/a2a/bootstrap/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}))
        throw new Error(err.error ?? 'Bootstrap init failed')
      }
      const { delegationHash, sessionId, delegation } = await initRes.json()

      onPhase?.('signing-delegation')
      const delegationSig = await provider.request({
        method: 'personal_sign',
        params: [delegationHash, userAddress],
      }) as string

      onPhase?.('bootstrapping-agent')
      const completeRes = await fetch('/api/a2a/bootstrap/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, delegationSignature: delegationSig, delegation }),
      })
      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}))
        throw new Error(err.error ?? 'Session activation failed')
      }
      const { sessionToken: token } = await completeRes.json()
      setSessionToken(token)
      setBootstrapping(false)
      return token
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Bootstrap failed'
      setError(msg)
      setBootstrapping(false)
      return null
    }
  }, [])

  return {
    sessionToken,
    bootstrapping,
    error,
    bootstrap,
    hasSession: !!sessionToken,
    refreshToken: (token?: string) => { if (token) setSessionToken(token) },
  }
}
