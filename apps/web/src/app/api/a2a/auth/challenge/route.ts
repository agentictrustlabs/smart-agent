import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

/**
 * POST /api/a2a/auth/challenge
 * Request an EIP-712 challenge from the A2A agent.
 * Requires a auth session (or demo user).
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const response = await fetch(`${A2A_AGENT_URL}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountAddress: session.walletAddress }),
  })

  const data = await response.json()
  return NextResponse.json(data, { status: response.status })
}
