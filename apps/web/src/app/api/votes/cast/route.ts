import { NextRequest, NextResponse } from 'next/server'
import { castVote } from '@/lib/actions/proposalVotes.action'

export const dynamic = 'force-dynamic'

interface CastBody {
  roundId?: string
  proposalId?: string
  vote?: 'approve' | 'reject' | 'abstain'
  rationale?: string
}

export async function POST(req: NextRequest) {
  let body: CastBody
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.roundId || !body.proposalId || !body.vote) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  if (!['approve', 'reject', 'abstain'].includes(body.vote)) {
    return NextResponse.json({ ok: false, error: 'invalid-vote' }, { status: 400 })
  }
  const result = await castVote({
    roundId: body.roundId,
    proposalId: body.proposalId,
    vote: body.vote,
    rationale: body.rationale,
  })
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
