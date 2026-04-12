import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { getPublicClient, getEdgesByObject, getEdgesBySubject, getEdge } from '@/lib/contracts'
import { agentReviewRecordAbi, agentDisputeRecordAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { keccak256, toBytes } from 'viem'

const REC_LABELS: Record<string, string> = {
  [keccak256(toBytes('endorses'))]: 'positive',
  [keccak256(toBytes('recommends'))]: 'positive',
  [keccak256(toBytes('neutral'))]: 'neutral',
  [keccak256(toBytes('flags'))]: 'negative',
  [keccak256(toBytes('disputes'))]: 'negative',
}
const REC_NAMES: Record<string, string> = {
  [keccak256(toBytes('endorses'))]: 'endorses',
  [keccak256(toBytes('recommends'))]: 'recommends',
  [keccak256(toBytes('neutral'))]: 'neutral',
  [keccak256(toBytes('flags'))]: 'flags',
  [keccak256(toBytes('disputes'))]: 'disputes',
}
const TYPE_NAMES: Record<string, string> = {
  [keccak256(toBytes('PerformanceReview'))]: 'Performance',
  [keccak256(toBytes('TrustReview'))]: 'Trust',
  [keccak256(toBytes('QualityReview'))]: 'Quality',
  [keccak256(toBytes('ComplianceReview'))]: 'Compliance',
  [keccak256(toBytes('SafetyReview'))]: 'Safety',
}

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  const client = getPublicClient()
  const reviewAddr = process.env.AGENT_REVIEW_ADDRESS as `0x${string}`
  const disputeAddr = process.env.AGENT_DISPUTE_ADDRESS as `0x${string}`
  const trustAddr = process.env.AGENT_TRUST_PROFILE_ADDRESS as `0x${string}`

  // Build address→name lookup
  const allUsers = await db.select().from(schema.users)
  const allPerson = await db.select().from(schema.personAgents)
  const allOrg = await db.select().from(schema.orgAgents)
  const allAI = await db.select().from(schema.aiAgents)
  const nameMap = new Map<string, string>()
  for (const p of allPerson) {
    const u = allUsers.find((u) => u.id === p.userId)
    nameMap.set(p.smartAccountAddress.toLowerCase(), (p as Record<string, unknown>).name as string || u?.name || 'Person Agent')
  }
  for (const o of allOrg) nameMap.set(o.smartAccountAddress.toLowerCase(), o.name)
  for (const a of allAI) nameMap.set(a.smartAccountAddress.toLowerCase(), a.name)
  for (const u of allUsers) {
    if (u.walletAddress) nameMap.set(u.walletAddress.toLowerCase(), u.name)
  }
  const getName = (a: string) => nameMap.get(a.toLowerCase()) ?? `${a.slice(0, 6)}...${a.slice(-4)}`

  // Build set of addresses relevant to selected org
  const orgScopeAddrs = new Set<string>()
  if (selectedOrg) {
    orgScopeAddrs.add(selectedOrg.smartAccountAddress.toLowerCase())
    // Add all agents connected to this org (members, AI agents, partner orgs)
    try {
      for (const edgeId of await getEdgesByObject(selectedOrg.smartAccountAddress as `0x${string}`)) {
        const edge = await getEdge(edgeId)
        orgScopeAddrs.add(edge.subject.toLowerCase())
      }
      for (const edgeId of await getEdgesBySubject(selectedOrg.smartAccountAddress as `0x${string}`)) {
        const edge = await getEdge(edgeId)
        orgScopeAddrs.add(edge.object_.toLowerCase())
      }
    } catch { /* ignored */ }
    // Add AI agents operated by this org
    for (const a of allAI) {
      if (a.operatedBy?.toLowerCase() === selectedOrg.smartAccountAddress.toLowerCase()) {
        orgScopeAddrs.add(a.smartAccountAddress.toLowerCase())
      }
    }
  }

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

  try {
    const rCount = (await client.readContract({ address: reviewAddr, abi: agentReviewRecordAbi, functionName: 'reviewCount' })) as bigint
    for (let i = 0n; i < rCount; i++) {
      const r = (await client.readContract({ address: reviewAddr, abi: agentReviewRecordAbi, functionName: 'getReview', args: [i] })) as {
        reviewId: bigint; reviewer: string; subject: string; reviewType: `0x${string}`
        recommendation: `0x${string}`; overallScore: number; signedValue: bigint; valueDecimals: number
        tag1: string; tag2: string; endpoint: string; comment: string; evidenceURI: string
        feedbackHash: `0x${string}`; createdAt: bigint; revoked: boolean
      }
      // Filter to org scope if org is selected
      if (selectedOrg && !orgScopeAddrs.has(r.reviewer.toLowerCase()) && !orgScopeAddrs.has(r.subject.toLowerCase())) continue
      reviews.push({
        id: Number(r.reviewId),
        reviewer: getName(r.reviewer),
        subject: getName(r.subject),
        reviewType: TYPE_NAMES[r.reviewType] ?? 'Review',
        recommendation: REC_NAMES[r.recommendation] ?? 'unknown',
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
      if (selectedOrg && !orgScopeAddrs.has(d.filedBy.toLowerCase()) && !orgScopeAddrs.has(d.subject.toLowerCase())) continue
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
          <h1>Reviews & Disputes{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
          <Link href="/reviews/submit" data-component="section-action">+ Submit Review</Link>
        </div>
        <p>Structured review claims and adverse signals for agents in {selectedOrg ? selectedOrg.name : 'the trust fabric'}</p>
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
          <p data-component="text-muted">No reviews yet{selectedOrg ? ` for ${selectedOrg.name}` : ''}.</p>
        ) : (
          <table data-component="graph-table">
            <thead>
              <tr><th>Subject</th><th>Reviewer</th><th>Type</th><th>Score</th><th>Signal</th><th>Comment</th></tr>
            </thead>
            <tbody>
              {reviews.map((r) => {
                const signal = REC_LABELS[Object.entries(REC_NAMES).find(([, v]) => v === r.recommendation)?.[0] ?? ''] ?? 'neutral'
                return (
                <tr key={r.id}>
                  <td>{r.subject}</td>
                  <td>{r.reviewer}</td>
                  <td><span data-component="role-badge">{r.reviewType}</span></td>
                  <td><strong>{r.score}</strong>/100</td>
                  <td><span data-component="role-badge" data-status={signal === 'positive' ? 'active' : signal === 'negative' ? 'revoked' : 'proposed'}>{r.recommendation}</span></td>
                  <td style={{ maxWidth: 300, fontSize: '0.8rem', color: '#616161' }}>{r.comment}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section data-component="graph-section">
        <h2>Disputes ({disputes.length})</h2>
        {disputes.length === 0 ? (
          <p data-component="text-muted">No disputes filed{selectedOrg ? ` for ${selectedOrg.name}` : ''}.</p>
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
                  <td style={{ maxWidth: 300, fontSize: '0.8rem', color: '#616161' }}>{d.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
