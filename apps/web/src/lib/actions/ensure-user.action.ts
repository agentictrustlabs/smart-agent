'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'

export interface EnsureUserInput {
  did: string
  walletAddress: string
  email: string | null
  name: string
}

export interface EnsureUserResult {
  userId: string
  isNewUser: boolean
}

export async function ensureUser(input: EnsureUserInput): Promise<EnsureUserResult> {
  // Check if user exists by DID
  const existing = await db
    .select()
    .from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.did, input.did))
    .limit(1)

  if (existing[0]) {
    return { userId: existing[0].id, isNewUser: false }
  }

  // Check by wallet address
  const byWallet = await db
    .select()
    .from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.walletAddress, input.walletAddress))
    .limit(1)

  if (byWallet[0]) {
    await db
      .update(schema.localUserAccounts)
      .set({ did: input.did })
      .where(eq(schema.localUserAccounts.id, byWallet[0].id))
    return { userId: byWallet[0].id, isNewUser: false }
  }

  // Create new user
  const userId = crypto.randomUUID()
  await db.insert(schema.localUserAccounts).values({
    id: userId,
    email: input.email,
    name: input.name,
    walletAddress: input.walletAddress,
    did: input.did,
  })

  return { userId, isNewUser: true }
}
