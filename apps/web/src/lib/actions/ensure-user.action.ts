'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'

export interface EnsureUserInput {
  privyUserId: string
  walletAddress: string
  email: string | null
  name: string
}

export interface EnsureUserResult {
  userId: string
  isNewUser: boolean
}

export async function ensureUser(input: EnsureUserInput): Promise<EnsureUserResult> {
  // Check if user exists by privy ID
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.privyUserId, input.privyUserId))
    .limit(1)

  if (existing[0]) {
    return { userId: existing[0].id, isNewUser: false }
  }

  // Check by wallet address
  const byWallet = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.walletAddress, input.walletAddress))
    .limit(1)

  if (byWallet[0]) {
    await db
      .update(schema.users)
      .set({ privyUserId: input.privyUserId })
      .where(eq(schema.users.id, byWallet[0].id))
    return { userId: byWallet[0].id, isNewUser: false }
  }

  // Create new user
  const userId = crypto.randomUUID()
  await db.insert(schema.users).values({
    id: userId,
    email: input.email,
    name: input.name,
    walletAddress: input.walletAddress,
    privyUserId: input.privyUserId,
  })

  return { userId, isNewUser: true }
}
