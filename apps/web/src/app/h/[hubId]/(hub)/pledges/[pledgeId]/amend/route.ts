/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pledge amend route (US5).
 *
 * POST handler for the amend form. Lives in a sibling dir to avoid the
 * Next.js 15 route+page same-dir 405 footgun.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { amendMemberPledge } from '@/lib/actions/poolPledges.action'
import type { AmendPledgeRequest } from '@smart-agent/sdk'

export const dynamic = 'force-dynamic'

interface IncomingBody {
  change?: AmendPledgeRequest['change']
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ hubId: string; pledgeId: string }> },
) {
  const { hubId: slug, pledgeId: rawId } = await ctx.params

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', message: 'not-authenticated' } }, { status: 401 })
  }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', message: 'no-person-agent' } }, { status: 400 })
  }

  let body: IncomingBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: { kind: 'validation', message: 'invalid-json' } }, { status: 400 })
  }
  if (!body.change || !body.change.kind) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', message: 'change required' } }, { status: 400 })
  }

  const pledgeId = decodeURIComponent(rawId)
  const result = await amendMemberPledge({ pledgeId, change: body.change })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', message: result.error } }, { status: 400 })
  }

  // Success → redirect back to the pledge detail page.
  return NextResponse.redirect(
    new URL(`/h/${slug}/pledges/${encodeURIComponent(pledgeId)}`, req.url),
    { status: 303 },
  )
}
