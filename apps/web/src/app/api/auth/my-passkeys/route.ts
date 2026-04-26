import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getSession } from '@/lib/auth/session'

/**
 * GET /api/auth/my-passkeys
 *
 * Returns the credential IDs registered to the currently-logged-in user's
 * smart account. Used by client-side WebAuthn flows to constrain
 * `allowCredentials` so the OS picker only offers passkeys that will
 * actually validate against THIS account — instead of every passkey ever
 * registered on the browser (which is what localStorage hints would do).
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ passkeys: [] })

  const user = await db.select().from(schema.users)
    .where(eq(schema.users.did, session.userId)).limit(1).then(r => r[0])
  if (!user) return NextResponse.json({ passkeys: [] })

  const rows = await db.select().from(schema.passkeys)
    .where(eq(schema.passkeys.userId, user.id))

  return NextResponse.json({
    passkeys: rows.map(r => ({
      id: r.credentialIdBase64Url,
      label: r.label ?? 'passkey',
    })),
  })
}
