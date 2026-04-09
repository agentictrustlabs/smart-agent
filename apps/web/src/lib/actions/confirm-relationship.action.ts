'use server'

import { requireSession } from '@/lib/auth/session'
import {
  confirmRelationship,
  rejectRelationship,
  getEdge,
  getEdgeRoles,
  issueReviewDelegation,
} from '@/lib/contracts'
import { ROLE_REVIEWER } from '@smart-agent/sdk'
import { db, schema } from '@/db'

export async function confirmRelationshipAction(edgeId: string) {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'No wallet' }
    await confirmRelationship(edgeId as `0x${string}`)

    // Auto-issue review delegation if this is a reviewer relationship
    try {
      const roles = await getEdgeRoles(edgeId as `0x${string}`)
      const isReviewer = roles.some((r) => r === ROLE_REVIEWER)
      if (isReviewer) {
        const edge = await getEdge(edgeId as `0x${string}`)
        // subject = reviewer's person agent, object_ = agent being reviewed
        const { delegation, expiresAt } = await issueReviewDelegation({
          subjectAgentAddress: edge.object_,  // delegator = agent being reviewed
          reviewerAgentAddress: edge.subject,  // delegate = reviewer
        })

        // Store the delegation in DB
        await db.insert(schema.reviewDelegations).values({
          id: crypto.randomUUID(),
          reviewerAgentAddress: edge.subject.toLowerCase(),
          subjectAgentAddress: edge.object_.toLowerCase(),
          edgeId,
          delegationJson: JSON.stringify(delegation, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v
          ),
          salt: delegation.salt.toString(),
          expiresAt,
        })
      }
    } catch (e) {
      // Non-fatal — delegation issuance failure shouldn't block confirmation
      console.error('Failed to auto-issue review delegation:', e)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to confirm' }
  }
}

export async function rejectRelationshipAction(edgeId: string) {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'No wallet' }
    await rejectRelationship(edgeId as `0x${string}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to reject' }
  }
}
