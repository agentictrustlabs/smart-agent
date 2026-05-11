import { NextRequest, NextResponse } from 'next/server'
import { castVote } from '@/lib/actions/proposalVotes.action'

export const dynamic = 'force-dynamic'

interface CastBody {
  roundId?: string
  /** Pre-derived proposal subject (bytes32 hex). Spec 004 — vote:cast now
   *  takes the on-chain subject directly; the SQL `proposal_submissions`
   *  table is being retired. */
  proposalSubject?: `0x${string}`
  vote?: 'approve' | 'reject' | 'abstain'
  rationale?: string
}

export async function POST(req: NextRequest) {
  let body: CastBody
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.roundId || !body.proposalSubject || !body.vote) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  if (!['approve', 'reject', 'abstain'].includes(body.vote)) {
    return NextResponse.json({ ok: false, error: 'invalid-vote' }, { status: 400 })
  }
  const result = await castVote({
    roundId: body.roundId,
    proposalSubject: body.proposalSubject,
    vote: body.vote,
    rationale: body.rationale,
  })
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
