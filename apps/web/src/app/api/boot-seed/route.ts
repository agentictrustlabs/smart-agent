/** @sa-route dev-only @sa-auth none @sa-prod-gate requireDev @sa-validation none-no-body @sa-owner infra */
import { NextResponse } from 'next/server'
import { getBootState, triggerBootSeed } from '@/lib/boot-seed'
import { requireDev } from '@/lib/env-guard'

export const dynamic = 'force-dynamic'

/** GET /api/boot-seed — start boot seed (fire-and-forget) and return current state. */
export async function GET() {
  const denied = requireDev()
  if (denied) return denied
  // Fire-and-forget; the module handles singleton/idempotency.
  triggerBootSeed().catch(() => { /* state.error captures it */ })
  return NextResponse.json(getBootState())
}

/** POST /api/boot-seed — identical to GET; kept for clarity in scripts. */
export async function POST() {
  const denied = requireDev()
  if (denied) return denied
  triggerBootSeed().catch(() => { /* state.error captures it */ })
  return NextResponse.json(getBootState())
}
