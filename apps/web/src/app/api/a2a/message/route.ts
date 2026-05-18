/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { validateRequest } from '@/lib/auth/validate-request'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

const BodySchema = z.object({
  // Agent handle the message is destined for. Bounded so a caller can't
  // ship a 64 KiB URL component at the upstream A2A agent.
  handle: z.string().min(1).max(256),
  message: z.string().min(1).max(8192),
  // Optional Bearer token forwarded to the upstream A2A agent. Capped at
  // 4 KiB — anything larger isn't a token, it's an exploit payload.
  sessionToken: z.string().max(4096).optional(),
})

/**
 * POST /api/a2a/message
 * Send an A2A message through the agent.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const parsed = await validateRequest(request, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const response = await fetch(`${A2A_AGENT_URL}/a2a/${body.handle}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(body.sessionToken ? { 'Authorization': `Bearer ${body.sessionToken}` } : {}),
    },
    body: JSON.stringify({
      message: body.message,
      fromAgentId: session.walletAddress,
    }),
  })

  const data = await response.json()
  return NextResponse.json(data, { status: response.status })
}
