import { DEMO_USERS } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'

/**
 * Ensure demo user exists in the DB (for Privy auth mapping).
 * All agent data (identity, relationships, metadata) is on-chain via shell seed scripts.
 * This only creates the `users` row if it doesn't exist.
 */
export async function ensureDemoCommunitySeeded(demoUserKey: string) {
  const demo = DEMO_USERS[demoUserKey]
  if (!demo) return

  // Ensure user row exists (the only DB table we need)
  const existing = db.select().from(schema.users).where(eq(schema.users.privyUserId, demo.userId)).get()
  if (!existing) {
    try {
      db.insert(schema.users).values({
        id: demoUserKey,
        email: demo.email,
        name: demo.name,
        walletAddress: demo.walletAddress,
        privyUserId: demo.userId,
      }).run()
    } catch { /* already exists */ }
  }
}
