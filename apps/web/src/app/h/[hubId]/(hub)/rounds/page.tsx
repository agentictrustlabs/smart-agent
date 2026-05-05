/**
 * Spec 003 — Intent Marketplace (Proposal Lane).
 *
 * Rounds index page (T006 skeleton).
 *
 * The full implementation lands in US1 (T032): mandate-match badges,
 * filters, and ranked rounds via @smart-agent/sdk/matchmaker.
 */

export const dynamic = 'force-dynamic'

export default async function RoundsListPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Open rounds</h1>
      <p style={{ color: '#9a8c7e' }}>Round listing — coming soon.</p>
    </div>
  )
}
