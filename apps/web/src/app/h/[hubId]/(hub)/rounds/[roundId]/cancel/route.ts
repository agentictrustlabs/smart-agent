/**
 * Treasury Phase 2.5 — POST /h/[hubId]/rounds/[roundId]/cancel
 *
 * Server-side handler for the round cancellation guardian. Authorises
 * the viewer against the fund and orchestrates the cancelRound() server
 * action. Returns 200 with the assertion id on success.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getRoundForViewer } from '@/lib/actions/rounds.action'
import { cancelRound } from '@/lib/actions/roundCancel.action'
import type { RoundCancelReason } from '@/lib/onchain/roundCanceledAssertion'

export const dynamic = 'force-dynamic'

interface IncomingBody {
  reasonKind?: RoundCancelReason
  reasonURI?: string
  revokedSessionHash?: string
}

const VALID_REASONS: RoundCancelReason[] = [
  'dispute',
  'security-incident',
  'mandate-change',
  'steward-action',
  'other',
]

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ hubId: string; roundId: string }> },
) {
  const { roundId: rawRoundId } = await ctx.params
  const roundId = decodeURIComponent(rawRoundId)

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ ok: false, error: 'not-authenticated' }, { status: 401 })
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return NextResponse.json({ ok: false, error: 'no-person-agent' }, { status: 400 })

  const { round } = await getRoundForViewer(roundId, myAgent)
  if (!round) return NextResponse.json({ ok: false, error: 'round-not-found' }, { status: 404 })
  const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'
  const fundAddress = round.fundAgentId.startsWith(AGENT_IRI_PREFIX)
    ? round.fundAgentId.slice(AGENT_IRI_PREFIX.length)
    : round.fundAgentId
  const can = await canManageAgent(myAgent, fundAddress)
  if (!can) return NextResponse.json({ ok: false, error: 'not-steward' }, { status: 403 })

  let body: IncomingBody
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.reasonKind || !VALID_REASONS.includes(body.reasonKind)) {
    return NextResponse.json({ ok: false, error: 'invalid reasonKind' }, { status: 400 })
  }

  try {
    const result = await cancelRound({
      roundId,
      reasonKind: body.reasonKind,
      reasonURI: body.reasonURI,
      revokedSessionHash: body.revokedSessionHash,
    })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
