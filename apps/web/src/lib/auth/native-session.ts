/**
 * Native session helpers.
 *
 *   - `mintSession(claims)` → builds the cookie string + claims to set on a NextResponse.
 *   - `verifySession(token)` → verifies + returns JwtClaims or null. (Alias: `readSession`.)
 *   - `setSessionCookie(response, jwt)` / `clearSessionCookie(response)` — server route helpers.
 *
 * Cookie:
 *   name      `smart-agent-session`
 *   value     JWT (HS256) signed with the active key from SESSION_JWT_SECRETS
 *             (kid header present; verifier picks the matching secret).
 *   httpOnly  true
 *   sameSite  lax
 *   secure    in production
 *   maxAge    24 hours (Sprint 2 S2.4 — reduced from 30 days)
 *
 * Sprint 2 S2.4 — key-id + rotation. Multi-key signing is in `./jwt.ts`.
 * Rotation runbook: docs/operations/kms-signer-setup.md
 *   § "Session JWT signing key (Sprint 2 S2.4)".
 *
 * TODO(S3): wire a session-refresh endpoint so the 24h TTL can be slid
 * forward without forcing the user to re-authenticate. Tracked alongside
 * the KMS-backed JWT signing migration (Sprint 3 territory).
 */

import type { NextResponse } from 'next/server'
import { signJwt, verifyJwt, type JwtClaims } from './jwt'

export const SESSION_COOKIE = 'smart-agent-session'

/**
 * Default lifetime for a session cookie / JWT, in seconds.
 *
 * Sprint 2 S2.4 reduced this from 30 days → 24 hours. The longer TTL
 * combined with a static symmetric secret meant a leaked secret could
 * forge tokens for a full month. With 24h, the blast radius for a leak
 * is bounded to a single day even before rotation.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24

const COOKIE_OPTS = {
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
  httpOnly: true,
  sameSite: 'lax' as const,
}

export function mintSession(claims: Omit<JwtClaims, 'iat' | 'exp'>): string {
  return signJwt(claims, { ttlSeconds: SESSION_TTL_SECONDS })
}

/**
 * Verify a session cookie value and return the decoded claims, or null
 * if the token is missing / malformed / expired / signed with an
 * unknown kid (e.g. a key that has been rotated out of the allowlist).
 */
export function verifySession(cookieValue: string | undefined): JwtClaims | null {
  if (!cookieValue) return null
  return verifyJwt(cookieValue)
}

/** Back-compat alias for `verifySession` — call sites still use this name. */
export const readSession = verifySession

export function setSessionCookieOnResponse(response: NextResponse, jwt: string): void {
  response.cookies.set(SESSION_COOKIE, jwt, {
    ...COOKIE_OPTS,
    secure: process.env.NODE_ENV === 'production',
  })
}

export function clearSessionCookieOnResponse(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, '', {
    ...COOKIE_OPTS,
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  })
}
