import Link from 'next/link'
import { getPublicClient } from '@/lib/contracts'
import { agentReviewRecordAbi, agentDisputeRecordAbi, agentTrustProfileAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'

export default async function ReviewsPage() {
  const client = getPublicClient()
  const reviewAddr = process.env.AGENT_REVIEW_ADDRESS as `0x${string}`
  const disputeAddr = process.env.AGENT_DISPUTE_ADDRESS as `0x${string}`
  const trustAddr = process.env.AGENT_TRUST_PROFILE_ADDRESS as `0x${string}`

  // Build address→name lookup
  const allUsers = await db.select().from(schema.users)
  const allPerson = await db.select().from(schema.personAgents)
  const allOrg = await db.select().from(schema.orgAgents)
  const nameMap = new Map<string, string>()
  for (const p of allPerson) {
    const u = allUsers.find((u) => u.id === p.userId)
    nameMap.set(p.smartAccountAddress.toLowerCase(), u?.name ?? 'Agent')
  }
  for (const o of allOrg) nameMap.set(o.smartAccountAddress.toLowerCase(), o.name)
  const getName = (a: string) => nameMap.get(a.toLowerCase()) ?? `${a.slice(0, 6)}...`

  type ReviewView = {
    id: number; reviewer: string; subject: string; reviewType: string
    recommendation: string; score: number; comment: string; revoked: boolean
  }

  type DisputeView = {
    id: number; subject: string; filedBy: string; disputeType: string
    status: string; reason: string
  }

  const reviews: ReviewView[] = []
  const disputes: DisputeView[] = []
  const recNames: Record<string, string> = { '0x': 'unknown' }

  try {
    const rCount = (await client.readContract({ address: reviewAddr, abi: agentReviewRecordAbi, functionName: 'reviewCount' })) as bigint
    for (let i = 0n; i < rCount; i++) {
      const r = (await client.readContract({ address: reviewAddr, abi: agentReviewRecordAbi, functionName: 'getReview', args: [i] })) as {
        reviewId: bigint; reviewer: string; subject: string; reviewType: `0x${string}`
        recommendation: `0x${string}`; overallScore: number; comment: string; evidenceURI: string
        createdAt: bigint; revoked: boolean
      }
      reviews.push({
        id: Number(r.reviewId), reviewer: getName(r.reviewer), subject: getName(r.subject),
        reviewType: 'Review', recommendation: r.overallScore >= 70 ? 'positive' : r.overallScore >= 50 ? 'neutral' : 'negative',
        score: r.overallScore, comment: r.comment, revoked: r.revoked,
      })
    }
  } catch { /* not deployed */ }

  try {
    const dCount = (await client.readContract({ address: disputeAddr, abi: agentDisputeRecordAbi, functionName: 'disputeCount' })) as bigint
    const dtNames = ['none', 'flag', 'dispute', 'sanction', 'suspension', 'revocation', 'blacklist']
    const dsNames = ['open', 'under-review', 'resolved', 'dismissed', 'upheld']
    for (let i = 0n; i < dCount; i++) {
      const d = (await client.readContract({ address: disputeAddr, abi: agentDisputeRecordAbi, functionName: 'getDispute', args: [i] })) as {
        disputeId: bigint; subject: string; filedBy: string; disputeType: number
        status: number; reason: string; evidenceURI: string; resolvedBy: string
        resolutionNote: string; filedAt: bigint; resolvedAt: bigint
      }
      disputes.push({
        id: Number(d.disputeId), subject: getName(d.subject), filedBy: getName(d.filedBy),
        disputeType: dtNames[d.disputeType] ?? 'unknown', status: dsNames[d.status] ?? 'unknown',
        reason: d.reason,
      })
    }
  } catch { /* not deployed */ }

  return (
    <div data-page="reviews">
      <div data-component="page-header">
        <div data-component="section-header">
          <h1>Reviews & Disputes</h1>
          <Link href="/reviews/submit" data-component="section-action">+ Submit Review</Link>
        </div>
        <p>Structured review claims and adverse signals for agents in the trust fabric</p>
      </div>

      <div data-component="protocol-info">
        <h3>Protocol Contracts</h3>
        <dl>
          <dt>AgentReviewRecord</dt><dd data-component="address">{reviewAddr}</dd>
          <dt>AgentDisputeRecord</dt><dd data-component="address">{disputeAddr}</dd>
          <dt>AgentTrustProfile</dt><dd data-component="address">{trustAddr}</dd>
        </dl>
      </div>

      <section data-component="graph-section">
        <h2>Reviews ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <p data-component="text-muted">No reviews yet.</p>
        ) : (
          <table data-component="graph-table">
            <thead>
              <tr><th>Subject</th><th>Reviewer</th><th>Score</th><th>Signal</th><th>Comment</th></tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id}>
                  <td>{r.subject}</td>
                  <td>{r.reviewer}</td>
                  <td><strong>{r.score}</strong>/100</td>
                  <td><span data-component="role-badge" data-status={r.recommendation === 'positive' ? 'active' : r.recommendation === 'negative' ? 'revoked' : 'proposed'}>{r.recommendation}</span></td>
                  <td style={{ maxWidth: 300, fontSize: '0.8rem', color: '#8888a0' }}>{r.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section data-component="graph-section">
        <h2>Disputes ({disputes.length})</h2>
        {disputes.length === 0 ? (
          <p data-component="text-muted">No disputes filed.</p>
        ) : (
          <table data-component="graph-table">
            <thead>
              <tr><th>Subject</th><th>Filed By</th><th>Type</th><th>Status</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id}>
                  <td>{d.subject}</td>
                  <td>{d.filedBy}</td>
                  <td><span data-component="role-badge">{d.disputeType}</span></td>
                  <td><span data-component="role-badge" data-status={d.status === 'open' ? 'proposed' : d.status === 'upheld' ? 'revoked' : 'active'}>{d.status}</span></td>
                  <td style={{ maxWidth: 300, fontSize: '0.8rem', color: '#8888a0' }}>{d.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
