/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import { grantCookieName } from '@/lib/auth/session-cookie'
import { webErrorResponse } from '@/lib/auth/error-response'
import { validateRequest } from '@/lib/auth/validate-request'

// Profile is free-form key/value. Cap individual string values so a
// malicious user can't ship a 64 KB display-name.
const PutBodySchema = z.object({
  displayName: z.string().max(256).optional(),
  email: z.string().max(320).optional(),  // RFC 5321 limit
  bio: z.string().max(2048).optional(),
}).catchall(z.string().max(2048))

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
      return webErrorResponse({
        publicMessage: 'Failed to mint delegation token',
        logMessage: '[a2a/profile GET] delegation mint upstream failure',
        logFields: {
          walletAddress: session.walletAddress,
          upstreamStatus: mintRes.status,
          // Upstream body may include token fields / internal URLs —
          // log only, never leak to the caller.
          upstreamError: err,
          errorCode: 'delegation-mint-failed',
        },
        status: 502,
        request,
      })
    }

    const { token: delegationToken } = await mintRes.json()

    // Step 2: Call person-mcp get_profile with delegation token
    // In production this would go through the MCP protocol.
    // For now, return the delegation token so the client can use it.
    return NextResponse.json({ delegationToken, accountAddress: session.walletAddress })
  } catch (error) {
    return webErrorResponse({
      publicMessage: 'Profile fetch failed',
      logMessage: '[a2a/profile GET] threw',
      logFields: {
        walletAddress: session.walletAddress,
        errorCode: 'profile-fetch-threw',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
      status: 500,
      request,
    })
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

  const parsed = await validateRequest(request, { schema: PutBodySchema })
  if (!parsed.ok) return parsed.response
  const body = parsed.data

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
      return webErrorResponse({
        publicMessage: 'Failed to mint delegation token',
        logMessage: '[a2a/profile PUT] delegation mint upstream failure',
        logFields: {
          walletAddress: session.walletAddress,
          upstreamStatus: mintRes.status,
          upstreamError: err,
          errorCode: 'delegation-mint-failed',
        },
        status: 502,
        request,
      })
    }

    const { token: delegationToken } = await mintRes.json()

    // Return the delegation token + profile data for the client to use
    return NextResponse.json({ delegationToken, profileData: body, accountAddress: session.walletAddress })
  } catch (error) {
    return webErrorResponse({
      publicMessage: 'Profile update failed',
      logMessage: '[a2a/profile PUT] threw',
      logFields: {
        walletAddress: session.walletAddress,
        errorCode: 'profile-update-threw',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
      status: 500,
      request,
    })
  }
}
