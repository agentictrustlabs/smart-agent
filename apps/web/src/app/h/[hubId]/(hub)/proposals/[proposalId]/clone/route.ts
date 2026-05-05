/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Clone route (T062).
 *
 * POST handler. Calls `cloneMemberProposal` (which routes through
 * `GrantProposalClient.clone` → MCP `grant_proposal:clone`).
 *
 * On success, redirects to the new draft's detail page so the proposer
 * can re-target a round (the clone tool clears `roundId`/`fundMandateId`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { cloneMemberProposal } from '@/lib/actions/grantProposals.action'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ hubId: string; proposalId: string }> },
) {
  const { hubId: slug, proposalId } = await ctx.params
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.redirect(new URL(`/`, req.url), { status: 303 })
  }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return NextResponse.redirect(
      new URL(`/h/${slug}/proposals/${proposalId}?err=no-person-agent`, req.url),
      { status: 303 },
    )
  }

  const result = await cloneMemberProposal(proposalId)
  if (!result.ok) {
    const encoded = encodeURIComponent(result.error)
    return NextResponse.redirect(
      new URL(`/h/${slug}/proposals/${proposalId}?err=${encoded}`, req.url),
      { status: 303 },
    )
  }

  return NextResponse.redirect(
    new URL(
      `/h/${slug}/proposals/${result.proposal.id}?msg=${encodeURIComponent(
        'Cloned as fresh draft. Re-target by browsing rounds and submitting.',
      )}`,
      req.url,
    ),
    { status: 303 },
  )
}
