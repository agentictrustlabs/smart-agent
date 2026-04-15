import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { DEMO_USERS } from '@/lib/auth/session'
import { ensureDemoCommunitySeeded } from '@/lib/demo-seed'



export async function POST(request: Request) {
  const body = await request.json()
  const userId = body.userId as string

  if (!DEMO_USERS[userId]) {
    return NextResponse.json({ error: 'Invalid demo user' }, { status: 400 })
  }

  const cookieStore = await cookies()
  cookieStore.set('demo-user', userId, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: false,
  })

  // Auto-seed community data if this is the first login
  try {
    await ensureDemoCommunitySeeded(userId)
  } catch (err) {
    console.warn('[demo-login] Failed to seed community data:', err)
  }

  return NextResponse.json({ success: true, user: DEMO_USERS[userId] })
}

export async function GET() {
  const cookieStore = await cookies()
  const current = cookieStore.get('demo-user')?.value ?? null
  const demoUser = current ? DEMO_USERS[current] : null

  // Look up person agent from on-chain registry
  let smartAccountAddress: string | null = null
  if (current) {
    try {
      const { getPersonAgentForUser } = await import('@/lib/agent-registry')
      smartAccountAddress = await getPersonAgentForUser(current)
    } catch { /* ignored */ }
  }

  return NextResponse.json({
    current,
    user: demoUser ? {
      ...demoUser,
      walletAddress: demoUser.walletAddress,
      smartAccountAddress,
    } : null,
  })
}
