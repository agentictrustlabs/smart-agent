'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { parseAttestationObject } from '@smart-agent/sdk'
import { FRESH_LOGIN_INTENT_KEY } from '@/components/auth/AuthGate'

export function SignUpClient() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  async function onSignUp() {
    setMsg(null)
    if (!window.PublicKeyCredential) { setMsg('WebAuthn is not available in this browser.'); return }
    if (!name.trim()) { setMsg('Display name required.'); return }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32))
      const cred = await navigator.credentials.create({
        publicKey: {
          rp: { name: 'Smart Agent', id: window.location.hostname },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: name.trim(),
            displayName: name.trim(),
          },
          challenge,
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
          attestation: 'none',
          timeout: 60_000,
        },
      }) as PublicKeyCredential | null
      if (!cred) { setMsg('Cancelled.'); return }

      const resp = cred.response as AuthenticatorAttestationResponse
      const parsed = parseAttestationObject(new Uint8Array(resp.attestationObject))

      start(async () => {
        const r = await fetch('/api/auth/passkey-signup', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: window.location.origin },
          body: JSON.stringify({
            name: name.trim(),
            credentialIdBase64Url: parsed.credentialIdBase64Url,
            pubKeyX: parsed.pubKeyX.toString(),
            pubKeyY: parsed.pubKeyY.toString(),
          }),
        })
        const body = await r.json()
        if (!r.ok || !body.success) {
          setMsg(`✗ ${body.error ?? r.statusText}`)
          return
        }
        // Store credentialId locally so sign-in can offer it as a hint.
        const known = JSON.parse(localStorage.getItem('smart-agent.passkeys.local') ?? '[]') as Array<{ id: string; name: string }>
        known.push({ id: parsed.credentialIdBase64Url, name: name.trim() })
        localStorage.setItem('smart-agent.passkeys.local', JSON.stringify(known))
        // Trigger AuthGate post-login bootstrap.
        window.sessionStorage.setItem(FRESH_LOGIN_INTENT_KEY, 'true')
        // Hard navigation so the browser sends the freshly-set cookie and
        // we don't see a cached unauthenticated RSC payload.
        window.location.href = '/catalyst'
      })
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    }
  }

  return (
    <div>
      <label style={{ fontSize: 13, color: '#475569', display: 'block', marginBottom: 6 }}>Display name</label>
      <input
        value={name}
        onChange={e => setName(e.currentTarget.value)}
        placeholder="e.g. Jordan"
        style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #c7d0e8', borderRadius: 8, fontSize: 14 }}
        data-testid="signup-name"
      />
      <button
        onClick={onSignUp}
        disabled={pending}
        style={{
          marginTop: 16, width: '100%',
          padding: '0.7rem 1rem', background: '#3f6ee8', color: '#fff',
          borderRadius: 8, border: 0, fontWeight: 600,
          cursor: pending ? 'wait' : 'pointer',
        }}
        data-testid="signup-submit"
      >
        {pending ? 'Creating account…' : 'Sign up with passkey'}
      </button>
      <div style={{ marginTop: 12, fontSize: 12, color: '#64748b', textAlign: 'center' }}>or</div>
      <a
        href="/api/auth/google-start"
        style={{
          marginTop: 8, display: 'block', textAlign: 'center',
          padding: '0.7rem 1rem', background: '#fff', color: '#1f2937',
          border: '1px solid #d1d5db', borderRadius: 8, fontWeight: 600,
          textDecoration: 'none',
        }}
        data-testid="signup-google"
      >
        Continue with Google
      </a>
      {msg && <div style={{ marginTop: 12, fontSize: 13 }} data-testid="signup-msg">{msg}</div>}
    </div>
  )
}
