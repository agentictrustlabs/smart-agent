'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { releaseTranche, requestReport } from '@/lib/actions/engagements/tranches.action'

const C = {
  accent: '#8b5e3c',
  text: '#5c4a3a', textMuted: '#9a8c7e',
  border: '#ece6db',
}

export function ReleaseTrancheButton({
  engagementId,
  trancheIdx,
  amountDollars,
}: {
  engagementId: string
  trancheIdx: number
  amountDollars: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
      <button
        type="button"
        onClick={() => {
          setErr(null)
          start(async () => {
            const r = await releaseTranche({ engagementId, trancheIdx })
            if ('error' in r) setErr(r.error)
            else router.refresh()
          })
        }}
        disabled={pending}
        style={{
          padding: '0.5rem 1rem',
          background: C.accent, color: '#fff',
          border: 'none', borderRadius: 8,
          fontSize: '0.82rem', fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {pending ? 'Releasing…' : `💰 Release $${amountDollars.toLocaleString()}`}
      </button>
      {err && <div style={{ fontSize: '0.7rem', color: '#991b1b' }}>{err}</div>}
    </div>
  )
}

export function RequestReportButton({
  engagementId,
  trancheIdx,
}: {
  engagementId: string
  trancheIdx: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErr(null)
          start(async () => {
            const r = await requestReport({ engagementId, trancheIdx })
            if ('error' in r) setErr(r.error)
            else router.refresh()
          })
        }}
        disabled={pending}
        style={{
          padding: '0.4rem 0.85rem',
          background: '#fff', color: C.accent,
          border: `1px solid ${C.accent}`, borderRadius: 8,
          fontSize: '0.78rem', fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {pending ? 'Requesting…' : 'Request report'}
      </button>
      {err && <span style={{ fontSize: '0.7rem', color: '#991b1b', marginLeft: '0.5rem' }}>{err}</span>}
    </>
  )
}
