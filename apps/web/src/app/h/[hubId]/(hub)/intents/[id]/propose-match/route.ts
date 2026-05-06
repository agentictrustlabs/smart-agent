/**
 * Spec 001 — Intent Marketplace (Direct Lane). Propose-match route handler.
 *
 * POST handler invoked by the ProposeMatchButton client component. Reads
 * { candidateIntentId, basis } from the body, authenticates the viewer,
 * and calls `proposeMatch(...)` from the action layer.
 *
 *   - On success: returns { ok: true, initiation } — the client redirects
 *     to the intent detail with a `?matched=1` flag.
 *   - On typed error: returns 400 with { ok: false, error } and the client
 *     redirects with a `?err=<kind>` flag for the flash banner.
 *
 * Sibling-subdir layout (this file is under `propose-match/`, not the same
 * directory as `page.tsx`) avoids the Next.js 15 405 footgun.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { proposeMatch } from '@/lib/actions/matchInitiations.action'
import type { RankBasis } from '@smart-agent/sdk'

export const dynamic = 'force-dynamic'

interface IncomingBody {
  candidateIntentId?: string
  basis?: RankBasis
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ hubId: string; id: string }> },
) {
  const { id: viewedIntentId } = await ctx.params

  // Auth.
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', messages: ['not-authenticated'] } },
      { status: 401 },
    )
  }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', messages: ['no-person-agent'] } },
      { status: 400 },
    )
  }

  // Parse body.
  let body: IncomingBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', messages: ['invalid-json'] } },
      { status: 400 },
    )
  }

  if (!body.candidateIntentId) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', messages: ['candidateIntentId required'] } },
      { status: 400 },
    )
  }
  if (!body.basis) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', messages: ['basis required'] } },
      { status: 400 },
    )
  }

  // Submit.
  let result
  try {
    result = await proposeMatch({
      request: {
        viewedIntentId,
        candidateIntentId: body.candidateIntentId,
        initiatorAgentId: myAgent,
        basis: body.basis,
      },
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: { kind: 'validation', messages: [err instanceof Error ? err.message : String(err)] },
      },
      { status: 500 },
    )
  }

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true, initiation: result.initiation }, { status: 200 })
}
