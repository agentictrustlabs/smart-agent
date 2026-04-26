import { NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const users = await db.select().from(schema.users).where(eq(schema.users.did, session.userId)).limit(1)
  if (!users[0]) return NextResponse.json({ messages: [], unread: 0 })

  const msgs = await db.select().from(schema.messages)
    .where(eq(schema.messages.userId, users[0].id))
    .orderBy(desc(schema.messages.createdAt))
    .limit(50)

  const unread = msgs.filter((m) => m.read === 0).length

  return NextResponse.json({ messages: msgs, unread })
}

export async function POST(request: Request) {
  const body = await request.json()
  const { userId, type, title, body: msgBody, link } = body

  await db.insert(schema.messages).values({
    id: crypto.randomUUID(),
    userId,
    type,
    title,
    body: msgBody,
    link: link ?? null,
  })

  return NextResponse.json({ success: true })
}
