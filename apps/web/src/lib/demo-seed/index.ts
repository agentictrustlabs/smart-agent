import { DEMO_USERS } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { seedCatalystOnChain } from './seed-catalyst-onchain'

/**
 * Ensure demo community is fully seeded — DB user rows + on-chain agents.
 * Called on first demo login. seedCatalystOnChain() is idempotent and
 * has its own concurrency guard, so safe to call on every login.
 *
 * On-chain seeding is fired in the background so the login response
 * returns immediately. The dashboard will pick up agents once seeding
 * completes (or they can be pre-seeded via scripts/seed-catalyst.sh).
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

  // Fire on-chain seeding in background — don't block the login response.
  // seedCatalystOnChain is idempotent with its own concurrency lock.
  seedCatalystOnChain().catch(err =>
    console.warn('[demo-seed] Background on-chain seeding failed:', err)
  )
}
