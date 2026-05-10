/**
 * GET /api/a2a/session-audit?sessionId=<id>&limit=<n>
 *
 * Returns the most recent ExecutionReceipt rows for the given session,
 * authenticated via the caller's web session. If `sessionId` is omitted,
 * uses the current A2A session cookie.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getA2ASessionToken } from '@/lib/actions/a2a-session.action'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId') ?? (await getA2ASessionToken())
  if (!sessionId) return NextResponse.json({ receipts: [] })

  const limit = url.searchParams.get('limit') ?? '20'

  const res = await fetch(
    `${A2A_AGENT_URL}/session/${sessionId}/audit?limit=${encodeURIComponent(limit)}`,
    { headers: { 'Content-Type': 'application/json' } },
  )
  const data = await res.json().catch(() => ({ receipts: [] }))
  return NextResponse.json(data, { status: res.status })
}
