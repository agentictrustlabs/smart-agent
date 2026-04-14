import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { deployPersonAgent } from '@/lib/actions/deploy-person-agent.action'

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

  return NextResponse.json({
    name: user.name,
    email: user.email,
    walletAddress: user.walletAddress,
    smartAccountAddress: await getPersonAgentForUser(user.id),
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

  // Auto-deploy person agent if user doesn't have one yet
  try {
    const user = (await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1))[0]
    if (user) {
      const existingAgent = await getPersonAgentForUser(user.id)
      if (!existingAgent && session.walletAddress) {
        await deployPersonAgent(name.trim())
      }
    }
  } catch (e) {
    console.warn('Auto-deploy person agent failed (non-fatal):', e)
  }

  return NextResponse.json({ success: true, name: name.trim() })
}
