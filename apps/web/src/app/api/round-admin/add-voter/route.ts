/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event round.addVoter @sa-validation zod @sa-owner pm */
/**
 * POST /api/round-admin/add-voter
 *
 *   Body: { roundId, voterSmartAccount }
 *
 * Issues a RoundVoterCredential + admin→voter delegation for VoteRegistry.castVote
 * scoped to `roundId`. Gates on the caller being `canManageAgent(round.fundAgent)`
 * inside the action.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { addRoundVoter } from '@/lib/actions/round-voters.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  roundId: z.string().min(1).max(256),
  voterSmartAccount: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const result = await addRoundVoter(parsed.data)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
