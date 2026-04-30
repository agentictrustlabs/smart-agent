'use client'

/**
 * DeterminationPanel — Stage 7 mutual sign-off.
 *
 * Both holder and provider must confirm the outcome before the trust
 * deposit fires. Replaces the single-sided "Mark fulfilled" pattern.
 * If a witness is named, the witness must have signed the pinned evidence
 * bundle before either party's confirmation is accepted.
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §3.3, §3.2 stop 7
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmOutcome } from '@/lib/actions/entitlements.action'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  validBg: '#fef2f2', validBorder: '#fecaca', validFg: '#991b1b',
  doneBg: '#dcfce7', doneFg: '#166534',
  pendingBg: '#fef3c7', pendingFg: '#92400e',
}

export function DeterminationPanel({
  engagementId,
  role,
  holderName,
  providerName,
  holderConfirmedAt,
  providerConfirmedAt,
  evidencePinned,
  witnessAgent,
  witnessSignedAt,
  alreadyDeposited,
}: {
  engagementId: string
  role: 'holder' | 'provider' | 'observer'
  holderName: string
  providerName: string
  holderConfirmedAt: string | null
  providerConfirmedAt: string | null
  evidencePinned: boolean
  witnessAgent: string | null
  witnessSignedAt: string | null
  alreadyDeposited: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const witnessGate = !!witnessAgent && !witnessSignedAt
  const evidenceGate = !evidencePinned

  // After deposit, this panel is informational only.
  if (alreadyDeposited) {
    return (
      <div style={{
        background: C.doneBg,
        border: `1px solid #bbf7d0`,
        borderRadius: 12,
        padding: '0.85rem 1rem',
        marginBottom: '1rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.doneFg, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
          ✓ Outcome determined · Trust deposited
        </div>
        <div style={{ fontSize: '0.82rem', color: C.text }}>
          Both parties confirmed the outcome. The trust deposit was minted to both agents' profiles.
        </div>
      </div>
    )
  }

  const myConfirmed = role === 'holder'
    ? holderConfirmedAt !== null
    : role === 'provider' ? providerConfirmedAt !== null : false
  const otherConfirmed = role === 'holder'
    ? providerConfirmedAt !== null
    : role === 'provider' ? holderConfirmedAt !== null : false

  function submit() {
    setErr(null)
    start(async () => {
      const r = await confirmOutcome(engagementId)
      if ('error' in r) setErr(r.error)
      else router.refresh()
    })
  }

  return (
    <div style={{
      background: C.validBg,
      border: `1px solid ${C.validBorder}`,
      borderRadius: 12,
      padding: '1rem 1.1rem',
      marginBottom: '1rem',
    }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.validFg, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
        ✓ Determine outcome · Stage 7
      </div>
      <div style={{ fontSize: '0.85rem', color: C.text, marginBottom: '0.8rem', lineHeight: 1.4 }}>
        Both parties must confirm the outcome before the trust deposit fires. The deposit is the
        engagement's enduring residue on each agent's profile.
      </div>

      <ConfirmRow
        label={`Holder · ${holderName}`}
        confirmedAt={holderConfirmedAt}
      />
      <ConfirmRow
        label={`Provider · ${providerName}`}
        confirmedAt={providerConfirmedAt}
      />

      {witnessAgent && (
        <ConfirmRow
          label={`Witness · ${witnessAgent.slice(0, 10)}…`}
          confirmedAt={witnessSignedAt}
        />
      )}

      {(role === 'holder' || role === 'provider') && (
        <div style={{ marginTop: '0.75rem' }}>
          {evidenceGate && (
            <div style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.45rem' }}>
              ⏳ Evidence must be pinned (Stage 6) before confirmation can be accepted.
            </div>
          )}
          {witnessGate && !evidenceGate && (
            <div style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.45rem' }}>
              ⏳ Witness must sign before confirmation can be accepted.
            </div>
          )}
          {myConfirmed ? (
            <div style={{ fontSize: '0.82rem', color: C.text }}>
              You confirmed. {otherConfirmed ? 'The other party also confirmed — deposit will fire.' : 'Awaiting the other party.'}
            </div>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={pending || evidenceGate || witnessGate}
              style={{
                padding: '0.55rem 1.2rem',
                background: (evidenceGate || witnessGate) ? '#f3f4f6' : C.accent,
                color: (evidenceGate || witnessGate) ? '#9ca3af' : '#fff',
                border: 'none', borderRadius: 8,
                fontSize: '0.85rem', fontWeight: 600,
                cursor: (evidenceGate || witnessGate) ? 'not-allowed' : 'pointer',
              }}
            >
              {pending ? 'Confirming…' : `✓ Confirm outcome (${role})`}
            </button>
          )}
        </div>
      )}

      {err && <div style={{ marginTop: '0.45rem', fontSize: '0.75rem', color: C.validFg }}>{err}</div>}
    </div>
  )
}

function ConfirmRow({ label, confirmedAt }: { label: string; confirmedAt: string | null }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0.4rem 0.6rem',
      background: '#fff',
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      marginBottom: '0.3rem',
    }}>
      <div style={{ fontSize: '0.82rem', color: C.text }}>{label}</div>
      {confirmedAt ? (
        <span style={{
          fontSize: '0.65rem', fontWeight: 700,
          padding: '0.18rem 0.5rem', borderRadius: 999,
          background: C.doneBg, color: C.doneFg,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          ✓ {new Date(confirmedAt).toLocaleDateString()}
        </span>
      ) : (
        <span style={{
          fontSize: '0.65rem', fontWeight: 700,
          padding: '0.18rem 0.5rem', borderRadius: 999,
          background: C.pendingBg, color: C.pendingFg,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Pending
        </span>
      )}
    </div>
  )
}
