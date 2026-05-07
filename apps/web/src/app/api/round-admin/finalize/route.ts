import { NextRequest, NextResponse } from 'next/server'
import { finalizeRoundFromTally } from '@/lib/actions/finalizeRound.action'

export const dynamic = 'force-dynamic'

interface Body { roundFullId?: string; disputeHours?: number }

export async function POST(req: NextRequest) {
  let body: Body
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.roundFullId) {
    return NextResponse.json({ ok: false, error: 'roundFullId required' }, { status: 400 })
  }
  const result = await finalizeRoundFromTally({
    roundFullId: body.roundFullId,
    disputeHours: body.disputeHours,
  })
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
