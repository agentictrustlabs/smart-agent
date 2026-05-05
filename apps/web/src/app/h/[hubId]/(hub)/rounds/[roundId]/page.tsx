/**
 * Spec 003 — Intent Marketplace (Proposal Lane).
 *
 * Round detail page (T006 skeleton).
 *
 * The full implementation lands in US2 (T036): mandate, eligibility block
 * (with credential ownership inline), budget envelope, milestone template,
 * validator requirements, reporting cadence, deadline, decision date,
 * prior stats. Private rounds gate to addressed applicants.
 */

export const dynamic = 'force-dynamic'

export default async function RoundDetailPage(_props: { params: Promise<{ hubId: string; roundId: string }> }) {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Round detail</h1>
      <p style={{ color: '#9a8c7e' }}>Round detail — coming soon.</p>
    </div>
  )
}
