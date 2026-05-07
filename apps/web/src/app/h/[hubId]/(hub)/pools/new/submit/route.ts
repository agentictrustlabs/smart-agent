/**
 * POST /h/[hubId]/pools/new/submit — pool create handler.
 *
 * Authenticates the viewer, calls createPool() server action, returns
 * the new pool agent id + treasury address. Sibling-dir to the page to
 * avoid the Next 15 same-dir 405 footgun.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { createPool, type CreatePoolInput } from '@/lib/actions/poolCreate.action'

export const dynamic = 'force-dynamic'

interface IncomingBody extends Partial<CreatePoolInput> {}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ ok: false, error: 'not-authenticated' }, { status: 401 })
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return NextResponse.json({ ok: false, error: 'no-person-agent' }, { status: 400 })

  let body: IncomingBody
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.id || !body.name || !body.domain || !body.mandate || !body.governanceModel
      || !body.acceptedRestrictions || !body.acceptedUnits || !body.ceilingPolicy
      || !body.visibility) {
    return NextResponse.json({ ok: false, error: 'missing required fields' }, { status: 400 })
  }

  try {
    const result = await createPool({
      id: body.id,
      name: body.name,
      domain: body.domain,
      mandate: body.mandate,
      governanceModel: body.governanceModel,
      acceptedRestrictions: body.acceptedRestrictions,
      acceptedUnits: body.acceptedUnits,
      capacityCeiling: body.capacityCeiling,
      ceilingPolicy: body.ceilingPolicy,
      visibility: body.visibility,
      addressedMembers: body.addressedMembers,
      // Stewards default to caller's person agent so the just-created pool
      // has at least one steward who can manage it.
      stewards: (body.stewards && body.stewards.length > 0
        ? body.stewards
        : [myAgent]) as `0x${string}`[],
    })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
