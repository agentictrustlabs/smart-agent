/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq,  } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getSession } from '@/lib/auth/session'
import { validateRequest } from '@/lib/auth/validate-request'

const PostBodySchema = z.object({
  agentAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  agentName: z.string().max(256).optional(),
  // The invites table column is a SQLite enum of these three roles —
  // anything else fails the drizzle insert. Pin the enum here so an
  // unexpected value gets a 400 before we touch the DB.
  role: z.enum(['owner', 'admin', 'member']).optional(),
})

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ invites: [] })

  const users = await db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.did, session.userId)).limit(1)
  if (!users[0]) return NextResponse.json({ invites: [] })

  const invites = await db.select().from(schema.invites)
    .where(eq(schema.invites.createdBy, users[0].id))

  return NextResponse.json({ invites })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const users = await db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.did, session.userId)).limit(1)
  if (!users[0]) return NextResponse.json({ error: 'User not found' }, { status: 400 })

  const parsed = await validateRequest(request, { schema: PostBodySchema })
  if (!parsed.ok) return parsed.response
  const { agentAddress, agentName, role } = parsed.data

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
