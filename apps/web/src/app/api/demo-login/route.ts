import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { DEMO_USER_META } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { signCookie, verifyCookie } from '@/lib/cookie-signing'
import { mintSession, SESSION_COOKIE } from '@/lib/auth/native-session'

export async function POST(request: Request) {
  // CSRF protection: verify the request comes from our own origin
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin && host && !origin.includes(host.split(':')[0])) {
    return NextResponse.json({ error: 'CSRF rejected' }, { status: 403 })
  }

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
      const wallet = await generateDemoWallet(meta.name)

      await db.insert(schema.users).values({
        id: userId,
        email: meta.email,
        name: meta.name,
        walletAddress: wallet.address,
        did: meta.userId,
        privateKey: wallet.privateKey,
        smartAccountAddress: wallet.smartAccountAddress,
        personAgentAddress: wallet.personAgentAddress,
      })

      user = {
        id: userId,
        email: meta.email,
        name: meta.name,
        walletAddress: wallet.address,
        did: meta.userId,
        privateKey: wallet.privateKey,
        smartAccountAddress: wallet.smartAccountAddress,
        personAgentAddress: wallet.personAgentAddress,
        agentName: null,
        onboardedAt: null,
        accountSaltRotation: 0,
        createdAt: new Date().toISOString(),
      }

      console.log(`[demo-login] Created wallet for ${meta.name}: EOA=${wallet.address}, SmartAccount=${wallet.smartAccountAddress}, PersonAgent=${wallet.personAgentAddress}`)
    } catch (err) {
      console.error('[demo-login] Wallet generation failed:', err)
      return NextResponse.json({ error: 'Failed to provision wallet' }, { status: 500 })
    }
  }

  // Set the native JWT session cookie + the legacy demo cookie (kept for
  // anything still keyed off the old name during the transition).
  const cookieStore = await cookies()
  const jwt = mintSession({
    // `sub` must match what `getCurrentUser` looks up by — i.e. `users.did`.
    // Demo users have did = `did:demo:<key>` (e.g. `did:demo:cat-001`).
    sub: meta.userId,
    walletAddress: user.walletAddress,
    smartAccountAddress: user.smartAccountAddress ?? null,
    name: meta.name,
    email: meta.email,
    via: 'demo',
    kind: 'session',
  })
  // Seed community data in background (idempotent)
  try {
    const { ensureDemoCommunitySeeded } = await import('@/lib/demo-seed')
    await ensureDemoCommunitySeeded(userId)
  } catch (err) {
    console.warn('[demo-login] Community seed failed:', err)
  }

  // Provision the holder wallet (idempotent) so AnonCreds-aware features
  // — trust search, "Test verification", "Get {noun} credential" — work
  // immediately without forcing the user to issue a credential first.
  // The session cookie isn't readable inside this same request, so we
  // pass principal + private key directly to the helper.
  try {
    const { provisionHolderWalletForDemoUser } = await import(
      '@/lib/demo-seed/provision-holder-wallet'
    )
    const r = await provisionHolderWalletForDemoUser({
      principal: `person_${userId}`,
      privateKey: user.privateKey as `0x${string}`,
    })
    if (!r.ok) {
      console.warn('[demo-login] Holder-wallet provision failed:', r.error)
    }
  } catch (err) {
    console.warn('[demo-login] Holder-wallet provision threw:', err)
  }

  // KB write-through — the new person agent (and any community-seed
  // edges that just landed on chain) need to be mirrored into GraphDB
  // so /agents and other DiscoveryService-backed views see this user
  // without a manual /api/ontology-sync. Debounced + idempotent —
  // failures log and move on.
  try {
    const { scheduleKbSync } = await import('@/lib/ontology/kb-write-through')
    scheduleKbSync()
  } catch (err) {
    console.warn('[demo-login] KB sync schedule threw:', err)
  }

  const response = NextResponse.json({
    success: true,
    user: {
      userId: meta.userId,
      walletAddress: user.walletAddress,
      smartAccountAddress: user.smartAccountAddress,
      email: meta.email,
      name: meta.name,
    },
  })
  response.cookies.set(SESSION_COOKIE, jwt, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  response.cookies.set('demo-user', signCookie(userId), {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
  void cookieStore
  return response
}

export async function GET() {
  const cookieStore = await cookies()
  const rawCookie = cookieStore.get('demo-user')?.value ?? null

  if (!rawCookie) {
    return NextResponse.json({ current: null, user: null })
  }

  // Verify signed cookie
  const current = verifyCookie(rawCookie)
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
