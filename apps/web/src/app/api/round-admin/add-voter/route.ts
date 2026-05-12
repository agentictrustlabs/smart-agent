/**
 * POST /api/round-admin/add-voter
 *
 *   Body: { roundId, voterSmartAccount }
 *
 * Issues a RoundVoterCredential + admin→voter delegation for VoteRegistry.castVote
 * scoped to `roundId`. Gates on the caller being `canManageAgent(round.fundAgent)`
 * inside the action.
 */

import { NextRequest, NextResponse } from 'next/server'
import { addRoundVoter } from '@/lib/actions/round-voters.action'

export const dynamic = 'force-dynamic'

interface Body {
  roundId?: string
  voterSmartAccount?: string
}

export async function POST(req: NextRequest) {
  let body: Body
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.roundId || !body.voterSmartAccount) {
    return NextResponse.json({ ok: false, error: 'roundId + voterSmartAccount required' }, { status: 400 })
  }
  const result = await addRoundVoter({
    roundId: body.roundId,
    voterSmartAccount: body.voterSmartAccount,
  })
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
