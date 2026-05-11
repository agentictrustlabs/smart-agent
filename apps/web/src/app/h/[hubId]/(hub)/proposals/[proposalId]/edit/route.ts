/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Edit route (T060).
 *
 * POST handler for the pre-deadline edit form. Reads form-encoded fields
 * (`planNarrative`, `organisationalBackground`), constructs an
 * `EditGrantProposalRequest` with only the changed fields, and calls
 * `editMemberProposal` (which routes through the SDK
 * `GrantProposalClient.edit` → MCP `grant_proposal:edit_pre_deadline`).
 *
 * On success, redirects back to the detail page with `?msg=...`.
 * On error (typically post-deadline), redirects with `?err=...`.
 *
 * V1 simplification: only the narrative fields are wired here; structured
 * editing of milestones / budget line items is a follow-up. The MCP tool
 * accepts the full editable surface — adding more form fields is mechanical.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { editMemberProposal, getMemberProposal } from '@/lib/actions/grantProposals.action'
import type { EditGrantProposalRequest } from '@smart-agent/sdk'

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

  // Parse form data.
  const form = await req.formData()
  const planNarrative = (form.get('planNarrative') as string | null) ?? null
  const organisationalBackground = (form.get('organisationalBackground') as string | null) ?? null
  // Spec 004 — edit_pre_deadline is now on-chain and requires the round +
  // pool the proposal lives under. The proposal-edit page wires these
  // as hidden form fields.
  const roundId = (form.get('roundId') as string | null) ?? null
  const poolAgentId = (form.get('poolAgentId') as string | null) ?? null
  if (!roundId || !poolAgentId) {
    return NextResponse.redirect(
      new URL(`/h/${slug}/proposals/${proposalId}?err=missing-round-or-pool`, req.url),
      { status: 303 },
    )
  }

  // Build patch — only include fields the user actually edited.
  const patch: EditGrantProposalRequest['patch'] = {}
  if (planNarrative !== null) {
    // Pull through any non-narrative plan fields the existing proposal has.
    const existing = await getMemberProposal(proposalId)
    patch.plan = {
      narrative: planNarrative,
      ...(existing?.plan?.planArtifactRef ? { planArtifactRef: existing.plan.planArtifactRef } : {}),
    }
  }
  if (organisationalBackground !== null) {
    const existing = await getMemberProposal(proposalId)
    patch.organisationalBackground = {
      narrative: organisationalBackground,
      ...(existing?.organisationalBackground?.priorTrackRecordRefs?.length
        ? { priorTrackRecordRefs: existing.organisationalBackground.priorTrackRecordRefs }
        : {}),
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.redirect(
      new URL(`/h/${slug}/proposals/${proposalId}?err=nothing-to-edit`, req.url),
      { status: 303 },
    )
  }

  const result = await editMemberProposal({ roundId, poolAgentId, patch })
  if (!result.ok) {
    const encoded = encodeURIComponent(result.error)
    return NextResponse.redirect(
      new URL(`/h/${slug}/proposals/${proposalId}?err=${encoded}`, req.url),
      { status: 303 },
    )
  }
  return NextResponse.redirect(
    new URL(`/h/${slug}/proposals/${proposalId}?msg=Saved+on+chain&tx=${result.txHash}`, req.url),
    { status: 303 },
  )
}
