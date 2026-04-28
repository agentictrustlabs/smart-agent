import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth/native-session'
import { grantCookieName } from '@/lib/auth/session-cookie'

/** POST /api/auth/logout — clears all httpOnly session cookies. */
export async function POST() {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  cookieStore.set('demo-user', '', { path: '/', maxAge: 0 })
  cookieStore.set('a2a-session', '', { path: '/', maxAge: 0 })
  cookieStore.set(grantCookieName(), '', { path: '/', maxAge: 0 })
  return NextResponse.json({ success: true })
}
