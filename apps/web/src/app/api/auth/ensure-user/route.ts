/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { validateRequest } from '@/lib/auth/validate-request'

const BodySchema = z.object({
  walletAddress: z.string().min(2).max(64),
  email: z.string().max(320).nullable(),
  name: z.string().max(256),
})

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await validateRequest(request, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const { walletAddress, email, name } = parsed.data

  // Check if user exists by DID
  const existing = await db
    .select()
    .from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.did, session.userId))
    .limit(1)

  if (existing[0]) {
    return NextResponse.json({ userId: existing[0].id, isNewUser: false })
  }

  // Check by wallet address
  const byWallet = await db
    .select()
    .from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.walletAddress, walletAddress))
    .limit(1)

  if (byWallet[0]) {
    await db
      .update(schema.localUserAccounts)
      .set({ did: session.userId })
      .where(eq(schema.localUserAccounts.id, byWallet[0].id))
    return NextResponse.json({ userId: byWallet[0].id, isNewUser: false })
  }

  // Create new user
  const userId = crypto.randomUUID()
  await db.insert(schema.localUserAccounts).values({
    id: userId,
    email,
    name: name || 'Agent User',
    walletAddress,
    did: session.userId,
  })

  return NextResponse.json({ userId, isNewUser: true })
}
