/**
 * Look up demo user wallet addresses from the DB.
 * Returns real addresses generated at login time.
 * If a user hasn't logged in yet, generates their wallet now.
 */

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { DEMO_USER_META } from '@/lib/auth/session'
import { generateDemoWallet } from './generate-wallet'

/**
 * Ensure a demo user exists in the DB with a real wallet.
 * If they don't exist, creates them with a generated keypair + deployed AgentAccount.
 * Returns the user's wallet address and smart account address.
 */
export async function ensureDemoUser(userKey: string): Promise<{
  walletAddress: string
  smartAccountAddress: string
}> {
  const meta = DEMO_USER_META[userKey]
  if (!meta) throw new Error(`Unknown demo user: ${userKey}`)

  // Check if already exists
  const existing = await db.select().from(schema.users)
    .where(eq(schema.users.id, userKey)).limit(1)

  if (existing[0]?.smartAccountAddress) {
    return {
      walletAddress: existing[0].walletAddress,
      smartAccountAddress: existing[0].smartAccountAddress,
    }
  }

  // Generate wallet and create user
  const wallet = await generateDemoWallet()

  if (existing[0]) {
    // User exists but no smart account — update
    await db.update(schema.users)
      .set({
        walletAddress: wallet.address,
        privateKey: wallet.privateKey,
        smartAccountAddress: wallet.smartAccountAddress,
      })
      .where(eq(schema.users.id, userKey))
  } else {
    // Create new user
    await db.insert(schema.users).values({
      id: userKey,
      email: meta.email,
      name: meta.name,
      walletAddress: wallet.address,
      privyUserId: meta.userId,
      privateKey: wallet.privateKey,
      smartAccountAddress: wallet.smartAccountAddress,
    })
  }

  console.log(`[demo-seed] Provisioned ${meta.name}: EOA=${wallet.address}, SmartAccount=${wallet.smartAccountAddress}`)

  return {
    walletAddress: wallet.address,
    smartAccountAddress: wallet.smartAccountAddress,
  }
}

/**
 * Get all demo user addresses for a community prefix.
 * Ensures all users exist with real wallets.
 */
export async function ensureCommunityUsers(prefix: string): Promise<
  Array<{ key: string; walletAddress: string; smartAccountAddress: string; name: string }>
> {
  const users = Object.entries(DEMO_USER_META)
    .filter(([key]) => key.startsWith(prefix))

  const results = []
  for (const [key, meta] of users) {
    const addrs = await ensureDemoUser(key)
    results.push({ key, ...addrs, name: meta.name })
  }
  return results
}
