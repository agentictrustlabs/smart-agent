import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/** Hardening Phase 1D — request-scoped correlation id header. */
const CORRELATION_HEADER = 'x-sa-correlation-id'

function newCorrelationId(): string {
  // Edge runtime: crypto.randomUUID is available; fall back to a hex
  // string built from getRandomValues if (somehow) it isn't.
  try {
    return `sa-cor-${crypto.randomUUID().replace(/-/g, '')}`
  } catch {
    const buf = new Uint8Array(16)
    crypto.getRandomValues(buf)
    let s = ''
    for (const b of buf) s += b.toString(16).padStart(2, '0')
    return `sa-cor-${s}`
  }
}

/**
 * Public paths bypass the auth gate. Anything under /api or /_next is
 * implicitly public — those routes do their own auth where needed.
 */
const PUBLIC_PATHS = ['/', '/h', '/onboarding', '/dashboard', '/invite', '/setup', '/sign-in', '/sign-up', '/recover', '/passkey-enroll', '/recover-device', '/demo']

const SESSION_COOKIE = 'smart-agent-session'

/**
 * Routes that get a tight per-IP rate limit. These are the unauthenticated
 * auth-bootstrap endpoints — they accept untrusted input and trigger
 * expensive crypto / DB work. 10 hits per minute per IP.
 *
 * Phase-1 hardening (HARDENING-PLAN §1.5 #9). In-memory state, single-
 * instance only. Production multi-instance deployments MUST swap this
 * for a Redis-backed limiter — tracked in docs/architecture/01-web-a2a-mcp-flows.md.
 */
const RATE_LIMITED_PATHS = [
  '/api/auth/passkey-challenge',
  '/api/auth/passkey-verify',
  '/api/auth/siwe-challenge',
  '/api/auth/siwe-verify',
  '/api/a2a/bootstrap/complete',
]

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const rateLimitStore = new Map<string, number[]>()

function rateLimitCheck(key: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const hits = rateLimitStore.get(key) ?? []
  while (hits.length > 0 && hits[0]! < cutoff) hits.shift()
  if (hits.length >= RATE_LIMIT_MAX) {
    const retryMs = hits[0]! + RATE_LIMIT_WINDOW_MS - now
    return { ok: false, retryAfter: Math.ceil(Math.max(retryMs, 0) / 1000) }
  }
  hits.push(now)
  rateLimitStore.set(key, hits)
  return { ok: true }
}

function clientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown'
  const xreal = request.headers.get('x-real-ip')
  if (xreal) return xreal.trim()
  return 'unknown'
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ─── Rate limit auth/bootstrap surfaces ─────────────────────────────
  if (RATE_LIMITED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const ip = clientIp(request)
    const check = rateLimitCheck(`${ip}:${pathname}`)
    if (!check.ok) {
      return new NextResponse(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': check.retryAfter.toString(),
        },
      })
    }
  }

  const hasNativeSession = request.cookies.has(SESSION_COOKIE)
  const hasDemoCookie = request.cookies.has('demo-user')        // legacy fallback
  const isAuthenticated = hasNativeSession || hasDemoCookie

  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
  const isApiRoute = pathname.startsWith('/api/')
  const isStaticAsset = pathname.startsWith('/_next/') || pathname.includes('.')

  // Surface the path to downstream server components (authenticated layout
  // uses this to gate the onboarding guard so /onboarding itself doesn't
  // redirect-loop). MUST be added to the *request* headers — server
  // components read via next/headers `headers()` which sees only request
  // headers; setting them on the response here would not be visible to RSC.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)

  // Hardening Phase 1D — set a correlation id on every request that
  // doesn't already carry one. Server actions / route handlers can read
  // it via `getCorrelationId(headers())` and pass it through to a2aFetch
  // so the full web→a2a→mcp→chain trail joins on a single id.
  if (!requestHeaders.get(CORRELATION_HEADER)) {
    requestHeaders.set(CORRELATION_HEADER, newCorrelationId())
  }

  if (isPublicPath || isApiRoute || isStaticAsset) {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  if (!isAuthenticated) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    return NextResponse.redirect(url)
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
