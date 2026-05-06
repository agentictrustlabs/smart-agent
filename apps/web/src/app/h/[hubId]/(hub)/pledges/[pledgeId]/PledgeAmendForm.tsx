'use client'

/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pledge amend form (US5 / FR-019).
 *
 * Client form. Lets the donor pick which field to amend (amount / cadence /
 * duration), supplies the new value, and POSTs to the sibling
 * `[pledgeId]/amend/route.ts`.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { PoolPledge, PledgeCadence } from '@smart-agent/sdk'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  border: '#ece6db',
  errorBg: '#fef2f2',
  errorFg: '#991b1b',
}

type AmendKind = 'amount' | 'cadence' | 'duration'

export function PledgeAmendForm({
  pledgeId,
  hubSlug,
  pledge,
}: {
  pledgeId: string
  hubSlug: string
  pledge: PoolPledge
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<AmendKind>('amount')
  const [newValue, setNewValue] = useState<string>(String(pledge.amount))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    let payloadValue: number | PledgeCadence
    if (kind === 'cadence') {
      if (newValue !== 'one-time' && newValue !== 'monthly' && newValue !== 'annual') {
        setError('Invalid cadence')
        return
      }
      payloadValue = newValue
    } else {
      const n = Number(newValue)
      if (!Number.isFinite(n) || n <= 0) {
        setError('New value must be a positive number')
        return
      }
      payloadValue = n
    }

    startTransition(async () => {
      try {
        const res = await fetch(
          `/h/${hubSlug}/pledges/${encodeURIComponent(pledgeId)}/amend`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              change: { kind, newValue: payloadValue },
            }),
            redirect: 'follow',
          },
        )
        if (res.redirected) {
          router.push(res.url)
          return
        }
        const json = await res.json()
        if (!json.ok) {
          setError(json.error?.message ?? `Amend failed: ${json.error?.kind ?? 'unknown'}`)
        } else {
          router.refresh()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{
          marginBottom: '0.65rem',
          padding: '0.5rem 0.7rem',
          background: C.errorBg,
          color: C.errorFg,
          border: `1px solid ${C.errorFg}40`,
          borderRadius: 6,
          fontSize: '0.78rem',
        }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value as AmendKind
            setKind(k)
            // Reset newValue to a sensible default for the new kind.
            if (k === 'amount') setNewValue(String(pledge.amount))
            else if (k === 'cadence') setNewValue(pledge.cadence)
            else setNewValue(String(pledge.duration ?? 12))
          }}
          style={{
            padding: '0.4rem 0.6rem',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            fontSize: '0.85rem',
          }}
        >
          <option value="amount">Amount</option>
          <option value="cadence">Cadence</option>
          <option value="duration">Duration</option>
        </select>
        {kind === 'cadence' ? (
          <select
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            style={{
              padding: '0.4rem 0.6rem',
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              fontSize: '0.85rem',
            }}
          >
            <option value="one-time">one-time</option>
            <option value="monthly">monthly</option>
            <option value="annual">annual</option>
          </select>
        ) : (
          <input
            type="number"
            min="0"
            step="0.01"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            style={{
              padding: '0.4rem 0.6rem',
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              fontSize: '0.85rem',
              width: 120,
            }}
          />
        )}
        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: '0.4rem 1rem',
            background: C.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.7 : 1,
          }}
        >
          {isPending ? 'Saving…' : 'Save amendment'}
        </button>
      </div>
    </form>
  )
}
