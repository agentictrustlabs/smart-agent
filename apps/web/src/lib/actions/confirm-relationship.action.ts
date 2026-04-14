'use server'

import { requireSession } from '@/lib/auth/session'
import {
  confirmRelationship,
  rejectRelationship,
  getEdgeRoles,
} from '@/lib/contracts'
import { ROLE_REVIEWER } from '@smart-agent/sdk'

export async function confirmRelationshipAction(edgeId: string) {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'No wallet' }
    await confirmRelationship(edgeId as `0x${string}`)

    // Reviewer authority is derived from the active relationship itself.
    try {
      const roles = await getEdgeRoles(edgeId as `0x${string}`)
      roles.some((r) => r === ROLE_REVIEWER)
    } catch (e) {
      console.error('Failed to inspect reviewer roles after confirmation:', e)
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
