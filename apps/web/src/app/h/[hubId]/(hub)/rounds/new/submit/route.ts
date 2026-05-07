/**
 * POST /h/[hubId]/rounds/new/submit — round open handler.
 *
 * Authenticates the viewer, checks they can manage the chosen fund,
 * calls openRound() server action. Persists the displayName inside the
 * mandate JSON (matches seed-test-round.ts) so the runtime kb-sync
 * re-emits sa:displayName on every PUT.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { openRound } from '@/lib/actions/roundOpen.action'

export const dynamic = 'force-dynamic'

interface IncomingBody {
  id?: string
  displayName?: string
  fundAgentId?: string
  poolAgentId?: string
  mandate?: { acceptedKinds: string[]; acceptedGeo: string[]; budgetCeiling: number; expectedAwards: number }
  reportingCadence?: 'monthly' | 'quarterly' | 'annual' | 'milestone' | 'none'
  deadline?: string
  decisionDate?: string
  visibility?: 'public' | 'private'
  requiredCredentials?: string[]
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ ok: false, error: 'not-authenticated' }, { status: 401 })
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return NextResponse.json({ ok: false, error: 'no-person-agent' }, { status: 400 })

  let body: IncomingBody
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.id || !body.displayName || !body.fundAgentId || !body.mandate
      || !body.reportingCadence || !body.deadline || !body.decisionDate || !body.visibility) {
    return NextResponse.json({ ok: false, error: 'missing required fields' }, { status: 400 })
  }
  const can = await canManageAgent(myAgent, body.fundAgentId)
  if (!can) return NextResponse.json({ ok: false, error: 'not-authorized-on-fund' }, { status: 403 })

  // Stash the displayName inside the mandate JSON so the runtime
  // emitRoundsTurtle hoists it back out. Same trick the seed uses.
  const mandateWithDisplay = {
    ...body.mandate,
    displayName: body.displayName,
  }

  try {
    const result = await openRound({
      id: body.id,
      fundAgentId: body.fundAgentId as `0x${string}`,
      mandate: mandateWithDisplay,
      reportingCadence: body.reportingCadence,
      deadline: body.deadline,
      decisionDate: body.decisionDate,
      visibility: body.visibility,
      requiredCredentials: body.requiredCredentials,
    })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
