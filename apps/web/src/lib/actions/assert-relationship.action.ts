'use server'

import { requireSession } from '@/lib/auth/session'
import { createRelationship, confirmRelationship } from '@/lib/contracts'
import { scheduleKbSync } from '@/lib/ontology/kb-write-through'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  getRelationshipTypeDefinitionByHash,
  getRoleDefinitionByHash,
  relationshipTypeName,
  roleName,
} from '@smart-agent/sdk'
import { findAgentOwnerUserIds } from '@/lib/agent-resolver'
import { getAgentMetadata } from '@/lib/agent-metadata'

export interface AssertRelationshipInput {
  subjectAgentAddress: string
  objectAgentAddress: string
  relationshipType: `0x${string}`
  role: `0x${string}`
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
      .where(eq(schema.users.did, session.userId)).limit(1)
    const user = users[0]
    if (!user) return { success: false, error: 'User not found' }

    const relationshipTypeDef = getRelationshipTypeDefinitionByHash(input.relationshipType)
    const roleDef = getRoleDefinitionByHash(input.role)
    if (!relationshipTypeDef || !roleDef) {
      return { success: false, error: 'Unknown relationship type or role' }
    }

    if (!roleDef.relationshipTypeKeys.includes(relationshipTypeDef.key)) {
      return { success: false, error: 'Selected role is not valid for that relationship type' }
    }

    // Create the relationship edge (PROPOSED)
    const edgeId = await createRelationship({
      subject: input.subjectAgentAddress as `0x${string}`,
      object: input.objectAgentAddress as `0x${string}`,
      roles: [input.role],
      relationshipType: input.relationshipType,
    })
    scheduleKbSync()

    // Check if user owns the object agent (created it or has ownership relationship)
    const userOwnsObject = await checkUserOwnsAgent(user.id, input.objectAgentAddress)

    if (userOwnsObject) {
      // Auto-confirm: user owns both sides, no counterparty needed
      try {
        await confirmRelationship(edgeId)
        scheduleKbSync()

        return { success: true, edgeId, autoConfirmed: true }
      } catch {
        // Confirm failed but edge was created — still success, just not confirmed
        return { success: true, edgeId, autoConfirmed: false }
      }
    }

    // Different owner — send notification to object agent's owner
    try {
      const ownerIds = await findAgentOwnerUserIds(input.objectAgentAddress)
      const agentMeta = await getAgentMetadata(input.objectAgentAddress)
      const ownerId = ownerIds[0] ?? null
      const agentName = agentMeta.displayName || 'your agent'
      const roleLabel = roleName(input.role)
      const relationshipLabel = relationshipTypeName(input.relationshipType)

      if (ownerId) {
        await db.insert(schema.messages).values({
          id: crypto.randomUUID(),
          userId: ownerId,
          type: 'relationship_proposed',
          title: 'Relationship request',
          body: `Someone wants the "${roleLabel}" role in ${relationshipLabel} with ${agentName}. Review and confirm on the Relationships page.`,
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
  const ownerIds = await findAgentOwnerUserIds(agentAddress)
  return ownerIds.includes(userId)
}
