/**
 * /h/[hubId]/entitlements/[id] — engagement detail page.
 *
 * Now a thin router: data is loaded once here, then handed to the per-shape
 * Workspace component selected by `resolveShape()`.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §6 (R9)
 */

import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getEntitlement } from '@/lib/actions/entitlements.action'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { CAPACITY_UNIT_LABEL, type CapacityUnit } from '@/lib/discover/capacity-defaults'
import { type AgreementParty } from '@/components/engagements/AgreementCard'
import { derivePhase } from '@/components/engagements/PhaseRibbon'
import { deriveNextStep, type NextStepRole } from '@/components/engagements/next-step'
import { listThreadEntries, backfillThreadFromEngagement } from '@/lib/actions/engagements/thread.action'
import { resolveShape } from '@/lib/engagements/resolveShape'
import { EngagementShapeRouter, type EngagementWorkspaceProps } from '@/components/engagements/shapes'

export const dynamic = 'force-dynamic'

const TYPE_ICON: Record<string, string> = {
  'resourceType:Worker':       '👷',
  'resourceType:Skill':        '🎯',
  'resourceType:Money':        '💰',
  'resourceType:Prayer':       '🙏',
  'resourceType:Connector':    '🤝',
  'resourceType:Data':         '📊',
  'resourceType:Scripture':    '📖',
  'resourceType:Venue':        '🏠',
  'resourceType:Curriculum':   '📚',
  'resourceType:Church':       '⛪',
  'resourceType:Organization': '🏛️',
  'resourceType:Credential':   '🎓',
}

export default async function EntitlementDetailPage({ params }: {
  params: Promise<{ hubId: string; id: string }>
}) {
  const { hubId: slug, id } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const detail = await getEntitlement(id)
  if (!detail) notFound()
  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  const myLower = myAgent?.toLowerCase() ?? null

  const role: 'holder' | 'provider' | 'observer' =
    myLower === detail.holderAgent ? 'holder'
    : myLower === detail.providerAgent ? 'provider'
    : 'observer'

  // Look up both intent rows + both outcome rows for the bilateral card.
  const { db, schema } = await import('@/db')
  const { eq } = await import('drizzle-orm')
  const holderIntentRow = db.select().from(schema.intents)
    .where(eq(schema.intents.id, detail.holderIntentId)).get()
  const providerIntentRow = db.select().from(schema.intents)
    .where(eq(schema.intents.id, detail.providerIntentId)).get()
  const holderOutcomeRow = detail.holderOutcomeId
    ? db.select().from(schema.outcomes).where(eq(schema.outcomes.id, detail.holderOutcomeId)).get()
    : null
  const providerOutcomeRow = detail.providerOutcomeId
    ? db.select().from(schema.outcomes).where(eq(schema.outcomes.id, detail.providerOutcomeId)).get()
    : null

  const [holderMeta, providerMeta] = await Promise.all([
    getAgentMetadata(detail.holderAgent as `0x${string}`).catch(() => null),
    getAgentMetadata(detail.providerAgent as `0x${string}`).catch(() => null),
  ])
  const holderName = holderMeta?.displayName ?? `${detail.holderAgent.slice(0, 6)}…${detail.holderAgent.slice(-4)}`
  const providerName = providerMeta?.displayName ?? `${detail.providerAgent.slice(0, 6)}…${detail.providerAgent.slice(-4)}`

  const icon = TYPE_ICON[detail.terms.object] ?? '📦'
  const unitLabel = CAPACITY_UNIT_LABEL[detail.capacityUnit as CapacityUnit] ?? ''
  const pct = detail.capacityGranted > 0
    ? Math.round((detail.capacityRemaining / detail.capacityGranted) * 100)
    : 0
  const consumedPct = 100 - pct

  const holderParty: AgreementParty = {
    agentAddress: detail.holderAgent,
    displayName: holderName,
    isMe: role === 'holder',
    intentId: detail.holderIntentId,
    intentTitle: holderIntentRow?.title ?? 'their request',
    outcomeDescription: holderOutcomeRow?.description ?? null,
    outcomeStatus: holderOutcomeRow?.status ?? null,
    confirmedAt: detail.holderConfirmedAt,
  }
  const providerParty: AgreementParty = {
    agentAddress: detail.providerAgent,
    displayName: providerName,
    isMe: role === 'provider',
    intentId: detail.providerIntentId,
    intentTitle: providerIntentRow?.title ?? 'their offering',
    outcomeDescription: providerOutcomeRow?.description ?? null,
    outcomeStatus: providerOutcomeRow?.status ?? null,
    confirmedAt: detail.providerConfirmedAt,
  }

  // Backfill the Commitment Thread on first read for legacy engagements.
  await backfillThreadFromEngagement(detail.id)
  const threadEntries = await listThreadEntries(detail.id)

  const resourceLeaf = (detail.terms.object.split(':').pop() ?? detail.terms.object).replace(/^./, c => c.toUpperCase())
  const topic = detail.terms.topic ?? detail.terms.scope ?? resourceLeaf

  const isWitness = myLower !== null && detail.witnessAgent !== null && detail.witnessAgent.toLowerCase() === myLower
  const nextStepRole: NextStepRole = isWitness ? 'witness' : role
  const counterpartyName = role === 'holder' ? providerName
    : role === 'provider' ? holderName
    : holderName
  const myConfirmedAt = role === 'holder' ? detail.holderConfirmedAt
    : role === 'provider' ? detail.providerConfirmedAt
    : null
  const otherConfirmedAt = role === 'holder' ? detail.providerConfirmedAt
    : role === 'provider' ? detail.holderConfirmedAt
    : null
  const nextStep = deriveNextStep({
    ent: detail,
    role: nextStepRole,
    counterpartyName,
    topic,
    signals: {
      hasActivities: detail.recentActivities.length > 0,
      capacityFraction: detail.capacityGranted > 0 ? detail.capacityRemaining / detail.capacityGranted : 1,
      evidencePinned: !!detail.evidenceBundleHash,
      witnessNamed: !!detail.witnessAgent,
      witnessSigned: !!detail.witnessSignedAt,
      iConfirmed: !!myConfirmedAt,
      otherConfirmed: !!otherConfirmedAt,
      deposited: !!detail.assertionId,
    },
  })

  const phaseDerivation = derivePhase({
    status: detail.status,
    phase: detail.phase,
    capacityRemaining: detail.capacityRemaining,
    capacityGranted: detail.capacityGranted,
    holderConfirmedAt: detail.holderConfirmedAt,
    providerConfirmedAt: detail.providerConfirmedAt,
    evidencePinnedAt: detail.evidencePinnedAt,
    assertionId: detail.assertionId,
    hasWorkItems: detail.workItems.length > 0,
    hasActivities: detail.recentActivities.length > 0,
  })

  // First user-org address — needed by QuickActivityModal as the activity scope.
  const { getUserOrgs } = await import('@/lib/get-user-orgs')
  const userOrgs = await getUserOrgs(user.id)
  const firstOrgAddr = userOrgs[0]?.address ?? null

  // ── Resolve which Workspace shape renders ──────────────────────
  const resolvedShape = resolveShape({
    resourceType: detail.terms.object,
    cadence: detail.cadence,
    // Quiet mode opt-in: surfaced on the engagement terms (carried from the
    // offering at acceptMatch time). R14 — sensitive Worker (Rosa-style).
    quietMode: detail.terms.quietMode === true,
    // R16 — matching engagements short-circuit to the Matching shape.
    engagementKind: detail.engagementKind,
  })

  const workspaceProps: EngagementWorkspaceProps = {
    detail,
    threadEntries,
    resolvedShape,
    hubSlug: slug,
    hubName: profile.name,
    internalHubId,
    firstOrgAddr,
    myAgent: myLower,
    role,
    isWitness,
    holderParty,
    providerParty,
    holderName,
    providerName,
    holderOutcome: holderOutcomeRow ? {
      id: holderOutcomeRow.id,
      description: holderOutcomeRow.description,
      status: holderOutcomeRow.status,
    } : null,
    providerOutcome: providerOutcomeRow ? {
      id: providerOutcomeRow.id,
      description: providerOutcomeRow.description,
      status: providerOutcomeRow.status,
    } : null,
    topic,
    resourceLeaf,
    icon,
    unitLabel,
    consumedPct,
    nextStep,
    phaseDerivation,
  }

  return <EngagementShapeRouter {...workspaceProps} />
}
