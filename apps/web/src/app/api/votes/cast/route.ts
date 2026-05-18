/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event vote.cast @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { castVote } from '@/lib/actions/proposalVotes.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  roundId: z.string().min(1).max(256),
  /** Pre-derived proposal subject (bytes32 hex). Spec 004 — vote:cast now
   *  takes the on-chain subject directly; the SQL `proposal_submissions`
   *  table is being retired. */
  proposalSubject: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  vote: z.enum(['approve', 'reject', 'abstain']),
  rationale: z.string().max(4096).optional(),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const result = await castVote({
    roundId: parsed.data.roundId,
    proposalSubject: parsed.data.proposalSubject as `0x${string}`,
    vote: parsed.data.vote,
    rationale: parsed.data.rationale,
  })
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
