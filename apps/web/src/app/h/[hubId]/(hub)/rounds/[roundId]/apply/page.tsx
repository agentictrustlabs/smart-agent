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
import { and, eq } from 'drizzle-orm'
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
  expressedByAgent: string,
): Promise<ViewerIntentOption[]> {
  let rows: Array<{
    id: string
    title: string
    intentType: string | null
    object: string | null
    status: string
  }> = []
  try {
    rows = await db
      .select({
        id: schema.intents.id,
        title: schema.intents.title,
        intentType: schema.intents.intentType,
        object: schema.intents.object,
        status: schema.intents.status,
      })
      .from(schema.intents)
      .where(and(
        eq(schema.intents.hubId, hubId),
        eq(schema.intents.expressedByAgent, expressedByAgent.toLowerCase()),
      ))
  } catch {
    return []
  }
  return rows
    .filter((r) => r.status === 'expressed' || r.status === 'acknowledged')
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

  return (
    <ProposalComposer
      hubSlug={slug}
      roundId={roundId}
      proposerAgentId={myAgent}
      round={{
        deadline: round.deadline,
        decisionDate: round.decisionDate,
        budgetCeiling: round.mandate.budgetCeiling,
        acceptedKinds: round.mandate.acceptedKinds ?? [],
        milestoneMin: round.milestoneTemplate.minMilestones,
        milestoneMax: round.milestoneTemplate.maxMilestones,
      }}
      viewerIntents={viewerIntents}
    />
  )
}
