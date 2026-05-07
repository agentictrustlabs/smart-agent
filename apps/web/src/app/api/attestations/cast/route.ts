import { NextRequest, NextResponse } from 'next/server'
import { castAttestation, type CastAttestationInput } from '@/lib/actions/disbursements.action'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: CastAttestationInput
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.proposalId || !body.fundAgent || !body.milestoneLabel || !body.status) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  const r = await castAttestation(body)
  if (!r.ok) return NextResponse.json(r, { status: 400 })
  return NextResponse.json(r)
}
