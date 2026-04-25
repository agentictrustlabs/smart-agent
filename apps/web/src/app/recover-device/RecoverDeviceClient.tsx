'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { parseAttestationObject } from '@smart-agent/sdk'
import {
  proposeRecoveryAction,
  completeRecoveryAction,
} from '@/lib/actions/recovery/recovery.action'
import { FRESH_LOGIN_INTENT_KEY } from '@/components/auth/AuthGate'

type Phase = 'idle' | 'proposing' | 'waiting' | 'completing' | 'done' | 'error'

export function RecoverDeviceClient() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [intentHash, setIntentHash] = useState<`0x${string}` | null>(null)
  const [readyAt, setReadyAt] = useState<number | null>(null)
  const [now, setNow] = useState(Math.floor(Date.now() / 1000))
  const [credId, setCredId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [sessionChecked, setSessionChecked] = useState(false)

  // Gate the page on a valid Google session; if the user landed here directly
  // (no OAuth round-trip), bounce them to /recover so they pick a path first.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch('/api/auth/session', { cache: 'no-store' })
        const body = await r.json() as { user?: { via?: string } | null }
        if (cancelled) return
        if (!body.user || body.user.via !== 'google') {
          router.replace('/recover')
          return
        }
      } catch {
        if (!cancelled) router.replace('/recover')
        return
      }
      if (!cancelled) setSessionChecked(true)
    })()
    return () => { cancelled = true }
  }, [router])

  // Tick the clock once a second while we're waiting on the timelock.
  useEffect(() => {
    if (phase !== 'waiting') return
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [phase])

  const remaining = readyAt && phase === 'waiting' ? Math.max(0, readyAt - now) : 0

  async function onPropose() {
    setMsg(null)
    if (!window.PublicKeyCredential) { setMsg('WebAuthn unavailable in this browser.'); return }
    start(async () => {
      try {
        setPhase('proposing')
        const meRes = await fetch('/api/auth/session', { cache: 'no-store' })
        const me = await meRes.json() as { user?: { name?: string; email?: string | null } | null }
        const displayName = me.user?.name ?? 'Smart Agent User'
        const email = me.user?.email ?? 'user'

        const challenge = crypto.getRandomValues(new Uint8Array(32))
        const cred = await navigator.credentials.create({
          publicKey: {
            rp: { name: 'Smart Agent', id: window.location.hostname },
            user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email, displayName },
            challenge,
            // -7 = ES256 (what we use); -257 = RS256 is here only to silence
            // Chrome's "missing default algorithm" dev warning. The
            // authenticator picks ES256 first; RS256 never wins selection.
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
            attestation: 'none', timeout: 60_000,
          },
        }) as PublicKeyCredential | null
        if (!cred) { setPhase('idle'); setMsg('Cancelled.'); return }
        const parsed = parseAttestationObject(new Uint8Array((cred.response as AuthenticatorAttestationResponse).attestationObject))

        const result = await proposeRecoveryAction({
          credentialIdBase64Url: parsed.credentialIdBase64Url,
          pubKeyX: parsed.pubKeyX.toString(),
          pubKeyY: parsed.pubKeyY.toString(),
        })
        if (!result.success || !result.intentHash || !result.readyAt) {
          setPhase('error'); setMsg(`✗ ${result.error ?? 'Propose failed.'}`); return
        }

        setIntentHash(result.intentHash)
        setReadyAt(result.readyAt)
        setCredId(parsed.credentialIdBase64Url)
        setPhase('waiting')
      } catch (err) {
        setPhase('error'); setMsg(`✗ ${(err as Error).message}`)
      }
    })
  }

  async function onComplete() {
    if (!intentHash || !credId) return
    setMsg(null)
    start(async () => {
      try {
        setPhase('completing')
        const result = await completeRecoveryAction({ intentHash })
        if (!result.success) {
          setPhase('error'); setMsg(`✗ ${result.error ?? 'Recovery failed.'}`); return
        }
        // Persist credential id locally so future sign-ins can hint allowCredentials.
        const known = JSON.parse(localStorage.getItem('smart-agent.passkeys.local') ?? '[]') as Array<{ id: string; name: string }>
        known.push({ id: credId, name: 'Recovered device' })
        localStorage.setItem('smart-agent.passkeys.local', JSON.stringify(known))
        window.sessionStorage.setItem(FRESH_LOGIN_INTENT_KEY, 'true')
        setPhase('done')
        router.replace('/catalyst')
      } catch (err) {
        setPhase('error'); setMsg(`✗ ${(err as Error).message}`)
      }
    })
  }

  if (!sessionChecked) {
    return <div style={{ color: '#64748b', fontSize: 13 }}>Checking your Google session…</div>
  }

  return (
    <div>
      {(phase === 'idle' || phase === 'proposing' || phase === 'error') && (
        <button
          onClick={onPropose}
          disabled={pending}
          style={{
            width: '100%', padding: '0.75rem 1rem', background: '#3f6ee8', color: '#fff',
            border: 0, borderRadius: 8, fontWeight: 600, cursor: pending ? 'wait' : 'pointer',
          }}
          data-testid="recover-propose"
        >
          {phase === 'proposing' ? 'Proposing recovery…' : 'Start recovery'}
        </button>
      )}

      {phase === 'waiting' && (
        <div>
          <div style={{ background: '#f0f4ff', border: '1px solid #c7d0e8', borderRadius: 8, padding: '1rem', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Recovery proposed.</div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              {remaining > 0
                ? `Timelock active. ${remaining}s remaining before your new passkey can be activated.`
                : 'Timelock elapsed — you can complete recovery now.'}
            </div>
          </div>
          <button
            onClick={onComplete}
            disabled={pending || remaining > 0}
            style={{
              width: '100%', padding: '0.75rem 1rem',
              background: remaining > 0 ? '#cbd5e1' : '#10b981',
              color: '#fff', border: 0, borderRadius: 8, fontWeight: 600,
              cursor: pending || remaining > 0 ? 'not-allowed' : 'pointer',
            }}
            data-testid="recover-complete"
          >
            {pending ? 'Activating…' : remaining > 0 ? `Wait ${remaining}s` : 'Complete recovery'}
          </button>
        </div>
      )}

      {phase === 'done' && <div style={{ color: '#10b981', fontSize: 14 }}>Recovery complete. Redirecting…</div>}

      {msg && <div style={{ marginTop: 12, fontSize: 13 }} data-testid="recover-msg">{msg}</div>}
    </div>
  )
}
