/**
 * Native session helpers.
 *
 *   - `mintSession(claims)` → builds the cookie string + claims to set on a NextResponse.
 *   - `readSession(cookieValue)` → verifies + returns JwtClaims or null.
 *   - `setSessionCookie(response, jwt)` / `clearSessionCookie(response)` — server route helpers.
 *
 * Cookie:
 *   name      `smart-agent-session`
 *   value     JWT (HS256) signed with SESSION_JWT_SECRET
 *   httpOnly  true
 *   sameSite  lax
 *   secure    in production
 *   maxAge    30 days
 */

import type { NextResponse } from 'next/server'
import { signJwt, verifyJwt, type JwtClaims } from './jwt'

export const SESSION_COOKIE = 'smart-agent-session'

const COOKIE_OPTS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
  httpOnly: true,
  sameSite: 'lax' as const,
}

export function mintSession(claims: Omit<JwtClaims, 'iat' | 'exp'>): string {
  return signJwt(claims)
}

export function readSession(cookieValue: string | undefined): JwtClaims | null {
  if (!cookieValue) return null
  return verifyJwt(cookieValue)
}

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
