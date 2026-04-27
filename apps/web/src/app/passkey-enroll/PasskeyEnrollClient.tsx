'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { parseAttestationObject, packWebAuthnSignature } from '@smart-agent/sdk'
import {
  enrollOAuthAddPasskeyAction,
  enrollOAuthFinalizeAction,
} from '@/lib/actions/passkey/enroll-oauth.action'
import { FRESH_LOGIN_INTENT_KEY } from '@/components/auth/AuthGate'

/**
 * Browser-side wrapper around the two-step OAuth enrollment.
 *
 * Step A — addPasskey + recovery delegation prep:
 *   1. navigator.credentials.create() → fresh P-256 passkey
 *   2. enrollOAuthAddPasskeyAction → server fires `addPasskey` UserOp signed
 *      by the bootstrap server, builds a recovery delegation, returns the
 *      delegation EIP-712 hash.
 *
 * Step B — sign delegation + remove bootstrap server:
 *   3. navigator.credentials.get(challenge=delegationHash, allowCredentials=[newCredId])
 *      → WebAuthn assertion signed by the just-enrolled passkey
 *   4. Pack as 0x01 || abi.encode(Assertion) and POST to enrollOAuthFinalizeAction
 *      → server stores the signed delegation, fires `removeOwner(serverEOA)`.
 *
 * After both steps land, the smart account is non-custodial: only the user's
 * passkey can sign normal UserOps; the server holds a guardian-gated recovery
 * delegation for cross-device recovery (Phase 3).
 */
export function PasskeyEnrollClient() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  async function onEnroll() {
    setMsg(null)
    if (typeof window === 'undefined') return
    if (!window.PublicKeyCredential) { setMsg('WebAuthn is not available in this browser.'); return }

    start(async () => {
      try {
        const meRes = await fetch('/api/auth/session', { cache: 'no-store' })
        const meBody = await meRes.json() as { user?: { name?: string; email?: string | null } | null }
        const displayName = meBody.user?.name ?? 'Smart Agent User'
        const email = meBody.user?.email ?? 'user'

        // ─── Step 1: register a new passkey ─────────────────────────
        const challenge = crypto.getRandomValues(new Uint8Array(32))
        const cred = await navigator.credentials.create({
          publicKey: {
            rp: { name: 'Smart Agent', id: window.location.hostname },
            user: {
              id: crypto.getRandomValues(new Uint8Array(16)),
              name: email,
              displayName,
            },
            challenge,
            // ES256 only — the chain account verifies P-256. RS256 keys
            // can't validate on chain.
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
            attestation: 'none',
            timeout: 60_000,
          },
        }) as PublicKeyCredential | null
        if (!cred) { setMsg('Cancelled.'); return }

        const attResp = cred.response as AuthenticatorAttestationResponse
        const parsed = parseAttestationObject(new Uint8Array(attResp.attestationObject))

        // ─── Step 2: server adds passkey + builds recovery delegation ─
        setMsg('Registering passkey on-chain…')
        const step1 = await enrollOAuthAddPasskeyAction({
          credentialIdBase64Url: parsed.credentialIdBase64Url,
          pubKeyX: parsed.pubKeyX.toString(),
          pubKeyY: parsed.pubKeyY.toString(),
        })
        if (!step1.success) { setMsg(`✗ ${step1.error ?? 'Add-passkey failed.'}`); return }

        // If recovery isn't deployed, we got success without delegation; skip
        // the rest of the dance and just persist the local hint.
        if (!step1.delegation || !step1.delegationHash) {
          finishEnrollment(parsed.credentialIdBase64Url, displayName)
          return
        }

        // ─── Step 3: passkey signs the delegation hash ───────────────
        setMsg('Signing recovery delegation with your passkey…')
        const challengeBytes = hexToBytes(step1.delegationHash)
        const challengeAb = new ArrayBuffer(challengeBytes.length)
        new Uint8Array(challengeAb).set(challengeBytes)
        const credIdBytes = base64UrlDecode(parsed.credentialIdBase64Url)
        const credIdAb = new ArrayBuffer(credIdBytes.length)
        new Uint8Array(credIdAb).set(credIdBytes)

        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge: challengeAb,
            rpId: window.location.hostname,
            userVerification: 'preferred',
            timeout: 60_000,
            allowCredentials: [{ type: 'public-key', id: credIdAb }],
          },
        }) as PublicKeyCredential | null
        if (!assertion) { setMsg('Cancelled before recovery delegation was signed.'); return }

        const assResp = assertion.response as AuthenticatorAssertionResponse
        const passkeySig = packWebAuthnSignature({
          credentialIdBytes: new Uint8Array(assertion.rawId),
          authenticatorData: new Uint8Array(assResp.authenticatorData),
          clientDataJSON: new Uint8Array(assResp.clientDataJSON),
          derSignature: new Uint8Array(assResp.signature),
        })
        // Prefix the WebAuthn type byte for the AgentAccount _validateSig dispatcher.
        const delegationSig = ('0x01' + passkeySig.slice(2)) as `0x${string}`

        // ─── Step 4: server stores delegation + removes bootstrap owner ─
        setMsg('Removing bootstrap server from your account…')
        const step2 = await enrollOAuthFinalizeAction({
          delegation: step1.delegation,
          delegationSignature: delegationSig,
          delegationHash: step1.delegationHash,
        })
        if (!step2.success) { setMsg(`✗ ${step2.error ?? 'Finalisation failed.'}`); return }

        finishEnrollment(parsed.credentialIdBase64Url, displayName)
      } catch (err) {
        setMsg(`✗ ${(err as Error).message}`)
      }
    })
  }

  function finishEnrollment(credentialIdBase64Url: string, displayName: string) {
    const known = JSON.parse(localStorage.getItem('smart-agent.passkeys.local') ?? '[]') as Array<{ id: string; name: string }>
    known.push({ id: credentialIdBase64Url, name: displayName })
    localStorage.setItem('smart-agent.passkeys.local', JSON.stringify(known))
    window.sessionStorage.setItem(FRESH_LOGIN_INTENT_KEY, 'true')
    router.replace('/dashboard')
  }

  return (
    <div>
      <button
        onClick={onEnroll}
        disabled={pending}
        style={{
          width: '100%', padding: '0.75rem 1rem', background: '#3f6ee8', color: '#fff',
          border: 0, borderRadius: 8, fontWeight: 600, cursor: pending ? 'wait' : 'pointer',
        }}
        data-testid="passkey-enroll-submit"
      >
        {pending ? 'Working…' : 'Add a passkey'}
      </button>
      <button
        onClick={() => router.replace('/dashboard')}
        disabled={pending}
        style={{
          width: '100%', marginTop: 8, padding: '0.6rem 1rem', background: 'transparent',
          color: '#64748b', border: 'none', fontSize: 13, cursor: 'pointer',
        }}
      >
        Skip for now
      </button>
      {msg && <div style={{ marginTop: 12, fontSize: 13 }} data-testid="passkey-enroll-msg">{msg}</div>}
    </div>
  )
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
