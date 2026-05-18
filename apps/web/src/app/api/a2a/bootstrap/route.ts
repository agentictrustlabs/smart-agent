/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { bootstrapA2ASession } from '@/lib/actions/a2a-session.action'
import { validateRequest } from '@/lib/auth/validate-request'

const DURATION_KEYS = ['h1', 'h24', 'h168'] as const
type DurationKey = typeof DURATION_KEYS[number]

const DURATION_SECONDS: Record<DurationKey, number> = {
  h1:   60 * 60,
  h24:  60 * 60 * 24,
  h168: 60 * 60 * 24 * 7,
}

// Tiny body: an optional enum. Anything else is a misuse.
const BodySchema = z.object({
  duration: z.enum(DURATION_KEYS).optional(),
})

/**
 * POST /api/a2a/bootstrap
 * Bootstrap a full A2A session for the current user.
 *
 * Body (optional): { duration?: 'h1' | 'h24' | 'h168' }
 *   - default 'h24' (24 hours)
 *   - other Phase 4 settings (sessionIntent, rate limits) are inferred from
 *     TOOL_POLICIES; only the duration is user-configurable from the
 *     permission UI today.
 *
 * Called automatically by AuthGate after login, and manually from the
 * `/sessions/permissions` page (Grant / Re-grant button).
 */
export async function POST(request: Request) {
  const parsed = await validateRequest(request, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const key = parsed.data.duration
  const durationSeconds = key ? DURATION_SECONDS[key as DurationKey] : undefined

  const result = await bootstrapA2ASession({ durationSeconds })
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}
