import { redirect } from 'next/navigation'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { ROLE_REVIEWER } from '@smart-agent/sdk'
import { SubmitReviewClient } from './SubmitReviewClient'

export default async function SubmitReviewPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const personAgents = await db.select().from(schema.personAgents)
    .where(eq(schema.personAgents.userId, currentUser.id)).limit(1)

  if (!personAgents[0]) {
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
  const reviewableAgents: Array<{ address: string; name: string }> = []
  const allOrgs = await db.select().from(schema.orgAgents)
  const allPerson = await db.select().from(schema.personAgents)
  const allUsers = await db.select().from(schema.users)

  const getName = (addr: string) => {
    const org = allOrgs.find((o) => o.smartAccountAddress.toLowerCase() === addr.toLowerCase())
    if (org) return org.name
    const p = allPerson.find((p) => p.smartAccountAddress.toLowerCase() === addr.toLowerCase())
    if (p) {
      const u = allUsers.find((u) => u.id === p.userId)
      return (p as Record<string, unknown>).name as string || u?.name || 'Agent'
    }
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  try {
    const edgeIds = await getEdgesBySubject(personAgents[0].smartAccountAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue // need confirmed or active
      const roles = await getEdgeRoles(edgeId)
      if (roles.some((r) => r === ROLE_REVIEWER)) {
        reviewableAgents.push({
          address: edge.object_,
          name: getName(edge.object_),
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
          <p style={{ fontSize: '0.85rem', color: '#8888a0', marginTop: '0.5rem' }}>
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
           This review is recorded on-chain via the DelegationManager.</p>
      </div>

      <SubmitReviewClient reviewableAgents={reviewableAgents} />
    </div>
  )
}
