import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const A2A_SESSION_COOKIE = 'a2a-session'

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

  const body = await request.json()
  const { sessionId, delegationSignature, delegation } = body

  if (!sessionId || !delegationSignature || !delegation) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

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
