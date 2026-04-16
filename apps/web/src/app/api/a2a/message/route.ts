import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

/**
 * POST /api/a2a/message
 * Send an A2A message through the agent.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()

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
