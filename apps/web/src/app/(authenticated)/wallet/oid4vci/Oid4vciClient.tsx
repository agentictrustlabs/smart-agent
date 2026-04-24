'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { redeemOid4vciOfferAction } from '@/lib/actions/ssi/oid4vci-redeem.action'

export function Oid4vciClient() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div>
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
            const r = await redeemOid4vciOfferAction({ input: value.trim() })
            setMsg(r.success ? `✓ credential ${r.credentialId} delivered` : `✗ ${r.error}`)
            if (r.success) router.refresh()
          })}
          style={{
            padding: '0.55rem 1rem', background: '#3f6ee8', color: '#fff',
            borderRadius: 8, border: 0, cursor: pending ? 'wait' : 'pointer', fontWeight: 600,
          }}
        >
          {pending ? 'Redeeming…' : 'Redeem'}
        </button>
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 13 }}>{msg}</div>}
    </div>
  )
}
