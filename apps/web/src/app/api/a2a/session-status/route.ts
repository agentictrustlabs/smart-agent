/**
 * GET /api/a2a/session-status
 *
 * Returns the current A2A session's status + scope for the authenticated
 * user. Reads the A2A session cookie, calls a2a-agent's read-only
 * `/session/:id/status` endpoint, and merges the result with the
 * caller's deployed-contract addresses so the permission UI can render
 * a faithful preview without leaking the cookie value.
 *
 *   { active: true,  sessionId, expiresAtIso, scope: {...} }
 *   { active: false, reason: 'no-cookie' | 'expired' | 'revoked' | 'not-found' }
 */
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getA2ASessionToken } from '@/lib/actions/a2a-session.action'
import { buildSessionPermissionRequest } from '@smart-agent/sdk'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ active: false, reason: 'not-authenticated' }, { status: 401 })

  const sessionId = await getA2ASessionToken()
  if (!sessionId) {
    return NextResponse.json({ active: false, reason: 'no-cookie' })
  }

  const res = await fetch(`${A2A_AGENT_URL}/session/${sessionId}/status`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (res.status === 404) {
    return NextResponse.json({ active: false, reason: 'not-found' })
  }
  const data = await res.json().catch(() => ({}))

  if (!data.active) {
    return NextResponse.json({
      active: false,
      reason: data.reason ?? 'unknown',
      expiresAtIso: data.expiresAtIso ?? null,
      sessionId,
    })
  }

  // Build a fresh permission request that mirrors what the active session
  // was bootstrapped with — the same TOOL_POLICIES + env addresses.
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(data.expiresAtIso).getTime() - Date.now()) / 1000),
  )
  const permission = buildSessionPermissionRequest({
    env: process.env as Record<string, string | undefined>,
    durationSeconds: durationSeconds || 86400,
    chainId,
  })

  return NextResponse.json({
    active: true,
    sessionId,
    expiresAtIso: data.expiresAtIso,
    createdAtIso: data.createdAtIso,
    accountAddress: data.accountAddress,
    sessionKeyAddress: data.sessionKeyAddress,
    scope: permission,
  })
}
