import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { DEMO_USERS } from '@/lib/auth/session'

export async function POST(request: Request) {
  const body = await request.json()
  const userId = body.userId as string

  if (!DEMO_USERS[userId]) {
    return NextResponse.json({ error: 'Invalid demo user' }, { status: 400 })
  }

  const cookieStore = await cookies()
  cookieStore.set('demo-user', userId, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    httpOnly: false,
  })

  return NextResponse.json({ success: true, user: DEMO_USERS[userId] })
}

export async function GET() {
  const cookieStore = await cookies()
  const current = cookieStore.get('demo-user')?.value ?? 'test-user-001'
  return NextResponse.json({
    current,
    user: DEMO_USERS[current],
    users: Object.entries(DEMO_USERS).map(([key, u]) => ({
      key,
      name: u.name,
      org: u.org,
      role: u.role,
    })),
  })
}
