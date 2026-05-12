'use client'

/**
 * Spec 005 — Dev-only "Fund treasury" button. Wraps POST /api/treasury/fund
 * which delegates to fundLocalTreasury (chainId === 31337 guard).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const C = { accent: '#8b5e3c', danger: '#dc2626', muted: '#64748b' }

export function FundTreasuryButton({ smartAccountAddress }: { smartAccountAddress: `0x${string}` }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null)

  function topUp() {
    setMsg(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/treasury/fund', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ smartAccountAddress }),
        })
        const data = await res.json() as { ok: boolean; newBalance?: string; error?: string }
        if (!res.ok || !data.ok) {
          setMsg({ kind: 'err', text: data.error ?? `fund failed (${res.status})` })
          return
        }
        setMsg({ kind: 'ok', text: 'Topped up to 100k USDC' })
        router.refresh()
      } catch (e) {
        setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
      <button
        type="button"
        onClick={topUp}
        disabled={pending}
        style={{
          padding: '0.45rem 0.9rem',
          fontSize: '0.78rem',
          fontWeight: 600,
          color: '#fff',
          background: pending ? '#cbd5e1' : C.accent,
          border: 'none',
          borderRadius: 8,
          cursor: pending ? 'wait' : 'pointer',
        }}
      >
        {pending ? 'Funding…' : 'Fund treasury (dev)'}
      </button>
      {msg && (
        <div style={{ fontSize: '0.7rem', color: msg.kind === 'err' ? C.danger : C.muted }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}
