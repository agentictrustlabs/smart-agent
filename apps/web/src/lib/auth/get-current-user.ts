import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession } from './session'

export interface CurrentUser {
  id: string
  email: string | null
  name: string
  walletAddress: string
  did: string | null
}

/**
 * Get the current authenticated user from DB.
 * Works identically across all auth methods — every user row carries a
 * `did` (did:google:*, did:passkey:*, did:ethr:*, or did:demo:*).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession()
  if (!session) return null

  // Look up by did (works for OAuth/passkey/SIWE/demo users uniformly).
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.did, session.userId))
    .limit(1)

  return users[0] ?? null
}
