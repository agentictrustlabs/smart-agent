import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Public paths bypass the auth gate. Anything under /api or /_next is
 * implicitly public — those routes do their own auth where needed.
 */
const PUBLIC_PATHS = ['/', '/h', '/onboarding', '/dashboard', '/invite', '/setup', '/sign-in', '/sign-up', '/recover', '/passkey-enroll', '/recover-device']

const SESSION_COOKIE = 'smart-agent-session'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

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
