/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pledge stop route (US5).
 *
 * POST handler for the stop button. Lives in a sibling dir to avoid the
 * Next.js 15 route+page same-dir 405 footgun.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { stopMemberPledge } from '@/lib/actions/poolPledges.action'

export const dynamic = 'force-dynamic'

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

  const pledgeId = decodeURIComponent(rawId)
  const result = await stopMemberPledge(pledgeId)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', message: result.error } }, { status: 400 })
  }

  // Success → back to the pledge detail page (now showing Stopped status).
  return NextResponse.redirect(
    new URL(`/h/${slug}/pledges/${encodeURIComponent(pledgeId)}`, req.url),
    { status: 303 },
  )
}
