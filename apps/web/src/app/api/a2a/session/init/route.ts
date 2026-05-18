/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod @sa-owner security */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { validateRequest } from '@/lib/auth/validate-request'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

// Sessions are at most 7 days (604800 s). Bound the upper limit so a
// client can't request an unbounded-duration delegation through this
// route (the upstream A2A agent re-checks, but the early reject is
// cheaper and matches the body-validation discipline).
const MAX_SESSION_SECONDS = 60 * 60 * 24 * 7
const BodySchema = z.object({
  sessionToken: z.string().min(1).max(4096),
  durationSeconds: z.number().int().positive().max(MAX_SESSION_SECONDS).optional(),
})

/**
 * POST /api/a2a/session/init
 * Initialize an A2A session (creates session key + delegation on-chain).
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const parsed = await validateRequest(request, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const response = await fetch(`${A2A_AGENT_URL}/session/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${body.sessionToken}`,
    },
    body: JSON.stringify({
      durationSeconds: body.durationSeconds ?? 900,
    }),
  })

  const data = await response.json()
  return NextResponse.json(data, { status: response.status })
}
