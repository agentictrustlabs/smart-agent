/**
 * Treasury Phase 2.5 — POST /h/[hubId]/rounds/[roundId]/close
 *
 * Server-side handler for the steward Close Round form. Authenticates
 * the viewer, confirms they can manage the round's fund, and orchestrates
 * the closeRound() server action. On success returns 200 with the
 * assertion ids; client redirects to the round detail page.
 *
 * Lives in a SIBLING dir to the round detail (not under it) to avoid the
 * Next.js 15 route+page same-dir 405 footgun.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getRoundForViewer } from '@/lib/actions/rounds.action'
import { closeRound } from '@/lib/actions/roundClose.action'

export const dynamic = 'force-dynamic'

interface IncomingBody {
  poolAgentId?: string
  awards?: Array<{
    proposalIRI: string
    recipientAddr: string
    recipientAgentIRI: string
    totalAmount: number
    unit: string
  }>
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ hubId: string; roundId: string }> },
) {
  const { roundId: rawRoundId } = await ctx.params
  const roundId = decodeURIComponent(rawRoundId)

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'not-authenticated' }, { status: 401 })
  }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return NextResponse.json({ ok: false, error: 'no-person-agent' }, { status: 400 })
  }

  // Steward gate: viewer must be authorised on the round's fund. Reuses
  // canManageAgent which checks both governance edges (ROLE_OWNER /
  // ROLE_OPERATOR) and ATL_CONTROLLER membership — the same combination
  // the existing seed paths populate.
  const { round } = await getRoundForViewer(roundId, myAgent)
  if (!round) {
    return NextResponse.json({ ok: false, error: 'round-not-found' }, { status: 404 })
  }
  // Discovery returns fundAgentId as full IRI; strip prefix for canManageAgent.
  const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'
  const fundAddress = round.fundAgentId.startsWith(AGENT_IRI_PREFIX)
    ? round.fundAgentId.slice(AGENT_IRI_PREFIX.length)
    : round.fundAgentId
  const can = await canManageAgent(myAgent, fundAddress)
  if (!can) {
    return NextResponse.json({ ok: false, error: 'not-steward' }, { status: 403 })
  }

  let body: IncomingBody
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.poolAgentId || !Array.isArray(body.awards) || body.awards.length === 0) {
    return NextResponse.json({ ok: false, error: 'missing required fields' }, { status: 400 })
  }
  for (const a of body.awards) {
    if (!a.proposalIRI || typeof a.totalAmount !== 'number' || a.totalAmount <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid award row' }, { status: 400 })
    }
  }

  try {
    const result = await closeRound({
      roundId,
      poolAgentId: body.poolAgentId,
      awards: body.awards.map(a => ({
        proposalIRI: a.proposalIRI,
        recipientAgentIRI: a.recipientAgentIRI,
        recipientAddr: a.recipientAddr,
        totalAmount: a.totalAmount,
        unit: a.unit,
        // Default tranche schedule: single tranche = total amount.
        tranches: [{
          trancheId: `${roundId}/${a.proposalIRI}/tranche-1`,
          amount: a.totalAmount,
          milestoneRef: 'milestone-1',
        }],
      })),
    })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
