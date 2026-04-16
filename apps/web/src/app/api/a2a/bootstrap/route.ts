import { NextResponse } from 'next/server'
import { bootstrapA2ASession } from '@/lib/actions/a2a-session.action'

/**
 * POST /api/a2a/bootstrap
 * Bootstrap a full A2A session for the current user.
 * Called automatically by AuthGate after login, or manually
 * from the profile page if the session has expired.
 */
export async function POST() {
  const result = await bootstrapA2ASession()
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}
