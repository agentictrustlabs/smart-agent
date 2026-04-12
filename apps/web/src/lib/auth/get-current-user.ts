import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession, DEMO_USERS } from './session'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

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

  if (users[0]) return users[0]

  // In demo mode, auto-create user from DEMO_USERS if not in DB yet
  if (SKIP_AUTH) {
    const demoEntry = Object.entries(DEMO_USERS).find(([, u]) => u.userId === session.userId)
    if (demoEntry) {
      const [key, demo] = demoEntry
      try {
        await db.insert(schema.users).values({
          id: key,
          email: demo.email,
          name: demo.name,
          walletAddress: demo.walletAddress,
          privyUserId: demo.userId,
        })
        return {
          id: key,
          email: demo.email,
          name: demo.name,
          walletAddress: demo.walletAddress,
          privyUserId: demo.userId,
        }
      } catch {
        // Might race with another request — try reading again
        const retry = await db.select().from(schema.users)
          .where(eq(schema.users.privyUserId, session.userId)).limit(1)
        return retry[0] ?? null
      }
    }
  }

  return null
}
