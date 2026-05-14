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
import type { Address } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getRoundForViewer } from '@/lib/actions/rounds.action'
import { closeRound } from '@/lib/actions/roundClose.action'
import { resolveRecipientTreasury } from '@smart-agent/sdk'
import { getPublicClient } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

interface IncomingBody {
  poolAgentId?: string
  awards?: Array<{
    proposalIRI: string
    recipientAddr: string
    recipientAgentIRI: string
    totalAmount: number
    unit: string
    /** Spec 006 — preserves the originating NeedIntent into the commitment. */
    needIntentId?: string
    /** Spec 006 — fulfillment milestone schedule (JSON array). */
    milestonesJson?: string
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

  // Spec-006 phase 2: walk the recipient through the treasury resolver.
  // The form passes `recipientAddr = proposal.proposerAgentId`, which may
  // be a hex address (good), a non-hex principal (did:/person_/nullifier:),
  // or — historically — fall back to the fund's own agent (the bug we're
  // replacing). The resolver returns the AgentAccount that actually owns
  // funds for that proposer; if it can't resolve, we reject the close
  // outright rather than burning funds to the wrong address.
  const resolverAddress = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  if (!resolverAddress) {
    return NextResponse.json(
      { ok: false, error: 'AGENT_ACCOUNT_RESOLVER_ADDRESS not set' },
      { status: 500 },
    )
  }
  const publicClient = getPublicClient()
  const resolvedAwards: Array<{
    proposalIRI: string
    recipientAgentIRI: string
    recipientAddr: Address
    totalAmount: bigint
    unit: string
    needIntentId?: string
    milestonesJson?: string
  }> = []
  for (const a of body.awards) {
    const resolved = await resolveRecipientTreasury(a.recipientAddr, {
      publicClient,
      resolverAddress,
      // principalToAgent is not yet wired (Phase 2 deliverable: hex-only).
      // Non-hex principals will return null until the MCP lookup ships.
    })
    if (!resolved) {
      return NextResponse.json(
        {
          ok: false,
          error: `recipient-unresolved: ${a.recipientAddr} — proposer needs sa:hasTreasury set (or pass a hex AgentAccount address)`,
        },
        { status: 400 },
      )
    }
    resolvedAwards.push({
      proposalIRI: a.proposalIRI,
      recipientAgentIRI: a.recipientAgentIRI,
      recipientAddr: resolved,
      totalAmount: BigInt(a.totalAmount),
      unit: a.unit,
      needIntentId: a.needIntentId,
      milestonesJson: a.milestonesJson,
    })
  }

  try {
    const result = await closeRound({
      roundId,
      poolAgentId: body.poolAgentId as `0x${string}`,
      awards: resolvedAwards,
    })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
