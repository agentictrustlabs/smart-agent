/**
 * PolicyPanel — primary surface for Governance-shape engagements.
 *
 * Renders the policy doc + signer roster + state pill. The roster is the
 * action surface — listed signers see a Sign button, others see read-only.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 Governance.
 */

import type { PolicyView } from '@/lib/actions/engagements/policy.action'
import { SignPolicyButton } from './SignPolicyButton'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  bgPanel: '#fdfcf8',
  draftBg: '#fafaf6', draftFg: '#6b7280',
  pendingBg: '#fef3c7', pendingFg: '#92400e',
  approvedBg: '#dcfce7', approvedFg: '#166534',
  rejectedBg: '#fee2e2', rejectedFg: '#991b1b',
}

export function PolicyPanel({
  policy,
  engagementId,
  myAgent,
  agentNameByAddress,
}: {
  policy: PolicyView
  engagementId: string
  myAgent: string | null
  agentNameByAddress: Record<string, string>
}) {
  const tone = STATE_TONE[policy.currentState]
  const myLower = myAgent?.toLowerCase() ?? null
  const mySignerRow = myLower ? policy.signers.find(s => s.agent === myLower) : null

  return (
    <section style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: '1rem',
    }}>
      {/* Header */}
      <div style={{
        background: C.bgPanel,
        borderBottom: `1px solid ${C.border}`,
        padding: '0.85rem 1.1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Policy state
          </div>
          <span style={{
            fontSize: '0.65rem', fontWeight: 700,
            padding: '0.2rem 0.6rem', borderRadius: 999,
            background: tone.bg, color: tone.fg,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {tone.label}
          </span>
        </div>
        <h2 style={{
          margin: '0.2rem 0 0', fontSize: '1.1rem', fontWeight: 700, color: C.text,
        }}>
          {policy.policySummary || 'Approval required'}
        </h2>
        <div style={{ fontSize: '0.78rem', color: C.textMuted, marginTop: '0.3rem' }}>
          {policy.signedCount} of {policy.requiredSigners} signatures received
          {policy.policyDocUri && (
            <>
              {' · '}
              <a href={policy.policyDocUri} target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>
                read the policy doc ↗
              </a>
            </>
          )}
        </div>
      </div>

      {/* Signer roster */}
      <div style={{ padding: '0.6rem 1.1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
          Signer roster
        </div>
        {policy.signers.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: C.textMuted, fontStyle: 'italic' }}>
            No signers yet — add the people who must approve.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {policy.signers.map(s => {
              const name = agentNameByAddress[s.agent] ?? `${s.agent.slice(0, 8)}…${s.agent.slice(-4)}`
              const signed = s.signedAt !== null
              const isMe = myLower === s.agent
              return (
                <div key={s.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.5rem 0.7rem',
                  background: isMe ? '#fdf6ed' : '#fafaf6',
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                    <div style={{ fontSize: '0.85rem', color: C.text, fontWeight: 600 }}>
                      {name}{isMe ? ' (you)' : ''}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: C.textMuted }}>
                      {s.role}
                      {signed && <> · signed {fmtDate(s.signedAt!)}</>}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700,
                    padding: '0.18rem 0.5rem', borderRadius: 999,
                    background: signed ? C.approvedBg : C.pendingBg,
                    color: signed ? C.approvedFg : C.pendingFg,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {signed ? '✓ Signed' : 'Awaiting'}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* My-signature affordance */}
        {mySignerRow && !mySignerRow.signedAt && policy.currentState !== 'approved' && policy.currentState !== 'rejected' && (
          <div style={{ marginTop: '0.85rem', display: 'flex', justifyContent: 'flex-end' }}>
            <SignPolicyButton engagementId={engagementId} />
          </div>
        )}
      </div>
    </section>
  )
}

const STATE_TONE = {
  draft:    { bg: C.draftBg, fg: C.draftFg, label: 'Draft' },
  pending:  { bg: C.pendingBg, fg: C.pendingFg, label: 'Awaiting signatures' },
  approved: { bg: C.approvedBg, fg: C.approvedFg, label: 'Approved' },
  rejected: { bg: C.rejectedBg, fg: C.rejectedFg, label: 'Rejected' },
} as const

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}
