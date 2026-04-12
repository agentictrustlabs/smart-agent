'use server'

import { db, schema } from '@/db'
import { eq, and } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import {
  getWalletClient,
  redeemReviewDelegation,
  issueReviewDelegation,
  getEdgesBySubject,
  getEdge,
  getEdgeRoles,
} from '@/lib/contracts'
import { ROLE_REVIEWER } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'
import type { Delegation } from '@smart-agent/types'

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
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    if (!users[0]) return { success: false, error: 'User not found' }

    const personAgents = await db.select().from(schema.personAgents)
      .where(eq(schema.personAgents.userId, users[0].id)).limit(1)
    if (!personAgents[0]) return { success: false, error: 'Deploy a person agent first' }

    const myAgent = personAgents[0].smartAccountAddress as `0x${string}`
    const subjectAddr = input.subjectAddress as `0x${string}`

    // Verify reviewer has ACTIVE reviewer relationship to subject
    let hasReviewerRelationship = false
    try {
      const edgeIds = await getEdgesBySubject(myAgent)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.object_.toLowerCase() !== subjectAddr.toLowerCase()) continue
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

    // Look up the stored delegation for this reviewer→subject pair
    const storedDelegations = await db.select().from(schema.reviewDelegations)
      .where(and(
        eq(schema.reviewDelegations.reviewerAgentAddress, myAgent.toLowerCase()),
        eq(schema.reviewDelegations.subjectAgentAddress, subjectAddr.toLowerCase()),
        eq(schema.reviewDelegations.status, 'active'),
      ))
      .limit(1)

    let delegation: Delegation

    // Helper: issue fresh delegation and store
    const issueAndStore = async (edgeId: string) => {
      const result = await issueReviewDelegation({
        subjectAgentAddress: subjectAddr,
        reviewerAgentAddress: myAgent,
      })
      await db.insert(schema.reviewDelegations).values({
        id: crypto.randomUUID(),
        reviewerAgentAddress: myAgent.toLowerCase(),
        subjectAgentAddress: subjectAddr.toLowerCase(),
        edgeId,
        delegationJson: JSON.stringify(result.delegation, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v
        ),
        salt: result.delegation.salt.toString(),
        expiresAt: result.expiresAt,
      })
      return result.delegation
    }

    if (storedDelegations[0]) {
      // Check if delegation is expired or stale (wrong delegate address from old version)
      const expiresAt = new Date(storedDelegations[0].expiresAt)
      const parsed = JSON.parse(storedDelegations[0].delegationJson)
      // Delegate must be the deployer (server relays the call). Old delegations may have
      // the reviewer's agent as delegate — those need to be re-issued.
      const deployerAddr = getWalletClient().account!.address.toLowerCase()
      const needsReissue = expiresAt < new Date()
        || parsed.delegate?.toLowerCase() !== deployerAddr

      if (needsReissue) {
        // Mark old as expired and re-issue
        await db.update(schema.reviewDelegations)
          .set({ status: 'expired' })
          .where(eq(schema.reviewDelegations.id, storedDelegations[0].id))
        delegation = await issueAndStore(storedDelegations[0].edgeId)
      } else {
        // Parse stored delegation (restore bigint fields)
        delegation = {
          ...parsed,
          salt: BigInt(parsed.salt),
          caveats: parsed.caveats.map((c: { enforcer: string; terms: string; args?: string }) => ({
            enforcer: c.enforcer,
            terms: c.terms,
            args: c.args ?? '0x',
          })),
        } as Delegation
      }
    } else {
      // No delegation stored — issue a new one (fallback for existing relationships)
      delegation = await issueAndStore('')
    }

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
      reviewerAgentAddress: myAgent,
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
      const orgAgent = await db.select().from(schema.orgAgents)
        .where(eq(schema.orgAgents.smartAccountAddress, input.subjectAddress)).limit(1)
      if (orgAgent[0]) {
        await db.insert(schema.messages).values({
          id: crypto.randomUUID(),
          userId: orgAgent[0].createdBy,
          type: 'review_received',
          title: 'New review received',
          body: `Your agent ${orgAgent[0].name} received a ${input.recommendation} review (score: ${input.overallScore}/100)`,
          link: '/reviews',
        })
      }
    } catch { /* non-fatal */ }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to submit review' }
  }
}
