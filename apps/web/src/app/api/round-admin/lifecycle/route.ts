import { NextRequest, NextResponse } from 'next/server'
import { advanceRoundLifecycle, type RoundLifecycleAction } from '@/lib/actions/roundAdmin.action'

export const dynamic = 'force-dynamic'

interface Body { roundFullId?: string; action?: RoundLifecycleAction }

export async function POST(req: NextRequest) {
  let body: Body
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.roundFullId || !body.action) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  const valid: RoundLifecycleAction[] = ['advance-to-review', 'advance-to-decided', 'advance-to-closed', 'cancel']
  if (!valid.includes(body.action)) {
    return NextResponse.json({ ok: false, error: 'invalid-action' }, { status: 400 })
  }
  const result = await advanceRoundLifecycle(body.roundFullId, body.action)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
