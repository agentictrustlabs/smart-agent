/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Proposal composer (T045).
 *
 * Server component that loads round + viewer's intents and renders the
 * <ProposalComposer /> client form. The composer POSTs to the sibling
 * `route.ts` (T046), which calls into `submitProposal(...)` and on
 * success redirects to /h/<hubId>/proposals/<id>.
 *
 * Sections:
 *   - Header (round name + deadline + decision date)
 *   - Underlying intent picker (proposer's expressed/acknowledged needs)
 *   - Budget (line items + computed total + ceiling-overage warning)
 *   - Plan (narrative + planArtifactRef URL)
 *   - Milestones (count vs round.milestoneTemplate hints)
 *   - DesiredOutcomes (statement + measurable + validators)
 *   - ReportingObligations (cadence + format)
 *   - OrganisationalBackground (narrative + priorTrackRecordRefs)
 *   - Open-call toggle (only when round.acceptsOpenCallsFromFund — v1 deferred)
 *   - Submit button (POSTs to ./apply)
 */

import { redirect, notFound } from 'next/navigation'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getRoundForViewer } from '@/lib/actions/rounds.action'
import { ProposalComposer } from './ProposalComposer'

export const dynamic = 'force-dynamic'

interface ViewerIntentOption {
  id: string
  title: string
  kind: string | null
}

async function loadViewerIntentOptions(
  hubId: string,
  viewerAgent: string,
): Promise<ViewerIntentOption[]> {
  // Include both:
  //   - intents the viewer expressed directly (expressedByAgent = me), AND
  //   - intents expressed on the viewer's behalf by an org they manage
  //     (payload.beneficiaryAgent = me)
  // The second case lets a user draft a proposal against a need their org
  // expressed for them.
  let rows: Array<{
    id: string
    title: string
    intentType: string | null
    object: string | null
    status: string
    payload: string | null
    expressedByAgent: string
  }> = []
  try {
    rows = await db
      .select({
        id: schema.intents.id,
        title: schema.intents.title,
        intentType: schema.intents.intentType,
        object: schema.intents.object,
        status: schema.intents.status,
        payload: schema.intents.payload,
        expressedByAgent: schema.intents.expressedByAgent,
      })
      .from(schema.intents)
      .where(eq(schema.intents.hubId, hubId))
  } catch {
    return []
  }
  const me = viewerAgent.toLowerCase()
  return rows
    .filter((r) => {
      if (r.status !== 'expressed' && r.status !== 'acknowledged') return false
      if (r.expressedByAgent.toLowerCase() === me) return true
      try {
        const p = JSON.parse(r.payload ?? '{}') as { beneficiaryAgent?: string }
        return typeof p.beneficiaryAgent === 'string' && p.beneficiaryAgent.toLowerCase() === me
      } catch {
        return false
      }
    })
    .map((r) => {
      const intentTypeBare = r.intentType?.split(':').pop() ?? null
      const objectBare = r.object?.split(':').pop() ?? null
      return {
        id: r.id,
        title: r.title,
        kind: intentTypeBare ?? objectBare,
      }
    })
}

export default async function RoundApplyPage({
  params,
}: {
  params: Promise<{ hubId: string; roundId: string }>
}) {
  const { hubId: slug, roundId } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#5c4a3a' }}>
          Sign-in required
        </h2>
        <p style={{ color: '#9a8c7e' }}>You need a person agent to draft a proposal.</p>
      </div>
    )
  }

  const { round } = await getRoundForViewer(roundId, myAgent)
  if (!round) {
    notFound()
  }

  const viewerIntents = await loadViewerIntentOptions(internalHubId, myAgent)

  // Deadline-passed gate.
  const deadlineMs = round.deadline ? new Date(round.deadline).getTime() : 0
  const closed = deadlineMs > 0 && deadlineMs < Date.now()
  if (closed) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#5c4a3a' }}>
          Round closed
        </h2>
        <p style={{ color: '#9a8c7e' }}>
          This round has passed its submission deadline ({round.deadline.slice(0, 10)}).
          Cloning a previously-submitted proposal as a fresh draft remains
          available from "your proposals".
        </p>
      </div>
    )
  }

  // Build a friendly description string from the mandate so the proposer
  // sees what kinds of work the round funds before drafting. Falls back
  // to the kinds list when no GraphDB-stored displayName is available.
  const kinds = round.mandate.acceptedKinds ?? []
  const geo = round.mandate.acceptedGeo ?? []
  const description = (() => {
    const kindsLabel = kinds.length > 0 ? kinds.join(', ') : 'all eligible kinds'
    const geoLabel = geo.length > 0 ? ` in ${geo.join(', ')}` : ''
    const award = round.mandate.budgetCeiling > 0
      ? ` · up to $${round.mandate.budgetCeiling.toLocaleString()} across ${round.mandate.expectedAwards} awards`
      : ''
    return `Accepts ${kindsLabel}${geoLabel}${award}.`
  })()

  return (
    <ProposalComposer
      hubSlug={slug}
      roundId={roundId}
      proposerAgentId={myAgent}
      round={{
        roundId,
        displayName: round.displayName ?? `Round ${roundId}`,
        description,
        fundName: round.fundName,
        deadline: round.deadline,
        decisionDate: round.decisionDate,
        budgetCeiling: round.mandate.budgetCeiling,
        acceptedKinds: kinds,
        milestoneMin: round.milestoneTemplate.minMilestones,
        milestoneMax: round.milestoneTemplate.maxMilestones,
      }}
      viewerIntents={viewerIntents}
    />
  )
}
