import { NextRequest, NextResponse } from 'next/server'
import { updatePoolMandate, type UpdateMandateInput } from '@/lib/actions/poolAdmin.action'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: UpdateMandateInput
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.poolAgent || !body.poolIRI || !body.mandate) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  const result = await updatePoolMandate(body)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
