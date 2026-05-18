/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event round.finalize @sa-risk-tier high @sa-validation zod @sa-owner pm */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { finalizeRoundFromTally } from '@/lib/actions/finalizeRound.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  roundFullId: z.string().min(1).max(256),
  // Cap at 1 year in hours so an attacker can't extend the dispute
  // window past the protocol's expected upper bound.
  disputeHours: z.number().int().nonnegative().max(24 * 365).optional(),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const result = await finalizeRoundFromTally(parsed.data)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
