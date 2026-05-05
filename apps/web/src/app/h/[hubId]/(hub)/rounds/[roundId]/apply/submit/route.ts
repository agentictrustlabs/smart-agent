/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Submit-handler route (T046).
 *
 * POST handler for the proposal composer. Reads the JSON body (built by
 * the client form), authenticates the viewer, calls into the
 * `submitProposal(...)` server action, and either:
 *   - on success, redirects to /h/<hubId>/proposals/<newProposalId>
 *   - on a typed error, returns 400 with { ok: false, error } so the
 *     client form can render the error banner.
 *
 * The redirect is set up so the client's `fetch(...)` sees `res.redirected`
 * and follows it via `router.push(...)`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { submitProposal } from '@/lib/actions/grantProposals.action'
import type { SubmitGrantProposalRequest } from '@smart-agent/sdk'

export const dynamic = 'force-dynamic'

interface IncomingBody {
  proposerAgentId?: string
  roundId?: string | null
  fundMandateId?: string | null
  basedOnIntentId?: string
  budget?: SubmitGrantProposalRequest['budget']
  plan?: SubmitGrantProposalRequest['plan']
  milestones?: SubmitGrantProposalRequest['milestones']
  desiredOutcomes?: SubmitGrantProposalRequest['desiredOutcomes']
  reportingObligations?: SubmitGrantProposalRequest['reportingObligations']
  organisationalBackground?: SubmitGrantProposalRequest['organisationalBackground']
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ hubId: string; roundId: string }> },
) {
  const { hubId: slug, roundId } = await ctx.params

  // Auth.
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', messages: ['not-authenticated'] } }, { status: 401 })
  }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', messages: ['no-person-agent'] } }, { status: 400 })
  }

  // Parse body.
  let body: IncomingBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: { kind: 'validation', messages: ['invalid-json'] } }, { status: 400 })
  }

  // Construct request.
  const request: SubmitGrantProposalRequest = {
    proposerAgentId: body.proposerAgentId ?? myAgent,
    roundId: body.roundId ?? roundId,
    fundMandateId: body.fundMandateId ?? null,
    basedOnIntentId: body.basedOnIntentId ?? '',
    budget: body.budget ?? { lineItems: [], total: 0 },
    plan: body.plan ?? { narrative: '' },
    milestones: body.milestones ?? [],
    desiredOutcomes: body.desiredOutcomes ?? [],
    reportingObligations: body.reportingObligations ?? { cadence: 'none', format: 'written' },
    organisationalBackground: body.organisationalBackground ?? { narrative: '' },
  }

  // Quick required-field gate — surfaces a friendlier error than the MCP
  // when the form sends an empty draft.
  if (!request.basedOnIntentId) {
    return NextResponse.json(
      {
        ok: false,
        error: { kind: 'missing-required-fields', fields: ['basedOnIntentId'] },
      },
      { status: 400 },
    )
  }

  // Submit.
  let result
  try {
    result = await submitProposal({ request })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          kind: 'validation',
          messages: [err instanceof Error ? err.message : String(err)],
        },
      },
      { status: 500 },
    )
  }

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  // Success → redirect to the proposal detail page.
  const proposalId = result.proposal.id
  const target = `/h/${slug}/proposals/${proposalId}`
  return NextResponse.redirect(new URL(target, req.url), { status: 303 })
}
