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

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession()
  if (!session) return null

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.privyUserId, session.userId))
    .limit(1)

  return users[0] ?? null
}
