'use client'

import { useState, useCallback } from 'react'
import { packWebAuthnSignature } from '@smart-agent/sdk'

/**
 * Client-side A2A session bootstrap.
 *
 * Two signers are supported, both validated by the smart account's
 * ERC-1271 isValidSignature path:
 *
 *   - bootstrap()           — injected EIP-1193 wallet (MetaMask/Rabby/etc).
 *                             Validates the EOA against the smart account's
 *                             owner set.
 *   - bootstrapWithPasskey() — WebAuthn / passkey. Wraps the assertion with
 *                              the 0x01 type byte; AgentAccount's WebAuthn
 *                              path validates the P-256 signature against
 *                              registered passkeys.
 *
 * Flow (identical for both):
 *   1. POST /api/a2a/bootstrap/client → server prepares delegation, returns hash
 *   2. Sign the hash (wallet popup OR passkey prompt — exactly ONE)
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

async function initBootstrap(): Promise<{
  delegationHash: string
  sessionId: string
  delegation: unknown
  accountAddress: string
}> {
  const initRes = await fetch('/api/a2a/bootstrap/client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}))
    throw new Error(err.error ?? 'Bootstrap init failed')
  }
  return initRes.json()
}

async function completeBootstrap(args: {
  sessionId: string
  delegation: unknown
  delegationSignature: string
}): Promise<string> {
  const res = await fetch('/api/a2a/bootstrap/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? 'Session activation failed')
  }
  const { sessionToken } = await res.json()
  return sessionToken
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
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
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[]
      const userAddress = accounts[0]
      if (!userAddress) throw new Error('Wallet returned no accounts')

      onPhase?.('bootstrapping-agent')
      const { delegationHash, sessionId, delegation } = await initBootstrap()

      onPhase?.('signing-delegation')
      const delegationSig = await provider.request({
        method: 'personal_sign',
        params: [delegationHash, userAddress],
      }) as string

      onPhase?.('bootstrapping-agent')
      const token = await completeBootstrap({ sessionId, delegation, delegationSignature: delegationSig })
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

  /**
   * Sign the delegation with a WebAuthn passkey registered on the smart
   * account. The packed signature is tagged with `0x01` so AgentAccount's
   * ERC-1271 path takes the WebAuthn validation branch (P-256 verify
   * against the credential's stored pubkey).
   */
  const bootstrapWithPasskey = useCallback(async (onPhase?: (phase: string) => void) => {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) {
      setError('Passkey signing not available in this browser.')
      return null
    }

    setBootstrapping(true)
    setError(null)
    try {
      onPhase?.('bootstrapping-agent')
      const { delegationHash, sessionId, delegation } = await initBootstrap()

      onPhase?.('signing-delegation')
      // Constrain the OS picker to passkeys actually registered on the
      // CURRENT user's account. Login is name-based — there's no server-
      // side credential mapping anymore — so we filter localStorage by
      // the user's .agent name (the `name` field stored at signup time).
      // Without this filter the picker would offer every passkey ever
      // registered on this browser and the user could pick one whose
      // digest isn't in this account's _passkeys → ERC-1271 rejects.
      let userName: string | null = null
      try {
        const r = await fetch('/api/auth/session', { cache: 'no-store' })
        const body = await r.json() as { user: { name?: string } | null }
        userName = body.user?.name ?? null
      } catch { /* */ }
      const localHint = JSON.parse(localStorage.getItem('smart-agent.passkeys.local') ?? '[]') as Array<{ id: string; name?: string }>
      const matched = userName ? localHint.filter(h => h.name === userName) : []
      const ids = matched.length > 0 ? matched.map(h => h.id) : []
      const allowCredentials = ids.length > 0
        ? ids.map(id => {
            const idBytes = base64UrlDecode(id)
            const idAb = new ArrayBuffer(idBytes.length)
            new Uint8Array(idAb).set(idBytes)
            return { type: 'public-key' as const, id: idAb }
          })
        : undefined

      const challengeBytes = hexToBytes(delegationHash)
      const challengeAb = new ArrayBuffer(challengeBytes.length)
      new Uint8Array(challengeAb).set(challengeBytes)

      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: challengeAb,
          rpId: window.location.hostname,
          userVerification: 'preferred',
          timeout: 60_000,
          allowCredentials,
        },
      }) as PublicKeyCredential | null
      if (!cred) throw new Error('Cancelled')

      const resp = cred.response as AuthenticatorAssertionResponse
      const passkeySig = packWebAuthnSignature({
        credentialIdBytes: new Uint8Array(cred.rawId),
        authenticatorData: new Uint8Array(resp.authenticatorData),
        clientDataJSON: new Uint8Array(resp.clientDataJSON),
        derSignature: new Uint8Array(resp.signature),
      })
      // Tag with WebAuthn type byte so AgentAccount's _validateSig dispatches
      // to the passkey verification path. Same wrapping used by Phase-3
      // re-auth UserOps.
      const taggedSig = ('0x01' + passkeySig.slice(2)) as `0x${string}`

      onPhase?.('bootstrapping-agent')
      const token = await completeBootstrap({ sessionId, delegation, delegationSignature: taggedSig })
      setSessionToken(token)
      setBootstrapping(false)
      return token
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Passkey bootstrap failed'
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
    bootstrapWithPasskey,
    hasSession: !!sessionToken,
    refreshToken: (token?: string) => { if (token) setSessionToken(token) },
  }
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
