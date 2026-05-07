import { NextRequest, NextResponse } from 'next/server'
import { markDisbursementPaid } from '@/lib/actions/disbursements.action'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { disbursementId?: string; fundAgent?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.disbursementId || !body.fundAgent) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  const r = await markDisbursementPaid({ disbursementId: body.disbursementId, fundAgent: body.fundAgent })
  if (!r.ok) return NextResponse.json(r, { status: 400 })
  return NextResponse.json(r)
}
