import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { DEMO_USER_META } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'

export async function POST(request: Request) {
  const body = await request.json()
  const userId = body.userId as string

  const meta = DEMO_USER_META[userId]
  if (!meta) {
    return NextResponse.json({ error: 'Invalid demo user' }, { status: 400 })
  }

  // Check if user already exists in DB with a real wallet
  let user = await db.select().from(schema.users)
    .where(eq(schema.users.id, userId)).limit(1).then(r => r[0])

  if (!user) {
    // First login — generate real keypair and deploy AgentAccount
    try {
      const { generateDemoWallet } = await import('@/lib/demo-seed/generate-wallet')
      const wallet = await generateDemoWallet()

      await db.insert(schema.users).values({
        id: userId,
        email: meta.email,
        name: meta.name,
        walletAddress: wallet.address,
        privyUserId: meta.userId,
        privateKey: wallet.privateKey,
        smartAccountAddress: wallet.smartAccountAddress,
      })

      user = {
        id: userId,
        email: meta.email,
        name: meta.name,
        walletAddress: wallet.address,
        privyUserId: meta.userId,
        privateKey: wallet.privateKey,
        smartAccountAddress: wallet.smartAccountAddress,
        createdAt: new Date().toISOString(),
      }

      console.log(`[demo-login] Created wallet for ${meta.name}: EOA=${wallet.address}, SmartAccount=${wallet.smartAccountAddress}`)
    } catch (err) {
      console.error('[demo-login] Wallet generation failed:', err)
      return NextResponse.json({ error: 'Failed to provision wallet' }, { status: 500 })
    }
  }

  // Set demo cookie
  const cookieStore = await cookies()
  cookieStore.set('demo-user', userId, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: false,
  })

  // Seed community data in background (idempotent)
  try {
    const { ensureDemoCommunitySeeded } = await import('@/lib/demo-seed')
    await ensureDemoCommunitySeeded(userId)
  } catch (err) {
    console.warn('[demo-login] Community seed failed:', err)
  }

  return NextResponse.json({
    success: true,
    user: {
      userId: meta.userId,
      walletAddress: user.walletAddress,
      smartAccountAddress: user.smartAccountAddress,
      email: meta.email,
      name: meta.name,
    },
  })
}

export async function GET() {
  const cookieStore = await cookies()
  const current = cookieStore.get('demo-user')?.value ?? null

  if (!current) {
    return NextResponse.json({ current: null, user: null })
  }

  const meta = DEMO_USER_META[current]
  if (!meta) {
    return NextResponse.json({ current, user: null })
  }

  // Look up real wallet from DB
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.id, current)).limit(1).then(r => r[0])

  return NextResponse.json({
    current,
    user: user ? {
      userId: meta.userId,
      walletAddress: user.walletAddress,
      smartAccountAddress: user.smartAccountAddress,
      email: meta.email,
      name: meta.name,
    } : null,
  })
}
