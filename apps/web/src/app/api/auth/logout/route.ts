import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

/** POST /api/auth/logout — clears all httpOnly session cookies. */
export async function POST() {
  const cookieStore = await cookies()
  cookieStore.set('demo-user', '', { path: '/', maxAge: 0 })
  cookieStore.set('a2a-session', '', { path: '/', maxAge: 0 })
  return NextResponse.json({ success: true })
}
