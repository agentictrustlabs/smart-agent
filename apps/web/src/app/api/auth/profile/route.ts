import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Get user from DB
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.privyUserId, session.userId))
    .limit(1)

  const user = users[0]
  if (!user) {
    return NextResponse.json({
      name: null,
      walletAddress: session.walletAddress,
      smartAccountAddress: null,
    })
  }

  // Get person agent (smart account)
  const agents = await db
    .select()
    .from(schema.personAgents)
    .where(eq(schema.personAgents.userId, user.id))
    .limit(1)

  return NextResponse.json({
    name: user.name,
    email: user.email,
    walletAddress: user.walletAddress,
    smartAccountAddress: agents[0]?.smartAccountAddress ?? null,
  })
}

export async function PUT(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const { name, email } = body as { name?: string; email?: string }

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const updates: Record<string, string> = { name: name.trim() }
  if (email?.trim()) updates.email = email.trim()

  await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.privyUserId, session.userId))

  return NextResponse.json({ success: true, name: name.trim() })
}
