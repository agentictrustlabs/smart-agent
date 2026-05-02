/**
 * GovernanceWorkspace — Credential / Organization / Church engagements.
 *
 * Hero: PolicyPanel + signer roster. Commitment Thread stays as primary
 * audit tab (governance is audit-heavy by design). The 8-stop ribbon
 * remains visible — auditors need it.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 Governance, §4 column.
 */

import { getPolicy } from '@/lib/actions/engagements/policy.action'
import { CommitmentThread } from '@/components/engagements/CommitmentThread'
import { ThreadMessageComposer } from '@/components/engagements/ThreadMessageComposer'
import { DeterminationPanel } from '@/components/engagements/DeterminationPanel'
import { EvidencePinPanel } from '@/components/engagements/EvidencePinPanel'
import { PhaseRibbon } from '@/components/engagements/PhaseRibbon'
import { AgreementCard } from '@/components/engagements/AgreementCard'
import { EntitlementStatusActions } from '@/app/h/[hubId]/(hub)/entitlements/[id]/EntitlementStatusActions'
import { NextStepCard } from '@/components/engagements/NextStepCard'
import { PolicyPanel } from './governance/PolicyPanel'
import type { EngagementWorkspaceProps } from './types'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  headerBg: '#fdfcf8',
}

export async function GovernanceWorkspace(props: EngagementWorkspaceProps) {
  const {
    detail, threadEntries, hubSlug, hubName,
    myAgent, role, holderName, providerName,
    holderParty, providerParty,
    topic, icon, resourceLeaf,
    nextStep, phaseDerivation,
  } = props

  const policy = await getPolicy(detail.id)
  const isParty = role === 'holder' || role === 'provider'

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* Compact header */}
      <div style={{
        background: C.headerBg, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: '0.85rem 1.1rem', marginBottom: '1rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {hubName} · Governance engagement
        </div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>{icon}</span>
          {topic}
        </h1>
        <div style={{ fontSize: '0.78rem', color: C.textMuted }}>
          {role === 'holder' ? `Issued by ${providerName}` : role === 'provider' ? `Subject: ${holderName}` : `${holderName} ⇄ ${providerName}`}
        </div>
      </div>

      {/* Action prompt */}
      <NextStepCard step={nextStep} />

      {/* Hero — PolicyPanel */}
      {policy && (
        <PolicyPanel
          policy={policy}
          engagementId={detail.id}
          myAgent={myAgent}
          agentNameByAddress={{
            [detail.holderAgent]: holderName,
            [detail.providerAgent]: providerName,
          }}
        />
      )}

      {/* Phase ribbon — governance keeps the full ribbon visible (auditors need it). */}
      <PhaseRibbon derivation={phaseDerivation} />

      {/* Commitment Thread — primary tab in this shape */}
      <section id="thread" style={{ marginBottom: '1rem', scrollMarginTop: '1rem' }}>
        <h3 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', marginTop: 0 }}>
          Commitment thread ({threadEntries.length})
        </h3>
        {isParty && (
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
          hubSlug={hubSlug}
        />
      </section>

      {/* Audit disclosure — full bilateral card + evidence + determination */}
      <details style={discStyle} open={policy?.currentState === 'approved'}>
        <summary style={summaryStyle}>Audit · evidence and final sign-off</summary>
        <div style={{ paddingTop: '0.6rem' }}>
          <AgreementCard
            hubSlug={hubSlug}
            topic={topic}
            icon={icon}
            resourceLeaf={resourceLeaf}
            cadence={detail.cadence}
            validFrom={detail.validFrom}
            validUntil={detail.validUntil}
            holder={holderParty}
            provider={providerParty}
            hubName={hubName}
          />

          <div id="determination" style={{ scrollMarginTop: '1rem' }} />
          {isParty && (
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

          <div id="pin-evidence" style={{ scrollMarginTop: '1rem' }} />
          {(isParty || (myAgent !== null && detail.witnessAgent === myAgent))
            && detail.recentActivities.length > 0
            && detail.status !== 'revoked'
            && detail.status !== 'expired'
            && !detail.assertionId && (
            <EvidencePinPanel
              engagementId={detail.id}
              activities={detail.recentActivities.map(a => ({
                id: a.id, title: a.title, activityType: a.activityType, activityDate: a.activityDate,
              }))}
              pinnedBundleHash={detail.evidenceBundleHash}
              pinnedAt={detail.evidencePinnedAt}
              witnessAgent={detail.witnessAgent}
              witnessSignedAt={detail.witnessSignedAt}
              isParty={isParty}
              isWitness={myAgent !== null && detail.witnessAgent === myAgent}
            />
          )}
        </div>
      </details>

      {isParty && (
        <EntitlementStatusActions entitlementId={detail.id} status={detail.status} />
      )}
    </div>
  )
}

const discStyle: React.CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: '0.85rem 1rem',
  marginBottom: '1rem',
}

const summaryStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  color: C.textMuted,
  cursor: 'pointer',
  listStyle: 'none',
}
