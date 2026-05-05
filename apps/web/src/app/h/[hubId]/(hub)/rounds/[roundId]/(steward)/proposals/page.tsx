/**
 * Spec 003 — Intent Marketplace (Proposal Lane).
 *
 * Steward-side ranked proposals view for a round (T006 skeleton).
 *
 * The full implementation lands in US4 (T051): federates reads across
 * each submitting proposer's MCP via the `proposal:read_for_review`
 * cross-delegation, computes stewardSideSignals per proposal, feeds to
 * rankCandidates from @smart-agent/sdk/matchmaker, tie-breaks on
 * submittedAt desc per FR-019. No GraphDB read (IA P5).
 */

export const dynamic = 'force-dynamic'

export default async function StewardProposalsPage(_props: { params: Promise<{ hubId: string; roundId: string }> }) {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Steward — proposals on this round</h1>
      <p style={{ color: '#9a8c7e' }}>Steward-side proposal review — coming soon.</p>
    </div>
  )
}
