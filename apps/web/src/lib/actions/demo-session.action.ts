'use server'

import { cookies } from 'next/headers'

/** Get the current demo user key from the httpOnly cookie (server-side only). */
export async function getDemoUserKey(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get('demo-user')?.value ?? null
}

/** Clear the demo user cookie (server-side). */
export async function clearDemoSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set('demo-user', '', { path: '/', maxAge: 0 })
  cookieStore.set('a2a-session', '', { path: '/', maxAge: 0 })
}
