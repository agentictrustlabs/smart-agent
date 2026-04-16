'use client'

import { useState, useCallback } from 'react'
import { useWallets } from '@privy-io/react-auth'

const A2A_SESSION_COOKIE = 'a2a-session'

function getTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)a2a-session=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Client-side A2A session management for Privy/MetaMask users.
 *
 * Flow:
 *   1. POST /api/a2a/bootstrap/client → get challenge hash
 *   2. MetaMask signs challenge hash (popup)
 *   3. POST /api/a2a/bootstrap/complete (with challenge sig) → get delegation hash
 *   4. MetaMask signs delegation hash (popup)
 *   5. POST /api/a2a/bootstrap/complete (with delegation sig) → session activated
 *
 * Two MetaMask signature prompts: one for auth, one for delegation.
 */
export function useA2ASession() {
  const { wallets, ready: walletsReady } = useWallets()
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(getTokenFromCookie)

  const bootstrap = useCallback(async () => {
    if (!walletsReady || wallets.length === 0) {
      setError('No wallet connected')
      return null
    }

    const wallet = wallets[0]
    const provider = await wallet.getEthereumProvider()

    setBootstrapping(true)
    setError(null)

    try {
      // ─── Phase 1: Get challenge hash to sign ────────────────────
      const initRes = await fetch('/api/a2a/bootstrap/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: wallet.address }),
      })
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}))
        throw new Error(err.error ?? 'Init failed')
      }
      const { challengeId, challengeHash, accountAddress } = await initRes.json()

      // ─── Phase 2: Sign challenge with MetaMask ──────────────────
      const challengeSig = await provider.request({
        method: 'personal_sign',
        params: [challengeHash, wallet.address],
      }) as string

      // ─── Phase 3: Submit challenge sig → get delegation hash ────
      const phase2Res = await fetch('/api/a2a/bootstrap/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          challengeSignature: challengeSig,
          accountAddress,
        }),
      })
      if (!phase2Res.ok) {
        const err = await phase2Res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Challenge verification failed')
      }
      const phase2Data = await phase2Res.json()

      if (!phase2Data.needsDelegationSignature) {
        // Session already active (shouldn't happen, but handle it)
        document.cookie = `${A2A_SESSION_COOKIE}=${phase2Data.sessionToken}; path=/; max-age=${60 * 60 * 24}`
        setSessionToken(phase2Data.sessionToken)
        setBootstrapping(false)
        return phase2Data.sessionToken
      }

      // ─── Phase 4: Sign delegation with MetaMask ─────────────────
      const delegationSig = await provider.request({
        method: 'personal_sign',
        params: [phase2Data.delegationHash, wallet.address],
      }) as string

      // ─── Phase 5: Submit delegation sig → session activated ─────
      const phase3Res = await fetch('/api/a2a/bootstrap/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: phase2Data.sessionToken,
          sessionId: phase2Data.sessionId,
          delegationSignature: delegationSig,
          delegation: phase2Data.delegation,
          accountAddress,
        }),
      })
      if (!phase3Res.ok) {
        const err = await phase3Res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Delegation submission failed')
      }
      const { sessionToken: token } = await phase3Res.json()

      // Store in cookie
      document.cookie = `${A2A_SESSION_COOKIE}=${token}; path=/; max-age=${60 * 60 * 24}`
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
    refreshToken: () => setSessionToken(getTokenFromCookie()),
  }
}
