'use server'

import { requireSession } from '@/lib/auth/session'
import { createRelationship } from '@/lib/contracts'
import {
  ORGANIZATION_MEMBERSHIP,
  ROLE_OWNER,
  ROLE_ADMIN,
  ROLE_MEMBER,
  ROLE_OPERATOR,
  ROLE_AUDITOR,
  ROLE_VENDOR,
} from '@smart-agent/sdk'

const ROLE_MAP: Record<string, `0x${string}`> = {
  owner: ROLE_OWNER,
  admin: ROLE_ADMIN,
  member: ROLE_MEMBER,
  operator: ROLE_OPERATOR,
  auditor: ROLE_AUDITOR,
  vendor: ROLE_VENDOR,
}

export interface AssertRelationshipInput {
  personAgentAddress: string
  orgAgentAddress: string
  role: string
}

export interface AssertRelationshipResult {
  success: boolean
  edgeId?: string
  error?: string
}

/**
 * Create a full relationship on-chain (3 transactions):
 * 1. AgentRelationship.createEdge() — edge primitive (PROPOSED)
 * 2. AgentRelationship.setEdgeStatus(ACTIVE) — activate
 * 3. AgentAssertion.makeAssertion(OBJECT_ASSERTED) — provenance claim
 */
export async function assertRelationship(
  input: AssertRelationshipInput,
): Promise<AssertRelationshipResult> {
  try {
    const session = await requireSession()
    if (!session.walletAddress) {
      return { success: false, error: 'No wallet connected' }
    }

    const roleHash = ROLE_MAP[input.role]
    if (!roleHash) {
      return { success: false, error: `Unknown role: ${input.role}` }
    }

    const edgeId = await createRelationship({
      subject: input.personAgentAddress as `0x${string}`,
      object: input.orgAgentAddress as `0x${string}`,
      roles: [roleHash],
      relationshipType: ORGANIZATION_MEMBERSHIP,
    })

    return { success: true, edgeId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create relationship'
    console.error('Create relationship failed:', message)
    return { success: false, error: message }
  }
}
