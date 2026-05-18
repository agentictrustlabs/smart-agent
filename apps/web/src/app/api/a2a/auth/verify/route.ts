/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { validateRequest } from '@/lib/auth/validate-request'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

// EIP-1271 signatures are at most a few hundred bytes; a UUID-ish
// challenge id is tens of bytes. 8 KiB upper bound is generous and
// blocks an attacker stuffing megabytes of junk through to the
// upstream verifier.
const BodySchema = z.object({
  challengeId: z.string().min(1).max(256),
  signature: z.string().min(1).max(8192),
})

/**
 * POST /api/a2a/auth/verify
 * Submit a signed challenge to the A2A agent for ERC-1271 verification.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const parsed = await validateRequest(request, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const response = await fetch(`${A2A_AGENT_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId: body.challengeId,
      signature: body.signature,
    }),
  })

  const data = await response.json()
  return NextResponse.json(data, { status: response.status })
}
