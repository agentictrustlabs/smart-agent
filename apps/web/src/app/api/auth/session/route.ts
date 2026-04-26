import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { readSession, SESSION_COOKIE } from '@/lib/auth/native-session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { DEMO_USER_META } from '@/lib/auth/session'
import { verifyCookie } from '@/lib/cookie-signing'

/**
 * GET /api/auth/session
 *
 * Returns the authenticated user, if any. Used by the client `useAuth` hook.
 * Reads the native JWT cookie first, falls back to the legacy demo cookie so
 * sessions issued before the legacy → native migration keep working.
 */
export async function GET() {
  const cookieStore = await cookies()
  const jwt = cookieStore.get(SESSION_COOKIE)?.value
  const claims = readSession(jwt)
  if (claims) {
    // Hydrate from DB. JWT `sub` matches `users.did` (set at mint time).
    const row = await db.select().from(schema.users).where(eq(schema.users.did, claims.sub)).limit(1).then(r => r[0])
    return NextResponse.json({
      user: {
        id: row?.id ?? claims.sub,
        walletAddress: row?.walletAddress ?? claims.walletAddress ?? null,
        smartAccountAddress: row?.smartAccountAddress ?? claims.smartAccountAddress ?? null,
        name: row?.name ?? claims.name ?? null,
        email: row?.email ?? claims.email ?? null,
        via: claims.via ?? null,
      },
    })
  }

  // Legacy demo cookie fallback.
  const legacy = cookieStore.get('demo-user')?.value
  const userId = legacy ? verifyCookie(legacy) : null
  if (!userId) return NextResponse.json({ user: null })
  const meta = DEMO_USER_META[userId]
  if (!meta) return NextResponse.json({ user: null })
  const row = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1).then(r => r[0])
  return NextResponse.json({
    user: row ? {
      id: row.id,
      walletAddress: row.walletAddress,
      smartAccountAddress: row.smartAccountAddress ?? null,
      name: row.name,
      email: row.email ?? meta.email,
      via: 'demo' as const,
    } : null,
  })
}
