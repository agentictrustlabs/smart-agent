/**
 * Cookie helper for the SessionGrant.v1 system.
 *
 * Stores an opaque session-id (random UUID) the browser presents on every
 * delegated wallet action. The verifier hashes the cookie value and looks
 * it up against the SessionRecord table on person-mcp.
 *
 * Production uses the `__Host-` prefix (Path=/, Secure, no Domain), which
 * the browser binds to the exact origin — eliminating subdomain takeovers
 * and CSRF that depend on cross-origin cookie reuse. The prefix REQUIRES
 * Secure, which fails on HTTP localhost; in dev we drop the prefix and use
 * a plain cookie name. (Audit C7.)
 */

import type { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'

const PROD_NAME = '__Host-smart-agent-grant'
const DEV_NAME = 'smart-agent-grant'

export function grantCookieName(): string {
  return process.env.NODE_ENV === 'production' ? PROD_NAME : DEV_NAME
}

export function setGrantCookie(
  response: NextResponse,
  sessionId: string,
  hardTtlSeconds: number,
): void {
  response.cookies.set(grantCookieName(), sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: hardTtlSeconds,
  })
}

export function clearGrantCookie(response: NextResponse): void {
  response.cookies.set(grantCookieName(), '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  })
}

/**
 * SHA-256 of the cookie value. The verifier looks SessionRecord up by this
 * hash so a leak of the SessionRecord row (audit dump, backup) does not
 * yield a usable cookie.
 */
export function sessionIdHash(cookieValue: string): string {
  return createHash('sha256').update(cookieValue, 'utf8').digest('hex')
}
