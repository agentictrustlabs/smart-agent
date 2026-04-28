import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import { grantCookieName } from '@/lib/auth/session-cookie'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

async function resolveA2AToken(request: Request): Promise<string | null> {
  // Prefer client-supplied legacy header for in-flight sessions.
  const headerToken = request.headers.get('x-a2a-session')
  if (headerToken) return headerToken
  // Fall back to either cookie (grant first, legacy second).
  const cookieStore = await cookies()
  return cookieStore.get(grantCookieName())?.value
    ?? cookieStore.get('a2a-session')?.value
    ?? null
}

/**
 * GET /api/a2a/profile
 * Get the authenticated user's profile from person-mcp via delegation chain.
 * Flow: Web (auth session) → A2A agent (mint delegation token) → Person MCP (get_profile)
 */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const sessionToken = await resolveA2AToken(request)

  if (!sessionToken) {
    return NextResponse.json({ error: 'No A2A session — connect your agent first' }, { status: 401 })
  }

  try {
    // Step 1: Mint delegation token from A2A agent
    const mintRes = await fetch(`${A2A_AGENT_URL}/delegation/mint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
      },
    })

    if (!mintRes.ok) {
      const err = await mintRes.json()
      return NextResponse.json({ error: 'Failed to mint delegation token', detail: err }, { status: 502 })
    }

    const { token: delegationToken } = await mintRes.json()

    // Step 2: Call person-mcp get_profile with delegation token
    // In production this would go through the MCP protocol.
    // For now, return the delegation token so the client can use it.
    return NextResponse.json({ delegationToken, accountAddress: session.walletAddress })
  } catch (error) {
    return NextResponse.json(
      { error: 'Profile fetch failed', detail: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

/**
 * PUT /api/a2a/profile
 * Update the authenticated user's profile via delegation chain.
 */
export async function PUT(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const sessionToken = await resolveA2AToken(request)
  if (!sessionToken) {
    return NextResponse.json({ error: 'No A2A session' }, { status: 401 })
  }

  const body = await request.json()

  try {
    const mintRes = await fetch(`${A2A_AGENT_URL}/delegation/mint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
      },
    })

    if (!mintRes.ok) {
      const err = await mintRes.json()
      return NextResponse.json({ error: 'Failed to mint delegation token', detail: err }, { status: 502 })
    }

    const { token: delegationToken } = await mintRes.json()

    // Return the delegation token + profile data for the client to use
    return NextResponse.json({ delegationToken, profileData: body, accountAddress: session.walletAddress })
  } catch (error) {
    return NextResponse.json(
      { error: 'Profile update failed', detail: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
