import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession } from './session'

export interface CurrentUser {
  id: string
  email: string | null
  name: string
  walletAddress: string
  privyUserId: string | null
}

/**
 * Get the current authenticated user from DB.
 * Works identically for Privy users and demo users — both have real
 * DB records with privyUserId set (demo users set it to their did:privy:* value).
 * No SKIP_AUTH branches.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession()
  if (!session) return null

  // Look up by privyUserId (works for both Privy and demo users)
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.privyUserId, session.userId))
    .limit(1)

  return users[0] ?? null
}
