'use server'

import { requireSession } from '@/lib/auth/session'
import { createRelationship, confirmRelationship, issueReviewDelegation } from '@/lib/contracts'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { keccak256, toBytes } from 'viem'
import { ORGANIZATION_MEMBERSHIP, ROLE_REVIEWER } from '@smart-agent/sdk'

function roleToHash(role: string): `0x${string}` {
  return keccak256(toBytes(role))
}

export interface AssertRelationshipInput {
  personAgentAddress: string
  orgAgentAddress: string
  role: string
}

export interface AssertRelationshipResult {
  success: boolean
  edgeId?: string
  autoConfirmed?: boolean
  error?: string
}

export async function assertRelationship(
  input: AssertRelationshipInput,
): Promise<AssertRelationshipResult> {
  try {
    const session = await requireSession()
    if (!session.walletAddress) {
      return { success: false, error: 'No wallet connected' }
    }

    // Get current user
    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    const user = users[0]
    if (!user) return { success: false, error: 'User not found' }

    const roleHash = roleToHash(input.role)

    // Create the relationship edge (PROPOSED)
    const edgeId = await createRelationship({
      subject: input.personAgentAddress as `0x${string}`,
      object: input.orgAgentAddress as `0x${string}`,
      roles: [roleHash],
      relationshipType: ORGANIZATION_MEMBERSHIP,
    })

    // Check if user owns the object agent (created it or has ownership relationship)
    const userOwnsObject = await checkUserOwnsAgent(user.id, input.orgAgentAddress)

    if (userOwnsObject) {
      // Auto-confirm: user owns both sides, no counterparty needed
      try {
        await confirmRelationship(edgeId)

        // Auto-issue review delegation if this is a reviewer relationship
        if (roleHash === keccak256(toBytes('reviewer'))) {
          try {
            const { delegation, expiresAt } = await issueReviewDelegation({
              subjectAgentAddress: input.orgAgentAddress as `0x${string}`,
              reviewerAgentAddress: input.personAgentAddress as `0x${string}`,
            })
            await db.insert(schema.reviewDelegations).values({
              id: crypto.randomUUID(),
              reviewerAgentAddress: input.personAgentAddress.toLowerCase(),
              subjectAgentAddress: input.orgAgentAddress.toLowerCase(),
              edgeId,
              delegationJson: JSON.stringify(delegation, (_, v) =>
                typeof v === 'bigint' ? v.toString() : v
              ),
              salt: delegation.salt.toString(),
              expiresAt,
            })
          } catch (e) {
            console.error('Failed to auto-issue review delegation:', e)
          }
        }

        return { success: true, edgeId, autoConfirmed: true }
      } catch {
        // Confirm failed but edge was created — still success, just not confirmed
        return { success: true, edgeId, autoConfirmed: false }
      }
    }

    // Different owner — send notification to object agent's owner
    try {
      const orgAgent = await db.select().from(schema.orgAgents)
        .where(eq(schema.orgAgents.smartAccountAddress, input.orgAgentAddress)).limit(1)
      if (orgAgent[0]) {
        await db.insert(schema.messages).values({
          id: crypto.randomUUID(),
          userId: orgAgent[0].createdBy,
          type: 'relationship_proposed',
          title: 'Relationship request',
          body: `Someone wants to be "${input.role}" of ${orgAgent[0].name}. Review and confirm on the Relationships page.`,
          link: '/relationships',
        })
      }
    } catch { /* non-fatal */ }

    return { success: true, edgeId, autoConfirmed: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create relationship'
    console.error('Create relationship failed:', message)
    return { success: false, error: message }
  }
}

/** Check if user owns an agent (created it or is a person agent owner) */
async function checkUserOwnsAgent(userId: string, agentAddress: string): Promise<boolean> {
  const orgAgent = await db.select().from(schema.orgAgents)
    .where(eq(schema.orgAgents.smartAccountAddress, agentAddress)).limit(1)
  if (orgAgent[0] && orgAgent[0].createdBy === userId) return true

  const personAgent = await db.select().from(schema.personAgents)
    .where(eq(schema.personAgents.smartAccountAddress, agentAddress)).limit(1)
  if (personAgent[0] && personAgent[0].userId === userId) return true

  const aiAgent = await db.select().from(schema.aiAgents)
    .where(eq(schema.aiAgents.smartAccountAddress, agentAddress)).limit(1)
  if (aiAgent[0] && aiAgent[0].createdBy === userId) return true

  return false
}
