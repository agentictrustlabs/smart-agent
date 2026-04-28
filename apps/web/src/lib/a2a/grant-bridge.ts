/**
 * Web → a2a-agent grant bridge.
 *
 * Server-side helper that forwards the user's session-grant cookie value
 * to a2a-agent as `Authorization: Bearer <session-id>`. The a2a-agent's
 * requireGrantSession middleware looks the record up on person-mcp and
 * authorises the request without a separate delegation handshake.
 *
 * Browser never talks to a2a-agent directly — every call routes through
 * a Next route handler that reads the grant cookie server-side and proxies
 * with the Bearer header attached. Removes the cross-origin cookie problem
 * that blocked __Host-cookie + a2a-agent on a different port in dev.
 */

import { cookies } from 'next/headers'
import { grantCookieName } from '@/lib/auth/session-cookie'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

export class A2AAuthError extends Error {
  constructor(public readonly code: 'no_grant' | 'forbidden' | 'expired', message: string) {
    super(message)
  }
}

export async function readGrantSessionId(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(grantCookieName())?.value ?? null
}

/**
 * Make a server-side fetch to a2a-agent with the user's grant cookie
 * forwarded as `Authorization: Bearer`. Caller passes an already-built path
 * (e.g. "/profile/123") and any RequestInit; this helper sets the
 * Authorization header and the base URL.
 */
export async function fetchA2AWithGrant(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const sessionId = await readGrantSessionId()
  if (!sessionId) throw new A2AAuthError('no_grant', 'no session-grant cookie present')

  const headers = new Headers(init.headers ?? {})
  headers.set('Authorization', `Bearer ${sessionId}`)
  if (!headers.has('content-type') && init.body) {
    headers.set('content-type', 'application/json')
  }

  return fetch(`${A2A_AGENT_URL}${path}`, { ...init, headers })
}
