import { NextRequest, NextResponse } from 'next/server'
import { rotatePoolStewards, type RotateStewardsInput } from '@/lib/actions/poolAdmin.action'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: RotateStewardsInput
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.poolAgent || !body.poolIRI || !Array.isArray(body.stewards)) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  const result = await rotatePoolStewards(body)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
