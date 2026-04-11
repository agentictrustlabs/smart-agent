import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_COOKIE = 'privy-token'
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

const PUBLIC_PATHS = ['/', '/onboarding', '/dashboard', '/invite', '/setup']

export function middleware(request: NextRequest) {
  if (SKIP_AUTH) {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl
  const hasToken = request.cookies.has(AUTH_COOKIE)

  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
  const isApiRoute = pathname.startsWith('/api/')
  const isStaticAsset = pathname.startsWith('/_next/') || pathname.includes('.')

  if (isPublicPath || isApiRoute || isStaticAsset) {
    return NextResponse.next()
  }

  if (!hasToken) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
