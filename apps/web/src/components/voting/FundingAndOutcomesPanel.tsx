'use client'

/**
 * Sprint C — funding + outcomes panel.
 *
 * Mounts on the proposal detail page below the vote panel. Renders ONLY
 * for proposals whose status is 'awarded'. Shows:
 *
 *   - Disbursement tranches (status pills, claim button when pending +
 *     viewer is recipient, mark-paid button when claimed + viewer is steward)
 *   - Validator attestation form (visible to canValidate viewers; lists
 *     existing attestations for context)
 */

import { useEffect, useState, useTransition } from 'react'

const C = {
  card: '#ffffff', border: '#ece6db', text: '#5c4a3a', textMuted: '#9a8c7e',
  accent: '#8b5e3c', bg: 'rgba(139,94,60,0.04)',
  pending: '#92400e', claimed: '#0f766e', paid: '#0369a1', revoked: '#b91c1c',
  delivered: '#0f766e', partial: '#92400e', disputed: '#b91c1c', overdue: '#7c2d12',
}

interface Disbursement {
  id: string
  trancheLabel: string
  amount: number
  unit: string
  recipientAgentId: string
  status: 'pending' | 'claimed' | 'paid' | 'revoked'
  claimedAt: string | null
  paidAt: string | null
  txHash: string | null
}

interface Attestation {
  id: string
  milestoneLabel: string
  validatorAgentId: string
  status: 'delivered' | 'partial' | 'disputed' | 'overdue'
  evidence: string | null
  attestedAt: string
}

interface Props {
  proposalId: string
  fundAgent: string                       // for the steward / validator gate
  isProposer: boolean                     // true if viewer is the proposer (claim button)
  canManageFund: boolean                  // true if viewer can mark-paid + attest
  milestoneLabels: string[]               // from proposal.milestones[i].name
}

export function FundingAndOutcomesPanel({ proposalId, fundAgent, isProposer, canManageFund, milestoneLabels }: Props) {
  const [disb, setDisb] = useState<Disbursement[] | null>(null)
  const [attest, setAttest] = useState<Attestation[] | null>(null)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [milestone, setMilestone] = useState(milestoneLabels[0] ?? 'Milestone 1')
  const [attestStatus, setAttestStatus] = useState<'delivered' | 'partial' | 'disputed' | 'overdue'>('delivered')
  const [evidence, setEvidence] = useState('')

  async function refresh() {
    try {
      const [d, a] = await Promise.all([
        fetch(`/api/disbursements/list?proposalId=${encodeURIComponent(proposalId)}`).then(r => r.json()),
        fetch(`/api/attestations/list?proposalId=${encodeURIComponent(proposalId)}`).then(r => r.json()),
      ])
      if (d.disbursements) setDisb(d.disbursements)
      if (a.attestations) setAttest(a.attestations)
    } catch { /* swallow */ }
  }

  useEffect(() => {
    refresh()
    // No polling — funding events are infrequent. Refresh on demand
    // (after each action below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId])

  function claim(id: string) {
    setMsg(null)
    start(async () => {
      const r = await fetch('/api/disbursements/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ disbursementId: id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setMsg(`Failed: ${j.error ?? r.status}`); return }
      setMsg('Claim submitted. Awaiting payout from steward.')
      await refresh()
    })
  }

  function markPaid(id: string) {
    setMsg(null)
    start(async () => {
      const r = await fetch('/api/disbursements/mark-paid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ disbursementId: id, fundAgent }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setMsg(`Failed: ${j.error ?? r.status}`); return }
      setMsg('Marked paid (mock — real USDC custody in Phase 3).')
      await refresh()
    })
  }

  function castAttestation() {
    setMsg(null)
    start(async () => {
      const r = await fetch('/api/attestations/cast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          proposalId, fundAgent, milestoneLabel: milestone,
          status: attestStatus, evidence: evidence.trim() || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setMsg(`Failed: ${j.error ?? r.status}`); return }
      setMsg(`Attestation cast — ${attestStatus}.`)
      setEvidence('')
      await refresh()
    })
  }

  return (
    <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.1rem', marginBottom: '0.9rem' }}>
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem' }}>
        Funding + outcomes
      </h2>

      {/* Disbursements */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: C.text, marginBottom: '0.4rem' }}>Tranches</div>
        {disb === null ? (
          <p style={{ fontSize: '0.78rem', color: C.textMuted }}>Loading…</p>
        ) : disb.length === 0 ? (
          <p style={{ fontSize: '0.78rem', color: C.textMuted }}>No disbursements recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {disb.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.7rem', background: C.bg, borderRadius: 6, fontSize: '0.85rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.text, fontWeight: 600 }}>{d.trancheLabel}</div>
                  <div style={{ fontSize: '0.75rem', color: C.textMuted }}>
                    {d.amount.toLocaleString()} {d.unit}
                    {d.claimedAt && ` · claimed ${new Date(d.claimedAt).toLocaleString()}`}
                    {d.paidAt && ` · paid ${new Date(d.paidAt).toLocaleString()}`}
                  </div>
                </div>
                <StatusPill status={d.status} />
                {d.status === 'pending' && isProposer && (
                  <button type="button" disabled={pending} onClick={() => claim(d.id)} style={btnPrimary(pending)}>
                    {pending ? '…' : 'Claim funds'}
                  </button>
                )}
                {d.status === 'claimed' && canManageFund && (
                  <button type="button" disabled={pending} onClick={() => markPaid(d.id)} style={btnPrimary(pending)}>
                    {pending ? '…' : 'Mark paid'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attestations */}
      <div>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: C.text, marginBottom: '0.4rem' }}>Outcome attestations</div>
        {attest === null ? (
          <p style={{ fontSize: '0.78rem', color: C.textMuted }}>Loading…</p>
        ) : attest.length === 0 ? (
          <p style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: canManageFund ? '0.55rem' : 0 }}>No attestations yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: canManageFund ? '0.65rem' : 0 }}>
            {attest.map(a => (
              <li key={a.id} style={{ padding: '0.5rem 0.7rem', background: C.bg, borderRadius: 6, fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ color: C.text, fontWeight: 600 }}>{a.milestoneLabel}</span>
                  <AttestationPill status={a.status} />
                  <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: C.textMuted }}>
                    {new Date(a.attestedAt).toLocaleString()}
                  </span>
                </div>
                {a.evidence && <div style={{ fontSize: '0.75rem', color: C.textMuted, marginTop: '0.2rem' }}>{a.evidence}</div>}
              </li>
            ))}
          </ul>
        )}

        {canManageFund && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: attest && attest.length > 0 ? 0 : '0.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.45rem' }}>
              <select value={milestone} onChange={(e) => setMilestone(e.target.value)} style={fieldStyle}>
                {milestoneLabels.length === 0
                  ? <option value="Milestone 1">Milestone 1</option>
                  : milestoneLabels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={attestStatus} onChange={(e) => setAttestStatus(e.target.value as typeof attestStatus)} style={fieldStyle}>
                <option value="delivered">Delivered</option>
                <option value="partial">Partial</option>
                <option value="disputed">Disputed</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
            <input type="text" placeholder="Evidence URI or short note (optional)" value={evidence}
              onChange={(e) => setEvidence(e.target.value)} style={fieldStyle} />
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button type="button" disabled={pending} onClick={castAttestation} style={btnPrimary(pending)}>
                {pending ? 'Submitting…' : 'Cast attestation'}
              </button>
              {msg && <span style={{ fontSize: '0.78rem', color: C.textMuted }}>{msg}</span>}
            </div>
          </div>
        )}
      </div>

      {!canManageFund && msg && <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: C.textMuted }}>{msg}</div>}
    </section>
  )
}

function StatusPill({ status }: { status: Disbursement['status'] }) {
  const color = ({ pending: C.pending, claimed: C.claimed, paid: C.paid, revoked: C.revoked } as Record<string, string>)[status]
  return <span style={pillStyle(color)}>{status}</span>
}
function AttestationPill({ status }: { status: Attestation['status'] }) {
  const color = ({ delivered: C.delivered, partial: C.partial, disputed: C.disputed, overdue: C.overdue } as Record<string, string>)[status]
  return <span style={pillStyle(color)}>{status}</span>
}
function pillStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-block', padding: '0.15rem 0.55rem', borderRadius: 999,
    fontSize: '0.7rem', fontWeight: 700, color,
    background: `${color}15`, border: `1px solid ${color}40`, textTransform: 'capitalize',
  }
}
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '0.45rem 0.6rem', fontSize: '0.85rem',
  border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: '#fff',
}
function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.45rem 0.85rem', borderRadius: 7,
    background: disabled ? '#cfc4b3' : C.accent, color: '#fff',
    border: 'none', fontSize: '0.78rem', fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
