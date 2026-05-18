/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event round.lifecycle @sa-validation zod @sa-owner pm */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { advanceRoundLifecycle } from '@/lib/actions/roundAdmin.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  roundFullId: z.string().min(1).max(256),
  action: z.enum(['advance-to-review', 'advance-to-decided', 'advance-to-closed', 'cancel']),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const result = await advanceRoundLifecycle(parsed.data.roundFullId, parsed.data.action)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
