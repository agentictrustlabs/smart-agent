import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession } from './session'

export interface CurrentUser {
  id: string
  email: string | null
  name: string
  walletAddress: string
  did: string | null
  smartAccountAddress?: string | null
  /** Auth method that produced this session. */
  via?: 'demo' | 'passkey' | 'siwe' | 'google' | null
}

/**
 * Get the current authenticated user.
 *
 * Passkey + SIWE users have no `users` row — their identity is anchored
 * on chain (AgentNameResolver → AgentAccount → ERC-1271) and the session
 * JWT carries everything we need (walletAddress, smartAccountAddress,
 * name, did). For those flows we synthesise the CurrentUser directly
 * from the token; `id` is the smart-account address (a stable handle
 * downstream code can use as the user identifier).
 *
 * Demo + Google users still have a `users` row (demo because we hold
 * their EOA private key; google for the OAuth profile). For them we
 * fall through to a DB lookup keyed on the session DID.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession()
  if (!session) return null

  if (session.via === 'passkey' || session.via === 'siwe') {
    const smartAcct = session.smartAccountAddress ?? null
    return {
      id: smartAcct ?? session.userId,
      email: session.email,
      name: session.name ?? '',
      walletAddress: session.walletAddress ?? '',
      did: session.userId,
      smartAccountAddress: smartAcct,
      via: session.via,
    }
  }

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.did, session.userId))
    .limit(1)

  const row = users[0]
  if (!row) return null
  return {
    ...row,
    smartAccountAddress: row.smartAccountAddress ?? null,
    via: session.via ?? null,
  }
}
