'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { parseAttestationObject } from '@smart-agent/sdk'
import type { ListPasskeysResult, RegisteredPasskey } from '@/lib/actions/passkey/list.action'
import { registerPasskeyAction } from '@/lib/actions/passkey/register.action'
import { removePasskeyAction } from '@/lib/actions/passkey/remove.action'

export function PasskeysClient({ initial }: { initial: ListPasskeysResult }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const passkeys: RegisteredPasskey[] = initial.passkeys

  async function onRegister() {
    setMsg(null)
    if (!window.PublicKeyCredential) {
      setMsg('WebAuthn is not available in this browser.')
      return
    }
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32))
      const cred = await navigator.credentials.create({
        publicKey: {
          rp: { name: 'Smart Agent', id: window.location.hostname },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: label || 'smart-agent-demo',
            displayName: label || 'Smart Agent Demo',
          },
          challenge,
          // ES256 only — smart-account verifier is P-256. RS256 keys
          // can't validate on chain.
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred',
          },
          attestation: 'none',
          timeout: 60_000,
        },
      }) as PublicKeyCredential | null
      if (!cred) { setMsg('Cancelled.'); return }

      const resp = cred.response as AuthenticatorAttestationResponse
      const attestationObject = new Uint8Array(resp.attestationObject)
      const parsed = parseAttestationObject(attestationObject)

      start(async () => {
        const r = await registerPasskeyAction({
          credentialIdBase64Url: parsed.credentialIdBase64Url,
          label: label || 'Untitled passkey',
          pubKeyX: parsed.pubKeyX.toString(),
          pubKeyY: parsed.pubKeyY.toString(),
        })
        if (r.success) {
          // Store the label + credentialId locally so sign-in can offer it.
          const key = `smart-agent.passkeys.${(initial.accountAddress ?? 'unknown').toLowerCase()}`
          const stored = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ id: string; label: string; digest: string }>
          stored.push({ id: parsed.credentialIdBase64Url, label: label || 'Untitled passkey', digest: r.credentialIdDigest ?? '' })
          localStorage.setItem(key, JSON.stringify(stored))
          setMsg(`✓ Registered (tx ${r.txHash?.slice(0, 10)}…)`)
          setLabel('')
          router.refresh()
        } else {
          setMsg(`✗ ${r.error}`)
        }
      })
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    }
  }

  function onRemove(digest: `0x${string}`) {
    setMsg(null)
    start(async () => {
      const r = await removePasskeyAction({ credentialIdDigest: digest })
      if (r.success) {
        const key = `smart-agent.passkeys.${(initial.accountAddress ?? 'unknown').toLowerCase()}`
        const stored = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ id: string; label: string; digest: string }>
        localStorage.setItem(key, JSON.stringify(stored.filter(s => s.digest.toLowerCase() !== digest.toLowerCase())))
        setMsg(`✓ Removed (tx ${r.txHash?.slice(0, 10)}…)`)
        router.refresh()
      } else {
        setMsg(`✗ ${r.error}`)
      }
    })
  }

  const disabled = !initial.accountDeployed

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <input
          value={label}
          onChange={e => setLabel(e.currentTarget.value)}
          placeholder="Label (e.g. 'MacBook Touch ID')"
          style={{
            flex: 1, padding: '0.55rem 0.75rem', border: '1px solid #c7d0e8',
            borderRadius: 8, fontSize: 13,
          }}
          disabled={disabled || pending}
          data-testid="passkey-label"
        />
        <button
          onClick={onRegister}
          disabled={disabled || pending}
          style={{
            padding: '0.55rem 1rem', background: '#3f6ee8', color: '#fff',
            borderRadius: 8, border: 0, cursor: disabled || pending ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          data-testid="passkey-register"
        >
          {pending ? 'Working…' : 'Register passkey'}
        </button>
      </div>

      {passkeys.length === 0 ? (
        <div style={{ fontSize: 13, color: '#64748b', padding: '0.75rem 0' }}>No passkeys registered yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '0.45rem 0' }}>Credential digest</th>
              <th style={{ padding: '0.45rem 0' }}>Block</th>
              <th style={{ padding: '0.45rem 0' }}>Tx</th>
              <th style={{ padding: '0.45rem 0' }}></th>
            </tr>
          </thead>
          <tbody>
            {passkeys.map(pk => (
              <tr key={pk.credentialIdDigest} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.45rem 0', fontFamily: 'monospace' }}>
                  {pk.credentialIdDigest.slice(0, 10)}…{pk.credentialIdDigest.slice(-6)}
                </td>
                <td style={{ padding: '0.45rem 0' }}>{pk.blockNumber}</td>
                <td style={{ padding: '0.45rem 0', fontFamily: 'monospace' }}>
                  {pk.transactionHash.slice(0, 10)}…
                </td>
                <td style={{ padding: '0.45rem 0' }}>
                  <button
                    onClick={() => onRemove(pk.credentialIdDigest)}
                    disabled={pending}
                    style={{
                      padding: '0.25rem 0.6rem', background: '#fef2f2', color: '#b91c1c',
                      border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    }}
                    data-testid={`passkey-remove-${pk.credentialIdDigest}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {msg && <div style={{ marginTop: 10, fontSize: 13 }}>{msg}</div>}

      {disabled && (
        <div style={{ marginTop: 12, padding: '0.55rem 0.8rem', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
          Your smart account isn't deployed yet. Sign in at <code>/</code> so boot-seed can deploy it, then return here.
        </div>
      )}
    </div>
  )
}
