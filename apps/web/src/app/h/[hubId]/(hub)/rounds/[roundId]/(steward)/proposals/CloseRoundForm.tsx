'use client'

/**
 * Treasury Phase 2.5 — Close Round form for the lead steward.
 *
 * Renders below the ranked-proposals list on the steward review page.
 * Lets the steward toggle each proposal as awarded, set the total amount
 * + tranche schedule, and POST to the sibling close/route.ts which calls
 * the closeRound() server action.
 *
 * v1 simplifications:
 *   - One tranche per award (defaults to totalAmount). Multi-tranche
 *     splitting is added when the tranche-schedule UI lands.
 *   - Steward sigs not collected here — Phase 2.5 has the pool root sign
 *     alone via the deployer key. Phase 3 introduces the
 *     `treasury_proposal:*` sig-collection flow.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  successBg: 'rgba(13,148,136,0.08)',
  successFg: '#0f766e',
  errorBg: '#fef2f2',
  errorFg: '#991b1b',
}

export interface CloseableProposal {
  proposalIRI: string
  proposerAgentId: string
  proposerLabel: string
  /** Default suggested award amount — typically the proposal's budget total. */
  suggestedAmount: number
  unit: string
}

export interface CloseRoundFormProps {
  hubSlug: string
  roundId: string
  poolAgentId: string
  proposals: CloseableProposal[]
}

interface SelectedAward {
  proposalIRI: string
  recipientAddr: string
  recipientAgentIRI: string
  totalAmount: number
  unit: string
}

export function CloseRoundForm({ hubSlug, roundId, poolAgentId, proposals }: CloseRoundFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<string, { selected: boolean; amount: string }>>(() => {
    const init: Record<string, { selected: boolean; amount: string }> = {}
    for (const p of proposals) {
      init[p.proposalIRI] = { selected: false, amount: String(p.suggestedAmount) }
    }
    return init
  })

  const selectedCount = Object.values(picks).filter(p => p.selected).length
  const totalAwarded = Object.entries(picks).reduce((sum, [, v]) => {
    if (!v.selected) return sum
    const n = Number(v.amount)
    return Number.isFinite(n) ? sum + n : sum
  }, 0)

  function toggle(iri: string) {
    setPicks(s => ({ ...s, [iri]: { ...s[iri]!, selected: !s[iri]!.selected } }))
  }
  function setAmount(iri: string, value: string) {
    setPicks(s => ({ ...s, [iri]: { ...s[iri]!, amount: value } }))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (selectedCount === 0) {
      setError('Select at least one proposal to award before closing the round.')
      return
    }
    const awards: SelectedAward[] = []
    for (const p of proposals) {
      const pick = picks[p.proposalIRI]
      if (!pick?.selected) continue
      const amount = Number(pick.amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        setError(`Award amount for ${p.proposerLabel} must be > 0`)
        return
      }
      awards.push({
        proposalIRI: p.proposalIRI,
        recipientAddr: p.proposerAgentId,
        recipientAgentIRI: p.proposerAgentId,
        totalAmount: amount,
        unit: p.unit,
      })
    }

    startTransition(async () => {
      try {
        const res = await fetch(
          `/h/${hubSlug}/rounds/${encodeURIComponent(roundId)}/close`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ poolAgentId, awards }),
          },
        )
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(j.error ?? `Close failed: ${res.status}`)
          return
        }
        // Success — refresh the round detail to surface the new "closed"
        // banner + dispute window countdown.
        router.push(`/h/${hubSlug}/rounds/${encodeURIComponent(roundId)}`)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  if (proposals.length === 0) {
    return null
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        marginTop: '1.5rem',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '1rem 1.1rem',
      }}
    >
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
        Steward action — close round
      </div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.4rem' }}>
        Award winning proposals
      </h2>
      <p style={{ fontSize: '0.78rem', color: C.textMuted, margin: '0 0 0.8rem' }}>
        Toggle each winner, confirm the award amount, and close the round. Closing fires four
        on-chain assertions (RoundClosed, AllocationDecided, DisputeWindowOpened, GrantAwarded × N)
        and starts a 72&nbsp;h dispute window before the first tranche disburses.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.9rem' }}>
        {proposals.map(p => {
          const pick = picks[p.proposalIRI]!
          return (
            <label
              key={p.proposalIRI}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.6rem 0.7rem',
                border: `1px solid ${pick.selected ? C.accent : C.border}`,
                borderRadius: 8,
                background: pick.selected ? 'rgba(139,94,60,0.04)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={pick.selected}
                onChange={() => toggle(p.proposalIRI)}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text }}>
                  {p.proposerLabel}
                </div>
                <div style={{ fontSize: '0.7rem', color: C.textMuted, fontFamily: 'ui-monospace, monospace', marginTop: 1 }}>
                  {p.proposalIRI.slice(0, 56)}{p.proposalIRI.length > 56 ? '…' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input
                  type="number"
                  min={0}
                  value={pick.amount}
                  onChange={e => setAmount(p.proposalIRI, e.target.value)}
                  disabled={!pick.selected}
                  style={{
                    width: '6rem',
                    padding: '0.35rem 0.45rem',
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    fontSize: '0.85rem',
                    textAlign: 'right',
                  }}
                />
                <span style={{ fontSize: '0.78rem', color: C.textMuted }}>{p.unit}</span>
              </div>
            </label>
          )
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
        <div style={{ fontSize: '0.78rem', color: C.textMuted }}>
          <strong style={{ color: C.text }}>{selectedCount}</strong> proposal{selectedCount === 1 ? '' : 's'} selected ·{' '}
          <strong style={{ color: C.text }}>{Number.isFinite(totalAwarded) ? totalAwarded.toLocaleString() : '—'}</strong> total
        </div>
        <button
          type="submit"
          disabled={isPending || selectedCount === 0}
          style={{
            padding: '0.55rem 1.1rem',
            background: selectedCount > 0 && !isPending ? C.accent : C.border,
            color: selectedCount > 0 && !isPending ? '#fff' : C.textMuted,
            border: 'none',
            borderRadius: 8,
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: selectedCount > 0 && !isPending ? 'pointer' : 'not-allowed',
          }}
        >
          {isPending ? 'Closing…' : 'Close round + open dispute window'}
        </button>
      </div>
      {error && (
        <div style={{
          marginTop: '0.6rem',
          padding: '0.5rem 0.7rem',
          background: C.errorBg,
          color: C.errorFg,
          borderRadius: 6,
          fontSize: '0.78rem',
        }}>
          {error}
        </div>
      )}
    </form>
  )
}
