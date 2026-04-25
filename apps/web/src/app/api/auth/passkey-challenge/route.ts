import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { signJwt } from '@/lib/auth/jwt'

/**
 * Issue a short-lived signed challenge for a passkey ceremony. Helper for
 * verifying lives in @/lib/auth/passkey-challenge — Next route files can
 * only export HTTP methods.
 *
 *   GET  /api/auth/passkey-challenge       → { challenge, token }
 *   POST /api/auth/passkey-verify { ... } → server checks both
 */

const CHALLENGE_TTL_S = 300  // 5 min

export async function GET() {
  const challenge = base64UrlEncode(randomBytes(32))
  const token = signJwt(
    { sub: 'anon', kind: 'passkey-challenge', challenge },
    { ttlSeconds: CHALLENGE_TTL_S },
  )
  return NextResponse.json({ challenge, token })
}

function base64UrlEncode(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
