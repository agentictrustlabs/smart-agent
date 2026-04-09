import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { walletAddress, email, name } = body as {
    walletAddress: string
    email: string | null
    name: string
  }

  // Check if user exists by privy ID
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.privyUserId, session.userId))
    .limit(1)

  if (existing[0]) {
    return NextResponse.json({ userId: existing[0].id, isNewUser: false })
  }

  // Check by wallet address
  const byWallet = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.walletAddress, walletAddress))
    .limit(1)

  if (byWallet[0]) {
    await db
      .update(schema.users)
      .set({ privyUserId: session.userId })
      .where(eq(schema.users.id, byWallet[0].id))
    return NextResponse.json({ userId: byWallet[0].id, isNewUser: false })
  }

  // Create new user
  const userId = crypto.randomUUID()
  await db.insert(schema.users).values({
    id: userId,
    email,
    name: name || 'Agent User',
    walletAddress,
    privyUserId: session.userId,
  })

  return NextResponse.json({ userId, isNewUser: true })
}
