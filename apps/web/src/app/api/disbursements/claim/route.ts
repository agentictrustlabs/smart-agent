import { NextRequest, NextResponse } from 'next/server'
import { claimDisbursement } from '@/lib/actions/disbursements.action'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { disbursementId?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.disbursementId) return NextResponse.json({ ok: false, error: 'disbursementId required' }, { status: 400 })
  const r = await claimDisbursement(body.disbursementId)
  if (!r.ok) return NextResponse.json(r, { status: 400 })
  return NextResponse.json(r)
}
