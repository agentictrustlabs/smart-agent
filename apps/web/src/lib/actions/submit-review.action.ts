'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import {
  redeemReviewDelegation,
  issueReviewDelegation,
  getEdgesBySubject,
  getEdge,
  getEdgeRoles,
} from '@/lib/contracts'
import { REVIEW_RELATIONSHIP, ROLE_REVIEWER } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'
import type { Delegation } from '@smart-agent/types'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { findAgentOwnerUserIds } from '@/lib/agent-resolver'
import { getAgentMetadata } from '@/lib/agent-metadata'

// Review type hashes
const REVIEW_TYPES: Record<string, `0x${string}`> = {
  performance: keccak256(toBytes('PerformanceReview')),
  trust: keccak256(toBytes('TrustReview')),
  quality: keccak256(toBytes('QualityReview')),
  compliance: keccak256(toBytes('ComplianceReview')),
  safety: keccak256(toBytes('SafetyReview')),
}

const RECOMMENDATIONS: Record<string, `0x${string}`> = {
  endorses: keccak256(toBytes('endorses')),
  recommends: keccak256(toBytes('recommends')),
  neutral: keccak256(toBytes('neutral')),
  flags: keccak256(toBytes('flags')),
  disputes: keccak256(toBytes('disputes')),
}

const DIMENSIONS: Record<string, `0x${string}`> = {
  accuracy: keccak256(toBytes('accuracy')),
  reliability: keccak256(toBytes('reliability')),
  responsiveness: keccak256(toBytes('responsiveness')),
  compliance: keccak256(toBytes('compliance')),
  safety: keccak256(toBytes('safety')),
  transparency: keccak256(toBytes('transparency')),
  helpfulness: keccak256(toBytes('helpfulness')),
}

export interface SubmitReviewInput {
  subjectAddress: string
  reviewType: string
  recommendation: string
  overallScore: number
  dimensions: Array<{ dimension: string; score: number }>
  comment: string
}

export interface SubmitReviewResult {
  success: boolean
  error?: string
}

export async function submitReview(input: SubmitReviewInput): Promise<SubmitReviewResult> {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'Not connected' }

    // Get user's person agent
    const users = await db.select().from(schema.users)
      .where(eq(schema.users.did, session.userId)).limit(1)
    if (!users[0]) return { success: false, error: 'User not found' }

    const myAgent = await getPersonAgentForUser(users[0].id)
    if (!myAgent) return { success: false, error: 'Deploy a person agent first' }
    const myAgentAddr = myAgent as `0x${string}`
    const subjectAddr = input.subjectAddress as `0x${string}`

    // Verify reviewer has ACTIVE reviewer relationship to subject
    let hasReviewerRelationship = false
    try {
      const edgeIds = await getEdgesBySubject(myAgentAddr)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.object_.toLowerCase() !== subjectAddr.toLowerCase()) continue
        if (edge.relationshipType !== REVIEW_RELATIONSHIP) continue
        if (edge.status < 2) continue // not confirmed or active
        const roles = await getEdgeRoles(edgeId)
        if (roles.some((r) => r === ROLE_REVIEWER)) {
          hasReviewerRelationship = true
          break
        }
      }
    } catch { /* contracts may not be available */ }

    if (!hasReviewerRelationship) {
      return { success: false, error: 'You need an active reviewer relationship with this agent. Request a reviewer role first and wait for approval.' }
    }

    const { delegation } = await issueReviewDelegation({
      subjectAgentAddress: subjectAddr,
      reviewerAgentAddress: myAgentAddr,
    }) as { delegation: Delegation; expiresAt: string }

    // Validate inputs
    const reviewTypeHash = REVIEW_TYPES[input.reviewType]
    const recHash = RECOMMENDATIONS[input.recommendation]
    if (!reviewTypeHash || !recHash) return { success: false, error: 'Invalid review type or recommendation' }

    const dimensionTuples = input.dimensions
      .filter((d) => DIMENSIONS[d.dimension])
      .map((d) => ({
        dimension: DIMENSIONS[d.dimension],
        score: Math.min(100, Math.max(0, d.score)),
      }))

    // Submit review via DelegationManager.redeemDelegation()
    // The delegation proves: subject agent authorized reviewer to call createReview
    // The DelegationManager validates caveats (time + method + target) and
    // executes through the subject agent's smart account
    await redeemReviewDelegation({
      delegation,
      reviewerAgentAddress: myAgentAddr,
      subjectAgentAddress: subjectAddr,
      reviewType: reviewTypeHash,
      recommendation: recHash,
      overallScore: Math.min(100, Math.max(0, input.overallScore)),
      dimensions: dimensionTuples,
      comment: input.comment,
      evidenceURI: '',
    })

    // Notify subject agent owner
    try {
      const ownerIds = await findAgentOwnerUserIds(input.subjectAddress)
      if (ownerIds.length > 0) {
        const subjectMeta = await getAgentMetadata(input.subjectAddress)
        await db.insert(schema.messages).values({
          id: crypto.randomUUID(),
          userId: ownerIds[0],
          type: 'review_received',
          title: 'New review received',
          body: `Your agent ${subjectMeta.displayName} received a ${input.recommendation} review (score: ${input.overallScore}/100)`,
          link: '/reviews',
        })
      }
    } catch { /* non-fatal */ }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to submit review' }
  }
}
