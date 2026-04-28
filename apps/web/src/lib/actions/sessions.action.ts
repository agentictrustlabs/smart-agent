'use server'

/**
 * Server actions for the Settings → Active Sessions tab (design doc M5).
 *
 *   listActiveSessionsAction      — read SessionRecord rows for the
 *                                   current user's smart account.
 *   revokeSessionAction(id)       — single-session revocation; the next
 *                                   verifier call sees revokedAt and
 *                                   rejects with session_revoked.
 *   bumpRevocationEpochAction()   — panic button. Increments the per-account
 *                                   epoch; every existing grant becomes
 *                                   invalid (epoch_mismatch), forcing a
 *                                   fresh signin ceremony.
 */

import { requireSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  listActiveSessions,
  revokeSessionByCookie,
  bumpRevocationEpoch,
} from '@/lib/auth/person-mcp-session-client'

export interface SessionSummary {
  sessionId: string
  sessionSignerAddress: string
  audience: string[]
  maxRisk: 'low' | 'medium'
  createdAt: string
  idleExpiresAt: string
  expiresAt: string
}

async function loadCurrentSmartAccount(): Promise<`0x${string}` | null> {
  const session = await requireSession()
  const rows = await db.select().from(schema.users)
    .where(eq(schema.users.did, session.userId))
    .limit(1)
  const u = rows[0]
  return (u?.smartAccountAddress as `0x${string}` | undefined) ?? null
}

export async function listActiveSessionsAction(): Promise<{
  success: boolean
  sessions?: SessionSummary[]
  error?: string
}> {
  try {
    const account = await loadCurrentSmartAccount()
    if (!account) return { success: false, error: 'no smart account on file' }
    const records = await listActiveSessions(account)
    return {
      success: true,
      sessions: records.map(r => ({
        sessionId: r.sessionId,
        sessionSignerAddress: r.sessionSignerAddress,
        audience: r.grant.audience,
        maxRisk: r.grant.scope.maxRisk,
        createdAt: new Date(r.createdAt).toISOString(),
        idleExpiresAt: new Date(r.idleExpiresAt).toISOString(),
        expiresAt: new Date(r.expiresAt).toISOString(),
      })),
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export async function revokeSessionAction(sessionId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSession()  // gate
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId required' }
    }
    await revokeSessionByCookie(sessionId)
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export async function bumpRevocationEpochAction(): Promise<{ success: boolean; epoch?: number; error?: string }> {
  try {
    const account = await loadCurrentSmartAccount()
    if (!account) return { success: false, error: 'no smart account on file' }
    const epoch = await bumpRevocationEpoch(account)
    return { success: true, epoch }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
