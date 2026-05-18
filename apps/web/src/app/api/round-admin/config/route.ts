/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event round.updateConfig @sa-validation zod @sa-owner pm */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updateRoundVotingConfig } from '@/lib/actions/roundAdmin.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  roundFullId: z.string().min(1).max(256),
  votingStrategy: z.enum(['steward-quorum', 'member-approval', 'quadratic', 'ranked-choice']).optional(),
  votingThreshold: z.number().int().nonnegative().max(1_000_000).optional(),
  votingWindowStartsAt: z.string().max(64).optional(),
  votingWindowEndsAt: z.string().max(64).optional(),
  eligibleVoters: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const result = await updateRoundVotingConfig(parsed.data)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
