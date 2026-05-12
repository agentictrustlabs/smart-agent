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
import { HUB_SLUG_MAP } from '@/lib/hub-routes'

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
  votingStrategy?: 'steward-quorum' | 'member-approval' | 'quadratic' | 'ranked-choice'
  votingThreshold?: number
  votingWindowDays?: number
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ hubId: string }> }) {
  const { hubId: hubSlug } = await ctx.params
  const internalHubId = HUB_SLUG_MAP[hubSlug]
  if (!internalHubId) return NextResponse.json({ ok: false, error: 'unknown hub' }, { status: 404 })
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
  // Unified governance: operator IS the pool. Reject mismatches so
  // stale clients can't smuggle in a separate fundAgent.
  if (body.poolAgentId && body.fundAgentId.toLowerCase() !== body.poolAgentId.toLowerCase()) {
    return NextResponse.json(
      { ok: false, error: 'round operator must equal poolAgent (unified-governance rule)' },
      { status: 400 },
    )
  }
  const can = await canManageAgent(myAgent, body.fundAgentId)
  if (!can) return NextResponse.json({ ok: false, error: 'not-authorized-on-pool' }, { status: 403 })

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
      poolAgentId: body.poolAgentId ? (body.poolAgentId as `0x${string}`) : undefined,
      mandate: mandateWithDisplay,
      reportingCadence: body.reportingCadence,
      deadline: body.deadline,
      decisionDate: body.decisionDate,
      visibility: body.visibility,
      requiredCredentials: body.requiredCredentials,
      votingStrategy: body.votingStrategy,
      votingThreshold: body.votingThreshold,
      votingWindowDays: body.votingWindowDays,
    })

    // Auto-issue RoundVoterCredentials to every Membership/member of
    // the pool's anchoring org. One cred per (round, member). Members
    // gain the right to cast a ballot via the existing AnonCreds
    // presentation path. Best-effort: failures don't block round
    // creation — admins can re-issue individually via the voters tab.
    try {
      const { DiscoveryService } = await import('@smart-agent/discovery')
      const { listOrgMembersOnChain } = await import('@/lib/agent-registry')
      const { addRoundVoter } = await import('@/lib/actions/round-voters.action')
      const discovery = DiscoveryService.fromEnv()
      const pools = await discovery.listPools({ hubId: internalHubId, viewerAgentId: myAgent })
      const pool = pools.find(p => (p.treasuryAddress ?? '').toLowerCase() === (body.poolAgentId ?? '').toLowerCase())
      if (pool) {
        const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'
        const orgAddr = ((pool.stewardshipAgent ?? '').startsWith(AGENT_IRI_PREFIX)
          ? pool.stewardshipAgent!.slice(AGENT_IRI_PREFIX.length)
          : (pool.stewardshipAgent ?? '')) as `0x${string}`
        if (orgAddr) {
          const members = await listOrgMembersOnChain(orgAddr)
          let issued = 0
          for (const memberAgent of members) {
            try {
              const r = await addRoundVoter({ roundId: body.id, voterSmartAccount: memberAgent })
              if (r.ok) issued++
              else console.warn('[round-create] cred-issue failed for', memberAgent, r.error)
            } catch (err) {
              console.warn('[round-create] cred-issue threw for', memberAgent, err)
            }
          }
          console.log(`[round-create] auto-issued ${issued}/${members.length} voter creds for round ${body.id}`)
        }
      }
    } catch (err) {
      console.warn('[round-create] batch-issue failed (non-fatal):', err)
    }

    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
