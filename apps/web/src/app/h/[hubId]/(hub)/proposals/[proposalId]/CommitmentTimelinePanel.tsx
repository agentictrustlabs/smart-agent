'use client'

/**
 * Spec 006 — universal commitment timeline panel.
 *
 * Renders for any awarded proposal that has a `sa:Commitment` row.
 * Shows: source/lane label, donor, recipient, total + released + remaining,
 * per-milestone status, and (for pool stewards) the "Release tranche" CTA.
 *
 * The release CTA fires `releaseTranche` from `commitments.action.ts`,
 * which mirrors spec-005's Rail A: donor.executeBatch via a
 * calldata-hash-pinned single-hop delegation from donor → signer-EOA.
 */

import { useState, useTransition } from 'react'
import type { Hex } from 'viem'
import type { CommitmentRow } from '@/lib/actions/commitments.action'

interface MilestoneRow {
  id: string
  label: string
  trancheBps: number
  releasedAmount: string | null
  releasedAt: number | null
  /** Display name of the steward who signed the release tx (pulled from
   *  the Released event's tx.from + agent-metadata lookup). */
  signerLabel: string | null
  signerEoa: string | null
}

interface Props {
  commitment: CommitmentRow
  milestones: MilestoneRow[]
  canRelease: boolean
}

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  pending: '#92400e',
  inFlight: '#0f766e',
  completed: '#166534',
  canceled: '#6b7280',
  blocked: '#991b1b',
}

function statusColor(label: string): string {
  switch (label) {
    case 'pending':           return C.pending
    case 'in-flight':         return C.inFlight
    case 'completed':         return C.completed
    case 'canceled':          return C.canceled
    case 'releases-blocked':  return C.blocked
    default:                  return C.textMuted
  }
}

function formatUsdc(amountStr: string): string {
  try {
    const n = BigInt(amountStr)
    const dollars = Number(n) / 1_000_000
    if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
    if (dollars >= 1_000)     return `$${(dollars / 1_000).toFixed(1)}k`
    return `$${dollars.toLocaleString()}`
  } catch {
    return '—'
  }
}

function shortAddr(addr: string): string {
  if (!addr) return '—'
  if (addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function CommitmentTimelinePanel({ commitment, milestones, canRelease }: Props) {
  const [pending, start] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const total = BigInt(commitment.totalAmount)
  const released = BigInt(commitment.releasedAmount)
  const remaining = total > released ? (total - released).toString() : '0'

  function trancheAmount(bps: number): bigint {
    return (total * BigInt(bps)) / 10000n
  }

  function onRelease(m: MilestoneRow) {
    if (m.releasedAt) return
    if (pending) return
    setError(null)
    setPendingId(m.id)
    start(async () => {
      try {
        const amount = trancheAmount(m.trancheBps)
        // tokenAmount must be USDC-6-decimal scaled; commitmentScaleAmount
        // stays in commitment-unit scale (whole USD for grant rounds).
        // Shipping the same raw value to both caused ERC20InsufficientBalance.
        const tokenAmount = (amount * 1_000_000n).toString()
        const res = await fetch('/api/commitments/release', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commitmentSubject: commitment.commitmentSubject,
            milestoneId: m.id,
            tokenAmount,
            commitmentScaleAmount: amount.toString(),
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || j.ok === false) {
          setError(j.error ?? `release failed: ${res.status}`)
        } else {
          // Reload the page to pick up the fresh on-chain + GraphDB state.
          window.location.reload()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setPendingId(null)
      }
    })
  }

  return (
    <section style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '1rem 1.1rem', marginBottom: '0.9rem',
    }}>
      <h2 style={{
        fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase',
        letterSpacing: '0.06em', margin: '0 0 0.65rem',
      }}>
        Commitment & funding timeline
      </h2>

      {/* Header summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        <span style={{
          fontSize: '0.62rem', fontWeight: 700,
          padding: '0.2rem 0.55rem', borderRadius: 999,
          background: `${statusColor(commitment.status)}15`,
          color: statusColor(commitment.status),
          border: `1px solid ${statusColor(commitment.status)}40`,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {commitment.status}
        </span>
        <span style={{ fontSize: '0.78rem', color: C.textMuted }}>
          Donor <strong style={{ color: C.text }}>{shortAddr(commitment.donor)}</strong>
          {' '}→{' '}
          Recipient <strong style={{ color: C.text }}>{shortAddr(commitment.recipient)}</strong>
        </span>
      </div>

      <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', marginBottom: '0.85rem', fontSize: '0.85rem' }}>
        <div>
          <div style={{ fontSize: '0.65rem', color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total</div>
          <div style={{ fontWeight: 700, color: C.text }}>{formatUsdc(commitment.totalAmount)}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.65rem', color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Released</div>
          <div style={{ fontWeight: 700, color: C.completed }}>{formatUsdc(commitment.releasedAmount)}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.65rem', color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Remaining</div>
          <div style={{ fontWeight: 700, color: C.text }}>{formatUsdc(remaining)}</div>
        </div>
      </div>

      {/* Milestone timeline */}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '0.65rem' }}>
        <div style={{ fontSize: '0.7rem', color: C.textMuted, fontWeight: 600, marginBottom: '0.45rem' }}>Milestones</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {milestones.map((m) => {
            const releasedHere = !!m.releasedAt
            const expected = trancheAmount(m.trancheBps).toString()
            const isPending = pendingId === m.id && pending
            const releasedAtIso = m.releasedAt
              ? new Date(m.releasedAt * 1000).toISOString().slice(0, 10)
              : null
            return (
              <li key={m.id} style={{
                display: 'flex', flexDirection: 'column',
                padding: '0.45rem 0', borderBottom: `1px dashed ${C.border}`,
              }}>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <span style={{
                  fontSize: '0.62rem', fontWeight: 700,
                  padding: '0.18rem 0.5rem', borderRadius: 999,
                  background: releasedHere ? `${C.completed}15` : `${C.pending}15`,
                  color: releasedHere ? C.completed : C.pending,
                  border: `1px solid ${releasedHere ? C.completed : C.pending}40`,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  minWidth: '5rem', textAlign: 'center',
                }}>
                  {releasedHere ? 'released' : 'pending'}
                </span>
                <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, color: C.text }}>
                  {m.label}
                </span>
                <span style={{ fontSize: '0.78rem', color: C.textMuted, minWidth: '5rem', textAlign: 'right' }}>
                  {formatUsdc(releasedHere ? (m.releasedAmount ?? '0') : expected)}
                </span>
                {canRelease && !releasedHere && commitment.status !== 'canceled' && commitment.status !== 'releases-blocked' && (
                  <button
                    type="button"
                    onClick={() => onRelease(m)}
                    disabled={isPending}
                    style={{
                      padding: '0.4rem 0.85rem', borderRadius: 8,
                      background: isPending ? '#cfc4b3' : C.accent, color: '#fff',
                      border: 'none', fontSize: '0.78rem', fontWeight: 700,
                      cursor: isPending ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isPending ? 'Releasing…' : 'Release →'}
                  </button>
                )}
                </div>
                {releasedHere && (
                  <div style={{
                    fontSize: '0.7rem', color: C.textMuted, marginTop: '0.3rem',
                    marginLeft: 'calc(5rem + 0.6rem)',
                  }}>
                    Released by{' '}
                    <strong style={{ color: C.text }}>
                      {m.signerLabel ?? (m.signerEoa
                        ? `${m.signerEoa.slice(0, 6)}…${m.signerEoa.slice(-4)}`
                        : 'unknown steward')}
                    </strong>
                    {releasedAtIso && <> · {releasedAtIso}</>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {error && (
        <div style={{
          marginTop: '0.6rem', padding: '0.5rem 0.7rem',
          background: '#fef2f2', color: C.blocked, border: `1px solid #fecaca`,
          borderRadius: 6, fontSize: '0.78rem',
        }}>
          {error}
        </div>
      )}

      {/* Need-intent breadcrumb */}
      {commitment.needIntentId && (
        <div style={{ marginTop: '0.65rem', fontSize: '0.72rem', color: C.textMuted }}>
          Anchored need:{' '}
          <code style={{ color: C.text }}>{commitment.needIntentId}</code>
        </div>
      )}
    </section>
  )
}

// Re-export for the page server file to type the prop.
export type { Hex }
