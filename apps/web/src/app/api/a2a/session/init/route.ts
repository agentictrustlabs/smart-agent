import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

/**
 * POST /api/a2a/session/init
 * Initialize an A2A session (creates session key + delegation on-chain).
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()

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
