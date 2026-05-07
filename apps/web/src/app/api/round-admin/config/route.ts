import { NextRequest, NextResponse } from 'next/server'
import { updateRoundVotingConfig, type UpdateVotingConfigInput } from '@/lib/actions/roundAdmin.action'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: UpdateVotingConfigInput
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.roundFullId) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  const result = await updateRoundVotingConfig(body)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
