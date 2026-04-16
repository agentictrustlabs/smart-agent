'use client'

import { useState, useCallback } from 'react'
import { useWallets } from '@privy-io/react-auth'

// Cookie is httpOnly — client can't read it directly.
// Token is received from API responses and stored in React state.

/**
 * Client-side A2A session management for Privy/MetaMask users.
 *
 * Single-signature flow:
 *   1. POST /api/a2a/bootstrap/client → server handles challenge (deployer signs),
 *      creates session, returns delegation hash
 *   2. ONE MetaMask popup: user signs the delegation hash
 *   3. POST /api/a2a/bootstrap/complete → session activated, cookie set
 */
export function useA2ASession() {
  const { wallets, ready: walletsReady } = useWallets()
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)

  const bootstrap = useCallback(async (onPhase?: (phase: string) => void) => {
    if (!walletsReady || wallets.length === 0) {
      setError('No wallet connected')
      return null
    }

    const wallet = wallets[0]
    const provider = await wallet.getEthereumProvider()

    setBootstrapping(true)
    setError(null)

    try {
      // ─── Phase 1: Server prepares everything, returns delegation hash ─
      onPhase?.('bootstrapping-agent')
      const initRes = await fetch('/api/a2a/bootstrap/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}))
        throw new Error(err.error ?? 'Bootstrap init failed')
      }
      const {
        delegationHash,
        sessionId,
        delegation,
      } = await initRes.json()

      // ─── Phase 2: ONE MetaMask signature ────────────────────────
      onPhase?.('signing-delegation')
      const delegationSig = await provider.request({
        method: 'personal_sign',
        params: [delegationHash, wallet.address],
      }) as string

      // ─── Phase 3: Submit signature → session activated ──────────
      onPhase?.('bootstrapping-agent')
      const completeRes = await fetch('/api/a2a/bootstrap/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          delegationSignature: delegationSig,
          delegation,
        }),
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
  }, [wallets, walletsReady])

  return {
    sessionToken,
    bootstrapping,
    error,
    bootstrap,
    hasSession: !!sessionToken,
    refreshToken: (token?: string) => { if (token) setSessionToken(token) },
  }
}
