import { DEMO_USERS } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { seedCatalystOnChain } from './seed-catalyst-onchain'
import { seedCILOnChain } from './seed-cil-onchain'
import { seedGlobalChurchOnChain } from './seed-globalchurch-onchain'
import { seedMultiplyData } from './seed-multiply-data'

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
  // Each seed function is idempotent with its own concurrency lock.
  if (demoUserKey.startsWith('gc-user-')) {
    seedGlobalChurchOnChain().catch(err =>
      console.warn('[demo-seed] Background Global.Church on-chain seeding failed:', err)
    )
  } else if (demoUserKey.startsWith('cil-user-')) {
    seedCILOnChain().catch(err =>
      console.warn('[demo-seed] Background CIL on-chain seeding failed:', err)
    )
  } else if (demoUserKey.startsWith('cat-user-')) {
    seedCatalystOnChain().catch(err =>
      console.warn('[demo-seed] Background Catalyst on-chain seeding failed:', err)
    )
  } else {
    seedCatalystOnChain().catch(err =>
      console.warn('[demo-seed] Background on-chain seeding failed:', err)
    )
  }

  // Seed personal Multiply data (circles, prayers, training, coach relationships).
  // Runs synchronously (DB-only, fast) and is idempotent.
  seedMultiplyData()
}
