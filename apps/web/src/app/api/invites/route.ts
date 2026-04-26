import { NextResponse } from 'next/server'
import { eq,  } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ invites: [] })

  const users = await db.select().from(schema.users).where(eq(schema.users.did, session.userId)).limit(1)
  if (!users[0]) return NextResponse.json({ invites: [] })

  const invites = await db.select().from(schema.invites)
    .where(eq(schema.invites.createdBy, users[0].id))

  return NextResponse.json({ invites })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const users = await db.select().from(schema.users).where(eq(schema.users.did, session.userId)).limit(1)
  if (!users[0]) return NextResponse.json({ error: 'User not found' }, { status: 400 })

  const body = await request.json()
  const { agentAddress, agentName, role } = body

  const code = crypto.randomUUID().slice(0, 8)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  await db.insert(schema.invites).values({
    id: crypto.randomUUID(),
    code,
    agentAddress,
    agentName: agentName || 'Agent',
    role: role || 'owner',
    createdBy: users[0].id,
    expiresAt,
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  return NextResponse.json({
    success: true,
    code,
    link: `${appUrl}/invite/${code}`,
    expiresAt,
  })
}
