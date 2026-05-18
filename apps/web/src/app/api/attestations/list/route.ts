/** @sa-route web-auth @sa-auth session-cookie @sa-owner developer */
import { NextRequest, NextResponse } from 'next/server'
import { listAttestationsForProposal } from '@/lib/actions/disbursements.action'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const proposalId = req.nextUrl.searchParams.get('proposalId')
  if (!proposalId) return NextResponse.json({ error: 'proposalId required' }, { status: 400 })
  const r = await listAttestationsForProposal(proposalId)
  if ('error' in r) return NextResponse.json(r, { status: 400 })
  return NextResponse.json(r)
}
