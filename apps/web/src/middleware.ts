import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/', '/h', '/onboarding', '/dashboard', '/invite', '/setup']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check for either Privy or demo auth
  const hasPrivyToken = request.cookies.has('privy-token')
  const hasDemoCookie = request.cookies.has('demo-user')
  const isAuthenticated = hasPrivyToken || hasDemoCookie

  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
  const isApiRoute = pathname.startsWith('/api/')
  const isStaticAsset = pathname.startsWith('/_next/') || pathname.includes('.')

  if (isPublicPath || isApiRoute || isStaticAsset) {
    return NextResponse.next()
  }

  if (!isAuthenticated) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
