'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { redeemOid4vciOfferAction } from '@/lib/actions/ssi/oid4vci-redeem.action'

export function Oid4vciClient({
  availableContexts, activeContext,
}: {
  availableContexts: string[]
  activeContext: string
}) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [ctx, setCtx] = useState(activeContext)
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
        padding: '0.55rem 0.9rem', background: '#f1f5f9',
        border: '1px solid #e2e8f0', borderRadius: 8,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>
          Deliver credential into wallet context:
        </span>
        <select
          value={ctx}
          onChange={e => {
            setCtx(e.currentTarget.value)
            router.push(`/wallet/oid4vci?context=${encodeURIComponent(e.currentTarget.value)}`)
          }}
          style={{
            padding: '0.35rem 0.55rem', border: '1px solid #c7d0e8',
            borderRadius: 6, fontSize: 13,
          }}
        >
          {availableContexts.map(c => (<option key={c} value={c}>{c}</option>))}
        </select>
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        placeholder="Paste a credential_offer_uri (base64url) or a pre-authorized_code (pac_…) from the admin page"
        rows={4}
        style={{
          width: '100%', padding: '0.6rem', border: '1px solid #c7d0e8',
          borderRadius: 8, fontSize: 12, fontFamily: 'monospace',
        }}
      />
      <div style={{ marginTop: 10 }}>
        <button
          disabled={pending || value.trim().length < 8}
          onClick={() => start(async () => {
            setMsg(null)
            const r = await redeemOid4vciOfferAction({ input: value.trim(), walletContext: ctx })
            setMsg(r.success
              ? `✓ credential ${r.credentialId} delivered to "${ctx}"`
              : `✗ ${r.error}`)
            if (r.success) router.refresh()
          })}
          data-testid="oid4vci-redeem"
          style={{
            padding: '0.55rem 1rem', background: '#3f6ee8', color: '#fff',
            borderRadius: 8, border: 0, cursor: pending ? 'wait' : 'pointer', fontWeight: 600,
          }}
        >
          {pending ? 'Redeeming…' : `Redeem into "${ctx}"`}
        </button>
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 13 }}>{msg}</div>}
    </div>
  )
}
