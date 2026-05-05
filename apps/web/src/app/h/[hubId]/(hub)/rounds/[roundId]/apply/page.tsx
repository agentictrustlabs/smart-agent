/**
 * Spec 003 — Intent Marketplace (Proposal Lane).
 *
 * Proposal composer — apply to a round (T006 skeleton).
 *
 * The full implementation lands in US3 (T045): multi-step composer for
 * budget line items, plan narrative, milestones with dueDate /
 * evidenceRequired / trancheAmount, desired outcomes with validators,
 * reporting cadence + format, organisational background.
 */

export const dynamic = 'force-dynamic'

export default async function RoundApplyPage(_props: { params: Promise<{ hubId: string; roundId: string }> }) {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Apply to round</h1>
      <p style={{ color: '#9a8c7e' }}>Proposal composer — coming soon.</p>
    </div>
  )
}
