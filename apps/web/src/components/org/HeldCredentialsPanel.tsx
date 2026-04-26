'use client'

import { useState, useTransition } from 'react'
import { walletStatusAction, type CredentialRow } from '@/lib/actions/ssi/list.action'

/**
 * Collapsible panel that lists AnonCreds credentials held in the user's
 * SSI wallet (ssi-wallet-mcp). Hidden by default — clicking "Show held
 * credentials" gates the load with an explicit user action so the wallet
 * isn't queried on every dashboard render.
 *
 * Surfaced under "My Organizations" on the hub home so members can see
 * their privately-held memberships alongside their on-chain org links.
 */
export function HeldCredentialsPanel() {
  const [open, setOpen] = useState(false)
  const [creds, setCreds] = useState<CredentialRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (creds) return // already loaded
    start(async () => {
      try {
        const status = await walletStatusAction()
        if (status.error) { setErr(status.error); return }
        setCreds(status.credentials)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load credentials')
      }
    })
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'transparent', border: 'none',
          color: '#3f6ee8', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', padding: '0.25rem 0',
        }}
        data-testid="held-creds-toggle"
      >
        <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        {open ? 'Hide held credentials' : 'Show held credentials'}
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          {pending && <div style={{ fontSize: 12, color: '#94a3b8' }}>Loading…</div>}
          {err && (
            <div role="alert" style={{
              padding: '0.4rem 0.6rem', background: '#fef2f2',
              border: '1px solid #fecaca', color: '#b91c1c',
              borderRadius: 6, fontSize: 12,
            }}>{err}</div>
          )}
          {!pending && !err && creds && creds.length === 0 && (
            <div style={{ fontSize: 12, color: '#64748b' }}>
              No held credentials yet. Use <b>+ Anonymous registration</b> in the dropdown
              to receive one.
            </div>
          )}
          {!pending && !err && creds && creds.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {creds.map(c => (
                <div
                  key={c.id}
                  style={{
                    padding: '0.55rem 0.7rem',
                    border: '1px solid #e5e7eb', borderRadius: 8,
                    background: '#fafbfc', fontSize: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, color: '#171c28' }}>{c.credentialType}</span>
                    {c.anchored === true && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                        textTransform: 'uppercase', color: '#15803d',
                        background: '#dcfce7', padding: '1px 6px', borderRadius: 999,
                      }}>anchored</span>
                    )}
                    {c.anchored === false && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                        textTransform: 'uppercase', color: '#92400e',
                        background: '#fef3c7', padding: '1px 6px', borderRadius: 999,
                      }}>unanchored</span>
                    )}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>
                    issuer <code style={{ fontSize: 10 }}>{c.issuerId.slice(0, 28)}{c.issuerId.length > 28 ? '…' : ''}</code>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>
                    received {new Date(c.receivedAt).toLocaleString()} · context {c.walletContext}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
