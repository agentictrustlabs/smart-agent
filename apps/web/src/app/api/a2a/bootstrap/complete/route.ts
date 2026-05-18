/** @sa-route web-auth @sa-auth session-cookie @sa-rate-limit 10/min @sa-risk-tier medium @sa-validation zod @sa-owner security */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import { validateRequest, DELEGATION_BODY_LIMIT_BYTES } from '@/lib/auth/validate-request'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const A2A_SESSION_COOKIE = 'a2a-session'

// The delegation packet is large (caveats can be many KB of encoded
// terms). We accept the larger DELEGATION cap (1 MiB) here, which is
// the right size class for any route taking a full SessionGrant /
// delegation blob (see validate-request.ts header).
const BodySchema = z.object({
  sessionId: z.string().min(1).max(256),
  delegationSignature: z.string().min(1).max(8192),
  // The delegation envelope is structured — but its caveat blobs are
  // opaque hex/base64 to this route. Accept a permissive object shape
  // and let the downstream A2A `/session/package` verifier reject
  // anything malformed via ERC-1271.
  delegation: z.record(z.string(), z.unknown()),
})

/**
 * POST /api/a2a/bootstrap/complete
 *
 * Receives the delegation signature (one MetaMask sign),
 * submits to A2A /session/package (self-authenticating via ERC-1271),
 * stores the session ID as an httpOnly cookie.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const parsed = await validateRequest(request, {
    schema: BodySchema,
    maxBytes: DELEGATION_BODY_LIMIT_BYTES,
  })
  if (!parsed.ok) return parsed.response
  const { sessionId, delegationSignature, delegation } = parsed.data

  try {
    // Add the user's signature to the delegation
    delegation.signature = delegationSignature

    // Submit to A2A agent — /session/package verifies via ERC-1271
    const pkgRes = await fetch(`${A2A_AGENT_URL}/session/package`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, delegation }),
    })

    if (!pkgRes.ok) {
      const err = await pkgRes.json().catch(() => ({}))
      return NextResponse.json({ error: err.error ?? `Session activation failed` }, { status: 502 })
    }

    // Store session ID as httpOnly cookie
    const cookieStore = await cookies()
    cookieStore.set(A2A_SESSION_COOKIE, sessionId, {
      path: '/',
      maxAge: 60 * 60 * 24,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })

    return NextResponse.json({ success: true, sessionToken: sessionId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Bootstrap complete failed' },
      { status: 500 },
    )
  }
}
