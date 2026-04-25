'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FRESH_LOGIN_INTENT_KEY } from '@/components/auth/AuthGate'

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

export function SignInClient() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [walletPending, startWallet] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  async function onSignIn() {
    setMsg(null)
    if (!window.PublicKeyCredential) { setMsg('WebAuthn is not available in this browser.'); return }

    start(async () => {
      try {
        const challResp = await fetch('/api/auth/passkey-challenge', { cache: 'no-store' })
        const { challenge, token } = await challResp.json() as { challenge: string; token: string }

        const challengeBytes = base64UrlDecode(challenge)
        const challengeAb = new ArrayBuffer(challengeBytes.length)
        new Uint8Array(challengeAb).set(challengeBytes)

        // Hint: pass any credentials we know about locally so the OS picker is narrower.
        const known = JSON.parse(localStorage.getItem('smart-agent.passkeys.local') ?? '[]') as Array<{ id: string; name: string }>
        const allowCredentials = known.map(k => ({
          type: 'public-key' as const,
          id: base64UrlDecode(k.id).buffer.slice(0) as ArrayBuffer,
        }))

        const cred = await navigator.credentials.get({
          publicKey: {
            challenge: challengeAb,
            rpId: window.location.hostname,
            userVerification: 'preferred',
            timeout: 60_000,
            allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
          },
        }) as PublicKeyCredential | null
        if (!cred) { setMsg('Cancelled.'); return }

        const resp = cred.response as AuthenticatorAssertionResponse
        const credentialIdBase64Url = base64UrlEncode(new Uint8Array(cred.rawId))
        const authData = base64UrlEncode(new Uint8Array(resp.authenticatorData))
        const cdj = base64UrlEncode(new Uint8Array(resp.clientDataJSON))
        const sig = base64UrlEncode(new Uint8Array(resp.signature))

        const verify = await fetch('/api/auth/passkey-verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: window.location.origin },
          body: JSON.stringify({
            token, challenge,
            credentialIdBase64Url,
            authenticatorDataBase64Url: authData,
            clientDataJSONBase64Url: cdj,
            signatureBase64Url: sig,
          }),
        })
        const body = await verify.json()
        if (!verify.ok || !body.success) {
          setMsg(`✗ ${body.error ?? verify.statusText}`)
          return
        }
        window.sessionStorage.setItem(FRESH_LOGIN_INTENT_KEY, 'true')
        window.location.href = '/catalyst'
      } catch (err) {
        setMsg(`✗ ${(err as Error).message}`)
      }
    })
  }

  async function onSiwe() {
    setMsg(null)
    const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum
    if (!eth) { setMsg('No injected wallet detected (install MetaMask, Rabby, Coinbase Wallet, …).'); return }

    startWallet(async () => {
      try {
        const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[]
        const address = accounts[0]
        if (!address) { setMsg('Wallet returned no accounts'); return }

        const r = await fetch(`/api/auth/siwe-challenge?domain=${encodeURIComponent(window.location.host)}&address=${address}`, { cache: 'no-store' })
        const { message, token } = await r.json() as { message: string; nonce: string; token: string }

        const signature = await eth.request({
          method: 'personal_sign',
          params: [message, address],
        }) as `0x${string}`

        const verify = await fetch('/api/auth/siwe-verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: window.location.origin },
          body: JSON.stringify({ token, message, signature, address }),
        })
        const body = await verify.json()
        if (!verify.ok || !body.success) {
          setMsg(`✗ ${body.error ?? verify.statusText}`)
          return
        }
        window.sessionStorage.setItem(FRESH_LOGIN_INTENT_KEY, 'true')
        window.location.href = '/catalyst'
      } catch (err) {
        setMsg(`✗ ${(err as Error).message}`)
      }
    })
  }

  return (
    <div>
      <button
        onClick={onSignIn}
        disabled={pending || walletPending}
        style={{
          padding: '0.7rem 1rem', background: '#3f6ee8', color: '#fff',
          borderRadius: 8, border: 0, fontWeight: 600, cursor: pending ? 'wait' : 'pointer',
        }}
        data-testid="signin-passkey"
      >
        {pending ? 'Signing in…' : 'Sign in with passkey'}
      </button>
      <button
        onClick={onSiwe}
        disabled={pending || walletPending}
        style={{
          marginLeft: 8,
          padding: '0.7rem 1rem', background: '#1f2937', color: '#fff',
          borderRadius: 8, border: 0, fontWeight: 600, cursor: walletPending ? 'wait' : 'pointer',
        }}
        data-testid="signin-siwe"
      >
        {walletPending ? 'Connecting…' : 'Sign in with Ethereum'}
      </button>
      <a
        href="/api/auth/google-start"
        style={{
          marginLeft: 8,
          display: 'inline-block',
          padding: '0.7rem 1rem', background: '#fff', color: '#1f2937',
          border: '1px solid #d1d5db', borderRadius: 8, fontWeight: 600,
          textDecoration: 'none',
        }}
        data-testid="signin-google"
      >
        Sign in with Google
      </a>
      {msg && <div style={{ marginTop: 12, fontSize: 13 }} data-testid="signin-msg">{msg}</div>}
      <div style={{ marginTop: 16, fontSize: 12, color: '#64748b' }}>
        Lost your device or passkey? <a href="/recover" style={{ color: '#3f6ee8' }} data-testid="signin-recover-link">Recover access</a>
      </div>
    </div>
  )
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  return new Uint8Array(atob(padded).split('').map(c => c.charCodeAt(0)))
}

function base64UrlEncode(b: Uint8Array): string {
  let bin = ''
  for (const x of b) bin += String.fromCharCode(x)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
