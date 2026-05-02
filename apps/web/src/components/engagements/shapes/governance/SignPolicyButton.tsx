'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signPolicy } from '@/lib/actions/engagements/policy.action'

export function SignPolicyButton({
  engagementId,
}: {
  engagementId: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={() => {
          setErr(null)
          start(async () => {
            const r = await signPolicy({ engagementId })
            if ('error' in r) setErr(r.error)
            else router.refresh()
          })
        }}
        disabled={pending}
        style={{
          padding: '0.5rem 1.1rem',
          background: '#8b5e3c', color: '#fff',
          border: 'none', borderRadius: 8,
          fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
        }}
      >
        {pending ? 'Signing…' : '✍ Sign'}
      </button>
      {err && <span style={{ fontSize: '0.7rem', color: '#991b1b' }}>{err}</span>}
    </div>
  )
}
