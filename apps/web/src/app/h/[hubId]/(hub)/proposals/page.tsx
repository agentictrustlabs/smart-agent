/**
 * Spec 003 — Intent Marketplace (Proposal Lane).
 *
 * "Your proposals" management view (T007 skeleton).
 *
 * The full implementation lands in US5 (T058): lists viewer's proposals
 * grouped by state (draft / submitted / withdrawn / awarded / declined)
 * with appropriate action affordances (resume / edit-pre-deadline /
 * view-only / view-decision). Reads from proposer's MCP only — no
 * GraphDB joins (IA P5).
 */

export const dynamic = 'force-dynamic'

export default async function YourProposalsPage(_props: { params: Promise<{ hubId: string }> }) {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Your proposals</h1>
      <p style={{ color: '#9a8c7e' }}>Your proposals — coming soon.</p>
    </div>
  )
}
