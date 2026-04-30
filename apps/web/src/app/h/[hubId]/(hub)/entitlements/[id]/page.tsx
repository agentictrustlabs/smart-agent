import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getEntitlement } from '@/lib/actions/entitlements.action'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { CAPACITY_UNIT_LABEL, type CapacityUnit } from '@/lib/discover/capacity-defaults'
import { LogFulfillmentForEntitlementButton } from './LogFulfillmentForEntitlementButton'
import { EntitlementStatusActions } from './EntitlementStatusActions'
import { AgreementCard, type AgreementParty } from '@/components/engagements/AgreementCard'
import { PhaseRibbon, derivePhase } from '@/components/engagements/PhaseRibbon'
import { CommitmentThread } from '@/components/engagements/CommitmentThread'
import { ThreadMessageComposer } from '@/components/engagements/ThreadMessageComposer'
import { EvidencePinPanel } from '@/components/engagements/EvidencePinPanel'
import { DeterminationPanel } from '@/components/engagements/DeterminationPanel'
import { NextStepCard } from '@/components/engagements/NextStepCard'
import { deriveNextStep, type NextStepRole } from '@/components/engagements/next-step'
import { listThreadEntries, backfillThreadFromEngagement } from '@/lib/actions/engagements/thread.action'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  card: '#ffffff', border: '#ece6db', accentLight: 'rgba(139,94,60,0.10)',
}

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

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  granted:    { bg: '#e0e7ff', fg: '#3730a3' },
  active:     { bg: '#dcfce7', fg: '#166534' },
  paused:     { bg: '#fef3c7', fg: '#92400e' },
  suspended:  { bg: '#fee2e2', fg: '#991b1b' },
  fulfilled:  { bg: '#dcfce7', fg: '#166534' },
  revoked:    { bg: '#f3f4f6', fg: '#6b7280' },
  expired:    { bg: '#f3f4f6', fg: '#6b7280' },
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

  const role = myLower === detail.holderAgent ? 'holder'
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

  // Display names for both parties.
  const [holderMeta, providerMeta] = await Promise.all([
    getAgentMetadata(detail.holderAgent as `0x${string}`).catch(() => null),
    getAgentMetadata(detail.providerAgent as `0x${string}`).catch(() => null),
  ])
  const holderName = holderMeta?.displayName ?? `${detail.holderAgent.slice(0, 6)}…${detail.holderAgent.slice(-4)}`
  const providerName = providerMeta?.displayName ?? `${detail.providerAgent.slice(0, 6)}…${detail.providerAgent.slice(-4)}`

  const status = STATUS_COLORS[detail.status] ?? STATUS_COLORS.granted
  const icon = TYPE_ICON[detail.terms.object] ?? '📦'
  const unitLabel = CAPACITY_UNIT_LABEL[detail.capacityUnit as CapacityUnit] ?? ''
  const pct = detail.capacityGranted > 0
    ? Math.round((detail.capacityRemaining / detail.capacityGranted) * 100)
    : 0
  const consumedPct = 100 - pct

  const openItems = detail.workItems.filter(w => w.status === 'open' || w.status === 'in-progress')
  const doneItems = detail.workItems.filter(w => w.status === 'done')

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

  // Derive the action-oriented "next step" prompt from engagement state.
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

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* PRIMARY CTA — what does this user need to do, in plain language? */}
      <NextStepCard step={nextStep} />

      {/* 8-stop round-trip phase ribbon — wayfinding for the engagement. */}
      <PhaseRibbon derivation={phaseDerivation} />

      {/* Bilateral split-pane workspace header. */}
      <AgreementCard
        hubSlug={slug}
        topic={topic}
        icon={icon}
        resourceLeaf={resourceLeaf}
        cadence={detail.cadence}
        validFrom={detail.validFrom}
        validUntil={detail.validUntil}
        holder={holderParty}
        provider={providerParty}
        hubName={profile.name}
      />

      {/* Status pill + role badge — supplementary chrome below the bilateral card. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: 999, background: status.bg, color: status.fg, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {detail.status}
        </span>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: 999, background: '#fafaf6', color: C.text, border: `1px solid ${C.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {role === 'holder' ? '📥 you receive' : role === 'provider' ? '📤 you provide' : '👁️ observing'}
        </span>
      </div>

      {/* Capacity card (single, full-width) — outcome lives on the AgreementCard now. */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
          Capacity
        </div>
        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: C.accent }}>
          {detail.capacityRemaining}
          <span style={{ fontSize: '0.85rem', color: C.textMuted, fontWeight: 600 }}>{unitLabel ? ` ${unitLabel}` : ''} remaining</span>
        </div>
        <div style={{ fontSize: '0.78rem', color: C.textMuted, marginTop: '0.25rem' }}>
          of {detail.capacityGranted}{unitLabel ? ` ${unitLabel}` : ''} granted · {detail.cadence} cadence
        </div>
        <div style={{ height: 8, background: '#fafaf6', borderRadius: 999, marginTop: '0.6rem', overflow: 'hidden' }}>
          <div style={{ width: `${consumedPct}%`, height: '100%', background: consumedPct < 50 ? '#10b981' : consumedPct < 80 ? '#f59e0b' : '#ef4444' }} />
        </div>
        <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.3rem' }}>
          {consumedPct}% consumed
        </div>
      </div>

      {/* Work items + log-activity surface */}
      <section id="log-activity" style={{ marginBottom: '1rem', scrollMarginTop: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Work items ({openItems.length} open · {doneItems.length} done)
          </h2>
          {(role === 'holder' || role === 'provider') && firstOrgAddr && detail.status !== 'fulfilled' && detail.status !== 'revoked' && detail.status !== 'expired' && (
            <LogFulfillmentForEntitlementButton
              entitlementId={detail.id}
              entitlementTitle={detail.terms.topic ?? 'this engagement'}
              orgAddress={firstOrgAddr}
              hubId={internalHubId}
            />
          )}
        </div>
        {openItems.length === 0 && doneItems.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: C.textMuted, padding: '0.8rem 1rem', background: C.card, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            No work items yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {openItems.map(w => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.55rem 0.85rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {w.taskKind.split(':').pop()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text }}>{w.title}</div>
                  {w.detail && <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>{w.detail}</div>}
                </div>
                <span style={{ fontSize: '0.7rem', color: C.textMuted, flexShrink: 0 }}>
                  {w.dueAt ? `due ${new Date(w.dueAt).toLocaleDateString()}` : 'no date'}
                </span>
              </div>
            ))}
            {doneItems.length > 0 && (
              <details style={{ marginTop: '0.4rem' }}>
                <summary style={{ fontSize: '0.72rem', color: C.textMuted, cursor: 'pointer' }}>{doneItems.length} resolved item{doneItems.length === 1 ? '' : 's'}</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.4rem' }}>
                  {doneItems.map(w => (
                    <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.65rem', background: '#fafaf6', border: `1px solid ${C.border}`, borderRadius: 8, opacity: 0.75 }}>
                      <span style={{ fontSize: '0.7rem' }}>✓</span>
                      <span style={{ fontSize: '0.78rem', color: C.text, textDecoration: 'line-through' }}>{w.title}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* Stage 7 — Determination. Always visible to parties when not deposited.
          Mutual sign-off; deposit fires once both parties confirm. */}
      <div id="determination" style={{ scrollMarginTop: '1rem' }} />
      {(role === 'holder' || role === 'provider') && (
        <DeterminationPanel
          engagementId={detail.id}
          role={role}
          holderName={holderName}
          providerName={providerName}
          holderConfirmedAt={detail.holderConfirmedAt}
          providerConfirmedAt={detail.providerConfirmedAt}
          evidencePinned={!!detail.evidenceBundleHash}
          witnessAgent={detail.witnessAgent}
          witnessSignedAt={detail.witnessSignedAt}
          alreadyDeposited={!!detail.assertionId}
        />
      )}

      {/* Stage 6 — Provenance Capture. Visible once activities exist; hidden again once
          deposit is minted. Either party can pin; witness can sign after. */}
      <div id="pin-evidence" style={{ scrollMarginTop: '1rem' }} />
      {(role === 'holder' || role === 'provider' || (myLower !== null && detail.witnessAgent === myLower))
        && detail.recentActivities.length > 0
        && detail.status !== 'revoked'
        && detail.status !== 'expired'
        && !detail.assertionId && (
        <EvidencePinPanel
          engagementId={detail.id}
          activities={detail.recentActivities.map(a => ({
            id: a.id,
            title: a.title,
            activityType: a.activityType,
            activityDate: a.activityDate,
          }))}
          pinnedBundleHash={detail.evidenceBundleHash}
          pinnedAt={detail.evidencePinnedAt}
          witnessAgent={detail.witnessAgent}
          witnessSignedAt={detail.witnessSignedAt}
          isParty={role === 'holder' || role === 'provider'}
          isWitness={myLower !== null && detail.witnessAgent === myLower}
        />
      )}

      {/* Commitment Thread — the persistent typed backbone of the engagement. */}
      <section id="thread" style={{ marginBottom: '1rem', scrollMarginTop: '1rem' }}>
        <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
          Commitment thread ({threadEntries.length})
        </h2>
        {(role === 'holder' || role === 'provider') && (
          <div style={{ marginBottom: '0.6rem' }}>
            <ThreadMessageComposer engagementId={detail.id} />
          </div>
        )}
        <CommitmentThread
          entries={threadEntries}
          agentNameByAddress={{
            [detail.holderAgent]: holderName,
            [detail.providerAgent]: providerName,
          }}
          hubSlug={slug}
        />
      </section>

      {/* Status actions (holder / provider only) */}
      {(role === 'holder' || role === 'provider') && (
        <EntitlementStatusActions entitlementId={detail.id} status={detail.status} />
      )}
    </div>
  )
}

