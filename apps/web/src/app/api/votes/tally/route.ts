/** @sa-route web-auth @sa-auth session-cookie @sa-owner developer */
import { NextRequest, NextResponse } from 'next/server'
import { getRoundTally } from '@/lib/actions/proposalVotes.action'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const roundId = req.nextUrl.searchParams.get('roundId')
  if (!roundId) return NextResponse.json({ error: 'roundId required' }, { status: 400 })
  const result = await getRoundTally(roundId)
  if ('error' in result) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
