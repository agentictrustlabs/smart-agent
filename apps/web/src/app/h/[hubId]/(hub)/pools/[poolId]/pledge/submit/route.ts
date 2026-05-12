/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pledge submit-handler route.
 *
 * POST handler for the pledge composer. Reads the JSON body (built by the
 * client form), authenticates the viewer, calls into `submitPledge(...)`
 * server action, and either:
 *   - redirects to /h/<hubId>/pledges on success
 *   - returns 400 with { ok: false, error } on a typed error
 *
 * Lives in a SIBLING dir to avoid the Next.js 15 route+page same-dir 405
 * footgun.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAddress } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { submitPledge } from '@/lib/actions/poolPledges.action'
import { getPoolForViewer } from '@/lib/actions/pools.action'
import type { SubmitPledgeRequest } from '@smart-agent/sdk'

export const dynamic = 'force-dynamic'

interface IncomingBody {
  poolAgentId?: string
  cadence?: SubmitPledgeRequest['cadence']
  unit?: string
  amount?: number
  duration?: number | null
  restrictions?: SubmitPledgeRequest['restrictions']
  storyPermissions?: SubmitPledgeRequest['storyPermissions']
  poolVisibility?: 'public' | 'private'
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ hubId: string; poolId: string }> },
) {
  const { hubId: slug, poolId: rawPoolId } = await ctx.params

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', messages: ['not-authenticated'] } }, { status: 401 })
  }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', messages: ['no-person-agent'] } }, { status: 400 })
  }

  let body: IncomingBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: { kind: 'validation', messages: ['invalid-json'] } }, { status: 400 })
  }

  const poolId = body.poolAgentId ?? decodeURIComponent(rawPoolId)
  if (!body.cadence || !body.unit || typeof body.amount !== 'number' || !body.storyPermissions) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', messages: ['missing required fields'] } },
      { status: 400 },
    )
  }

  const request: SubmitPledgeRequest = {
    pledgerAgentId: myAgent,
    poolAgentId: poolId,
    cadence: body.cadence,
    unit: body.unit,
    amount: body.amount,
    duration: body.duration ?? undefined,
    restrictions: body.restrictions,
    storyPermissions: body.storyPermissions,
  }

  const poolVisibility = body.poolVisibility ?? 'public'

  // Spec 004 (b2): submitPledge needs the pool's on-chain treasury address
  // so PledgeRegistry.submit can be redeemed under the pool admin's
  // delegation. Resolve from the pool URN via DiscoveryService.
  const poolDetail = await getPoolForViewer(poolId, myAgent)
  const treasuryAddress = poolDetail.pool?.treasuryAddress
  if (!treasuryAddress) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', messages: [`pool not found or no treasury address: ${poolId}`] } },
      { status: 400 },
    )
  }
  let poolAgent: `0x${string}`
  try {
    poolAgent = getAddress(treasuryAddress as `0x${string}`)
  } catch {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', messages: [`invalid pool treasury address: ${treasuryAddress}`] } },
      { status: 400 },
    )
  }

  let result
  try {
    result = await submitPledge({ request, poolVisibility, poolAgent })
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

  // Success → redirect to "your pledges" page.
  const target = `/h/${slug}/pledges`
  return NextResponse.redirect(new URL(target, req.url), { status: 303 })
}
