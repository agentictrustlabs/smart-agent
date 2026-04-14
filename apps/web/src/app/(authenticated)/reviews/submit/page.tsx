import { redirect } from 'next/navigation'
import { db, schema } from '@/db'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { REVIEW_RELATIONSHIP, ROLE_REVIEWER } from '@smart-agent/sdk'
import { SubmitReviewClient } from './SubmitReviewClient'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { listRegisteredAgents } from '@/lib/agent-resolver'

export default async function SubmitReviewPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const myPersonAgent = await getPersonAgentForUser(currentUser.id)

  if (!myPersonAgent) {
    return (
      <div data-page="submit-review">
        <div data-component="page-header">
          <h1>Submit Review</h1>
        </div>
        <div data-component="empty-state">
          <p>Deploy a Person Agent first.</p>
          <a href="/deploy/person">Deploy Person Agent</a>
        </div>
      </div>
    )
  }

  // Find agents where user has active reviewer relationship
  const reviewableAgents: Array<{ address: string; name: string; delegationStatus: string; delegationExpiry: string | null }> = []
  const allAgents = await listRegisteredAgents()
  const allUsers = await db.select().from(schema.users)

  const getName = (addr: string) => {
    const agent = allAgents.find((entry) => entry.address.toLowerCase() === addr.toLowerCase())
    if (agent?.name) return agent.name
    const p = allAgents.find((entry) => entry.kind === 'person' && entry.address.toLowerCase() === addr.toLowerCase())
    if (p) {
      const u = allUsers.find((user) =>
        p.controllers.some(controller => controller.toLowerCase() === user.walletAddress.toLowerCase())
      )
      return p.name || u?.name || 'Agent'
    }
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  try {
    const edgeIds = await getEdgesBySubject(myPersonAgent as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.relationshipType !== REVIEW_RELATIONSHIP) continue
      if (edge.status < 2) continue // need confirmed or active
      const roles = await getEdgeRoles(edgeId)
      if (roles.some((r) => r === ROLE_REVIEWER)) {
        reviewableAgents.push({
          address: edge.object_,
          name: getName(edge.object_),
          delegationStatus: 'available',
          delegationExpiry: null,
        })
      }
    }
  } catch { /* contracts may not be available */ }

  if (reviewableAgents.length === 0) {
    return (
      <div data-page="submit-review">
        <div data-component="page-header">
          <h1>Submit Review</h1>
          <p>Submit structured reviews for agents you have a reviewer relationship with.</p>
        </div>
        <div data-component="empty-state">
          <p>No reviewable agents found. You need an active reviewer relationship first.</p>
          <p style={{ fontSize: '0.85rem', color: '#616161', marginTop: '0.5rem' }}>
            Go to <a href="/relationships">Relationships</a>, select your agent,
            pick a target agent, choose the "Reviewer" role, and wait for the owner to confirm.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div data-page="submit-review">
      <div data-component="page-header">
        <h1>Submit Review</h1>
        <p>Submit a structured review for an agent you have an active reviewer relationship with.
           Reviews are submitted on-chain via delegated execution (ERC-7710).</p>
      </div>

      <SubmitReviewClient reviewableAgents={reviewableAgents} />
    </div>
  )
}
