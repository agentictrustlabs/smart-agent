import { NextRequest, NextResponse } from 'next/server'
import { getVoteEligibility } from '@/lib/actions/proposalVotes.action'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const roundId = req.nextUrl.searchParams.get('roundId')
  if (!roundId) return NextResponse.json({ error: 'roundId required' }, { status: 400 })
  const result = await getVoteEligibility(roundId)
  if ('error' in result) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
