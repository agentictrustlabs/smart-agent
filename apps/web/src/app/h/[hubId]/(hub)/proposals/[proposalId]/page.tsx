/**
 * Spec 003 — Intent Marketplace (Proposal Lane).
 *
 * Single proposal detail / edit view (T007 skeleton).
 *
 * The full implementation lands in US5 (T059): state-aware actions —
 * mounts the appropriate edit form for `draft` and pre-deadline
 * `submitted`, read-only for post-deadline submitted / withdrawn /
 * decided per FR-022.
 */

export const dynamic = 'force-dynamic'

export default async function ProposalDetailPage(_props: { params: Promise<{ hubId: string; proposalId: string }> }) {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Proposal detail</h1>
      <p style={{ color: '#9a8c7e' }}>Proposal detail — coming soon.</p>
    </div>
  )
}
