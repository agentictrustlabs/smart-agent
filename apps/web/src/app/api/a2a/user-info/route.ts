import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'

/**
 * GET /api/a2a/user-info
 * Returns the current user's smart account address (if deployed).
 */
export async function GET() {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const users = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress))
    .limit(1)

  const user = users[0]
  return NextResponse.json({
    walletAddress: session.walletAddress,
    smartAccountAddress: user?.smartAccountAddress ?? null,
    hasPrivateKey: !!user?.privateKey,
  })
}
