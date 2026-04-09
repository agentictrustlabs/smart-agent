'use server'

import { requireSession } from '@/lib/auth/session'
import { confirmRelationship, rejectRelationship } from '@/lib/contracts'

export async function confirmRelationshipAction(edgeId: string) {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'No wallet' }
    await confirmRelationship(edgeId as `0x${string}`)
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
