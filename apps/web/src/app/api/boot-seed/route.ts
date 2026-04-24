import { NextResponse } from 'next/server'
import { getBootState, triggerBootSeed } from '@/lib/boot-seed'

export const dynamic = 'force-dynamic'

/** GET /api/boot-seed — start boot seed (fire-and-forget) and return current state. */
export async function GET() {
  // Fire-and-forget; the module handles singleton/idempotency.
  triggerBootSeed().catch(() => { /* state.error captures it */ })
  return NextResponse.json(getBootState())
}

/** POST /api/boot-seed — identical to GET; kept for clarity in scripts. */
export async function POST() {
  triggerBootSeed().catch(() => { /* state.error captures it */ })
  return NextResponse.json(getBootState())
}
