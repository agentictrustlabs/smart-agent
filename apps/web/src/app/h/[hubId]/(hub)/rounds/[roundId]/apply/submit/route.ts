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
import { createPublicClient, http, keccak256, toHex, getAddress } from 'viem'
import { foundry } from 'viem/chains'
import { fundRegistryAbi } from '@smart-agent/sdk'

export const dynamic = 'force-dynamic'

interface IncomingBody {
  proposerAgentId?: string
  roundId?: string | null
  fundMandateId?: string | null
  displayName?: string
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

  // Construct request. Normalize roundId to URN form — the steward
  // listing query filters by URN form, so the proposal's stored round_id
  // must match.
  const rawRound = body.roundId ?? roundId
  const fullRoundId = rawRound.startsWith('urn:smart-agent:round:')
    ? rawRound
    : `urn:smart-agent:round:${rawRound}`
  const request: SubmitGrantProposalRequest = {
    proposerAgentId: body.proposerAgentId ?? myAgent,
    displayName: (body.displayName ?? '').trim(),
    roundId: fullRoundId,
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
  const missing: string[] = []
  if (!request.displayName) missing.push('displayName')
  if (!request.basedOnIntentId) missing.push('basedOnIntentId')
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: { kind: 'missing-required-fields', fields: missing } },
      { status: 400 },
    )
  }

  // Resolve the round's pool agent from chain so the action layer can
  // bind expected attributes + auto-issue ProposalSubmitterCredential for
  // stateless-auth users acting as their own pool admin.
  let poolAgentId: string | undefined
  try {
    const fundRegistry = process.env.FUND_REGISTRY_ADDRESS as `0x${string}` | undefined
    if (fundRegistry) {
      const client = createPublicClient({
        chain: foundry,
        transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
      })
      const slug = fullRoundId.slice('urn:smart-agent:round:'.length)
      const roundSubject = keccak256(toHex(`sa:round:${slug}`))
      const poolAgent = await client.readContract({
        address: fundRegistry,
        abi: fundRegistryAbi,
        functionName: 'getRoundPoolAgent',
        args: [roundSubject],
      }) as `0x${string}`
      if (poolAgent && poolAgent !== '0x0000000000000000000000000000000000000000') {
        poolAgentId = getAddress(poolAgent)
      }
    }
  } catch (e) {
    console.warn('[proposal-submit] poolAgent resolution failed:', (e as Error).message)
  }

  // Submit.
  let result
  try {
    result = await submitProposal({ request, poolAgentId })
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

  // Success → redirect to the proposal detail page. Spec 004 — proposals
  // live on chain in GrantProposalRegistry; the row's id IS the
  // bytes32 proposalSubject the MCP returns.
  const r = result as unknown as { proposalSubject?: string; proposal?: { id?: string } }
  const proposalId = r.proposalSubject ?? r.proposal?.id ?? ''
  if (!proposalId) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', messages: ['MCP returned no proposal id'] } },
      { status: 500 },
    )
  }
  const target = `/h/${slug}/proposals/${proposalId}`
  return NextResponse.redirect(new URL(target, req.url), { status: 303 })
}
