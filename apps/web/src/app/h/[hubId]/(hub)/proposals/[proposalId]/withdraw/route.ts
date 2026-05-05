/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Withdraw route (T061).
 *
 * POST handler. Calls `withdrawMemberProposal` (which routes through
 * `GrantProposalClient.withdraw` → MCP `grant_proposal:withdraw`).
 *
 * Surfaces `WithdrawGrantProposalResult.intentRevertedToExpressed` to the
 * user — this is the cross-spec touch-point with spec 001's
 * `MatchInitiation` count (FR-023):
 *
 *   - true  → intent has reverted to `expressed` (count was 0 after our -1).
 *             Conditional message tells the proposer they may submit a new
 *             proposal targeting a different round.
 *   - false → intent stays `acknowledged` because another live
 *             acknowledgement exists (e.g., a still-pending spec 001
 *             MatchInitiation on the same intent).
 *
 * On success, redirects to the proposals list with the conditional flash.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { withdrawMemberProposal } from '@/lib/actions/grantProposals.action'

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

  const result = await withdrawMemberProposal(proposalId)
  if (!result.ok) {
    const encoded = encodeURIComponent(result.error ?? 'withdraw-failed')
    return NextResponse.redirect(
      new URL(`/h/${slug}/proposals/${proposalId}?err=${encoded}`, req.url),
      { status: 303 },
    )
  }

  // Cross-spec touch-point — FR-023.
  const msg = result.intentRevertedToExpressed
    ? 'Proposal withdrawn. Your underlying intent has reverted to `expressed` — you can submit a new proposal to a different round.'
    : 'Proposal withdrawn. Your underlying intent remains `acknowledged` because another live acknowledgement exists (e.g., a pending Match Initiation).'

  return NextResponse.redirect(
    new URL(`/h/${slug}/proposals?msg=${encodeURIComponent(msg)}`, req.url),
    { status: 303 },
  )
}
