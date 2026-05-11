/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Withdraw route (T061).
 *
 * Spec 004 update: the withdraw call is now an on-chain `withdraw(subject)`
 * gated by an AnonCreds `ProposalSubmitterCredential` presentation + an
 * admin→holder→session redeem chain. The `proposalId` URL slug is no
 * longer enough on its own — we also need the proposal's round and the
 * round's pool, which the action layer uses to derive the on-chain
 * subject and to build the AnonCreds proof. The proposal-detail page
 * supplies them via hidden form fields.
 *
 * On success, redirects to the proposals list with a status flash.
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

  // Read roundId + poolAgentId from the form body or query string. The
  // proposal-detail page wires hidden form fields; missing inputs surface
  // a clear error rather than a runtime crash inside the action.
  const form = await req.formData().catch(() => null)
  const roundId = (form?.get('roundId') as string | null) ?? new URL(req.url).searchParams.get('roundId')
  const poolAgentId = (form?.get('poolAgentId') as string | null) ?? new URL(req.url).searchParams.get('poolAgentId')
  if (!roundId || !poolAgentId) {
    return NextResponse.redirect(
      new URL(`/h/${slug}/proposals/${proposalId}?err=missing-round-or-pool`, req.url),
      { status: 303 },
    )
  }

  const result = await withdrawMemberProposal({ roundId, poolAgentId })
  if (!result.ok) {
    const encoded = encodeURIComponent(result.error ?? 'withdraw-failed')
    return NextResponse.redirect(
      new URL(`/h/${slug}/proposals/${proposalId}?err=${encoded}`, req.url),
      { status: 303 },
    )
  }

  // FR-023 intentRevertedToExpressed cascade is on the spec-001 cross-MCP
  // refactor queue; the on-chain withdraw doesn't surface it directly today.
  const msg = 'Proposal withdrawn on chain.'

  return NextResponse.redirect(
    new URL(`/h/${slug}/proposals?msg=${encodeURIComponent(msg)}&tx=${result.txHash}`, req.url),
    { status: 303 },
  )
}
