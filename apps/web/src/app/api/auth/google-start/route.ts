import { NextResponse } from 'next/server'
import {
  buildAuthorizeUrl,
  getGoogleEnv,
  randomToken,
  STATE_COOKIE,
  NONCE_COOKIE,
  INTENT_COOKIE,
  RETURN_TO_COOKIE,
  type OAuthIntent,
} from '@/lib/auth/google-oauth'

/**
 * GET /api/auth/google-start[?intent=recover]
 *
 * Generates state + nonce, stores them in httpOnly cookies, and redirects to
 * Google's authorize endpoint. The callback will verify the cookies match
 * the values returned by Google to defeat CSRF + token-replay.
 *
 * If `?intent=recover` is set, the intent is stashed in a cookie so the
 * callback redirects to /recover-device instead of /catalyst — the timelocked
 * recovery path the user opted into.
 */
export async function GET(request: Request) {
  let env
  try {
    env = getGoogleEnv()
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  const url = new URL(request.url)
  const intentParam = url.searchParams.get('intent')
  const intent: OAuthIntent = intentParam === 'recover' ? 'recover' : 'login'

  // Capture return_to so the callback can drop the user back where they
  // started (e.g. /h/catalyst). Restrict to relative paths so we never
  // open-redirect to an attacker-controlled origin.
  const returnToRaw = url.searchParams.get('return_to')
  const returnTo = isSafeReturnTo(returnToRaw) ? returnToRaw! : ''

  const state = randomToken()
  const nonce = randomToken()
  const authUrl = buildAuthorizeUrl(env, state, nonce)

  const res = NextResponse.redirect(authUrl)
  const cookie = {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10, // 10 minutes — plenty for the OAuth round-trip
  }
  res.cookies.set(STATE_COOKIE, state, cookie)
  res.cookies.set(NONCE_COOKIE, nonce, cookie)
  res.cookies.set(INTENT_COOKIE, intent, cookie)
  if (returnTo) res.cookies.set(RETURN_TO_COOKIE, returnTo, cookie)
  return res
}

function isSafeReturnTo(p: string | null): boolean {
  if (!p) return false
  // Same-origin paths only: must start with `/` and not `//` (protocol-relative).
  return p.startsWith('/') && !p.startsWith('//')
}
