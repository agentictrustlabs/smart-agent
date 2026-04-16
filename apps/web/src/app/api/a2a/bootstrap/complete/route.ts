import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import {
  hashDelegation,
  encodeTimestampTerms,
  buildCaveat,
  ROOT_AUTHORITY,
} from '@smart-agent/sdk'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const A2A_SESSION_COOKIE = 'a2a-session'

/**
 * POST /api/a2a/bootstrap/complete
 *
 * Phase 2 of client-side A2A bootstrap:
 *   1. Receives challenge signature from client (signed by MetaMask)
 *   2. Verifies challenge with A2A agent → gets session token
 *   3. Calls session init → gets session key address
 *   4. Computes delegation hash with the session key as delegate
 *   5. Returns delegation hash for client to sign
 *   OR if delegationSignature is provided:
 *   6. Submits delegation to A2A agent → session activated
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const {
    challengeId,
    challengeSignature,
    delegationSignature,
    sessionId: existingSessionId,
    sessionToken: existingToken,
    accountAddress,
    delegationParams,
  } = body

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

  try {
    let sessionToken = existingToken as string | undefined

    // ─── If we have a challenge signature, verify it first ────────
    if (challengeSignature && !sessionToken) {
      const verifyRes = await fetch(`${A2A_AGENT_URL}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, signature: challengeSignature }),
      })
      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}))
        return NextResponse.json({ error: `Verify failed: ${err.error ?? verifyRes.statusText}` }, { status: 401 })
      }
      const data = await verifyRes.json()
      sessionToken = data.sessionToken
    }

    if (!sessionToken) {
      return NextResponse.json({ error: 'No session token' }, { status: 400 })
    }

    // ─── If no delegation signature yet, do session init and return hash to sign ─
    if (!delegationSignature) {
      // Session init → A2A generates session keypair
      const initRes = await fetch(`${A2A_AGENT_URL}/session/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ durationSeconds: 86400 }),
      })
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}))
        return NextResponse.json({ error: `Session init: ${err.error ?? initRes.statusText}` }, { status: 502 })
      }
      const { sessionId, sessionKeyAddress, durationSeconds } = await initRes.json()

      // Build delegation hash for client to sign
      const now = Math.floor(Date.now() / 1000)
      const expiresAt = now + (durationSeconds ?? 86400)
      const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
      const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
      const timeCaveat = buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt))
      const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))

      const delegator = (accountAddress ?? session.walletAddress) as `0x${string}`
      const delegationData = {
        delegator,
        delegate: sessionKeyAddress as `0x${string}`,
        authority: ROOT_AUTHORITY as `0x${string}`,
        caveats: [{ enforcer: timeCaveat.enforcer as `0x${string}`, terms: timeCaveat.terms as `0x${string}` }],
        salt,
      }
      const delHash = hashDelegation(delegationData, chainId, delegationManagerAddr)

      // Return the hash for the client to sign
      return NextResponse.json({
        needsDelegationSignature: true,
        sessionToken,
        sessionId,
        sessionKeyAddress,
        delegationHash: delHash,
        delegation: {
          delegator,
          delegate: sessionKeyAddress,
          authority: ROOT_AUTHORITY,
          caveats: [{ enforcer: timeCaveat.enforcer, terms: timeCaveat.terms }],
          salt: salt.toString(),
        },
      })
    }

    // ─── We have the delegation signature — complete the session ──
    if (!existingSessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    // Parse delegation from body
    const delegation = body.delegation
    if (!delegation) {
      return NextResponse.json({ error: 'Missing delegation' }, { status: 400 })
    }

    // Add the signature to the delegation
    delegation.signature = delegationSignature

    // Submit to A2A session/package
    const pkgRes = await fetch(`${A2A_AGENT_URL}/session/package`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ sessionId: existingSessionId, delegation }),
    })
    if (!pkgRes.ok) {
      const err = await pkgRes.json().catch(() => ({}))
      return NextResponse.json({ error: `Package: ${err.error ?? pkgRes.statusText}` }, { status: 502 })
    }

    // Set cookie
    const cookieStore = await cookies()
    cookieStore.set(A2A_SESSION_COOKIE, sessionToken, {
      path: '/',
      maxAge: 60 * 60 * 24,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })

    return NextResponse.json({ success: true, sessionToken })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Bootstrap complete failed' },
      { status: 500 },
    )
  }
}
