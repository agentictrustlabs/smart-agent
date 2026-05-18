/** @sa-route web-auth @sa-auth session-cookie @sa-owner developer */
import { NextRequest, NextResponse } from 'next/server'
import { listDisbursementsForProposal } from '@/lib/actions/disbursements.action'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const proposalId = req.nextUrl.searchParams.get('proposalId')
  if (!proposalId) return NextResponse.json({ error: 'proposalId required' }, { status: 400 })
  const result = await listDisbursementsForProposal(proposalId)
  if ('error' in result) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
