/** @sa-route web-auth @sa-auth session-cookie @sa-owner developer */
import { NextRequest, NextResponse } from 'next/server'
import { getMyVoteForProposal } from '@/lib/actions/proposalVotes.action'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const roundId = req.nextUrl.searchParams.get('roundId')
  const proposalId = req.nextUrl.searchParams.get('proposalId')
  if (!roundId || !proposalId) return NextResponse.json({ error: 'roundId + proposalId required' }, { status: 400 })
  const result = await getMyVoteForProposal(roundId, proposalId)
  if (result && typeof result === 'object' && 'error' in result) return NextResponse.json(result, { status: 400 })
  if (!result) return NextResponse.json({ vote: null })
  return NextResponse.json(result)
}
