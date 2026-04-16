import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

/**
 * POST /api/a2a/auth/verify
 * Submit a signed challenge to the A2A agent for ERC-1271 verification.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()

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
