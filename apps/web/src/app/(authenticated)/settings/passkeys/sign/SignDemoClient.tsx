'use client'

import { useState, useTransition } from 'react'
import {
  prepareUserOpAction,
  submitPasskeySignedOpAction,
} from '@/lib/actions/passkey/sign-demo.action'
import { packWebAuthnSignature } from '@smart-agent/sdk'

const SIG_TYPE_WEBAUTHN = '01'

export function SignDemoClient({
  accountAddress,
  accountDeployed,
  passkeys,
}: {
  accountAddress: `0x${string}` | null
  accountDeployed: boolean
  passkeys: `0x${string}`[]
}) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)

  async function onSign() {
    setMsg(null); setTxHash(null)
    if (!window.PublicKeyCredential) { setMsg('WebAuthn is not available in this browser.'); return }
    if (passkeys.length === 0) { setMsg('No passkeys registered. Register one first.'); return }

    start(async () => {
      const prep = await prepareUserOpAction()
      if (!prep.success || !prep.userOp) { setMsg(`✗ prepare: ${prep.error}`); return }
      const { userOpHash } = prep.userOp

      // Ask the device to sign userOpHash. allowCredentials is "accept any
      // registered credential for this account" so the user just picks one.
      let assertion: PublicKeyCredential
      try {
        // Allocate a fresh ArrayBuffer so the TS BufferSource typing is satisfied.
        const challengeBytes = hexToBytes(userOpHash)
        const challengeAb = new ArrayBuffer(challengeBytes.length)
        new Uint8Array(challengeAb).set(challengeBytes)
        const got = await navigator.credentials.get({
          publicKey: {
            challenge: challengeAb,
            rpId: window.location.hostname,
            userVerification: 'preferred',
            timeout: 60_000,
          },
        }) as PublicKeyCredential | null
        if (!got) { setMsg('Cancelled.'); return }
        assertion = got
      } catch (err) {
        setMsg(`✗ navigator.credentials.get: ${(err as Error).message}`)
        return
      }

      const resp = assertion.response as AuthenticatorAssertionResponse
      const packed = packWebAuthnSignature({
        credentialIdBytes: new Uint8Array(assertion.rawId),
        authenticatorData: new Uint8Array(resp.authenticatorData),
        clientDataJSON: new Uint8Array(resp.clientDataJSON),
        derSignature: new Uint8Array(resp.signature),
      })
      const signature = ('0x' + SIG_TYPE_WEBAUTHN + packed.slice(2)) as `0x${string}`

      const sub = await submitPasskeySignedOpAction({ userOp: prep.userOp, signature })
      if (sub.success && sub.txHash) {
        setTxHash(sub.txHash)
        setMsg(`✓ UserOp landed — tx ${sub.txHash.slice(0, 10)}…`)
      } else {
        setMsg(`✗ submit: ${sub.error}`)
      }
    })
  }

  const disabled = !accountDeployed || passkeys.length === 0

  return (
    <div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
        Account: <code style={{ fontSize: 12 }}>{accountAddress ?? '—'}</code>{' '}
        · Registered passkeys: <strong>{passkeys.length}</strong>
      </div>
      <button
        onClick={onSign}
        disabled={disabled || pending}
        style={{
          padding: '0.55rem 1.1rem', background: '#3f6ee8', color: '#fff',
          borderRadius: 8, border: 0, fontWeight: 600,
          cursor: disabled || pending ? 'not-allowed' : 'pointer',
        }}
        data-testid="passkey-sign"
      >
        {pending ? 'Signing…' : 'Sign no-op UserOp with passkey'}
      </button>
      {msg && (
        <div
          style={{ marginTop: 12, fontSize: 13 }}
          data-testid={txHash ? 'passkey-sign-ok' : msg.startsWith('✗') ? 'passkey-sign-err' : 'passkey-sign-msg'}
        >
          {msg}
        </div>
      )}
      {disabled && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#92400e', background: '#fef3c7', padding: '0.55rem 0.8rem', borderRadius: 8, border: '1px solid #fcd34d' }}>
          {!accountDeployed
            ? 'Smart account not deployed yet — sign in first.'
            : 'Register a passkey at /settings/passkeys before signing.'}
        </div>
      )}
    </div>
  )
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16)
  return out
}
