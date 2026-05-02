/**
 * CadenceWorkspace — primary workspace for recurring-session engagements.
 *
 * Structure:
 *   1. Compact bilateral header (one line)
 *   2. NextStepCard (the action prompt, in plain language)
 *   3. SessionTimeline — past + next + log-session button (the hero)
 *   4. CloseoutBanner — only when capacity ≤ 25% or validUntil within 30d
 *   5. <details> "Journey" — PhaseRibbon, AgreementCard split-pane, status pill, role badge
 *   6. <details> "Records" — Commitment Thread, EvidencePin, Determination
 *   7. EntitlementStatusActions (pause/resume/revoke) at the bottom
 *
 * Subtype-aware: Prayer is quiet by default (no notes, no thread composer);
 * Curriculum auto-suggests close-out on last session; sensitive Worker
 * (Rosa-style) hides notes per-session.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 Cadence
 */

import Link from 'next/link'
import { listSessionsForEngagement } from '@/lib/actions/engagements/sessions.action'
import { LogFulfillmentForEntitlementButton } from '@/app/h/[hubId]/(hub)/entitlements/[id]/LogFulfillmentForEntitlementButton'
import { EntitlementStatusActions } from '@/app/h/[hubId]/(hub)/entitlements/[id]/EntitlementStatusActions'
import { AgreementCard } from '@/components/engagements/AgreementCard'
import { PhaseRibbon } from '@/components/engagements/PhaseRibbon'
import { CommitmentThread } from '@/components/engagements/CommitmentThread'
import { ThreadMessageComposer } from '@/components/engagements/ThreadMessageComposer'
import { EvidencePinPanel } from '@/components/engagements/EvidencePinPanel'
import { DeterminationPanel } from '@/components/engagements/DeterminationPanel'
import { NextStepCard } from '@/components/engagements/NextStepCard'
import { SessionTimeline } from './cadence/SessionTimeline'
import type { EngagementWorkspaceProps } from './types'

const C = {
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  card: '#ffffff', border: '#ece6db',
  closeBg: '#fef3c7', closeBorder: '#fcd34d', closeFg: '#92400e',
  headerBg: '#fdfcf8',
}

const NOUN_BY_SUBTYPE: Record<string, { noun: string; verb: string }> = {
  prayer:             { noun: 'prayer time', verb: 'Commit to next prayer time' },
  curriculum:         { noun: 'class',       verb: 'Schedule next class' },
  'sensitive-worker': { noun: 'care visit',  verb: 'Schedule next visit' },
  'sister-network':   { noun: 'session',     verb: 'Schedule next session' },
  standard:           { noun: 'session',     verb: 'Schedule next session' },
}

export async function CadenceWorkspace(props: EngagementWorkspaceProps) {
  const {
    detail, threadEntries, hubSlug, hubName, internalHubId, firstOrgAddr,
    myAgent, role, holderParty, providerParty, holderName, providerName,
    topic, resourceLeaf, icon,
    nextStep, phaseDerivation, resolvedShape,
  } = props

  const subtype = resolvedShape.subtype ?? 'standard'
  const { noun, verb } = NOUN_BY_SUBTYPE[subtype] ?? NOUN_BY_SUBTYPE.standard
  const hideNotes = resolvedShape.quiet || subtype === 'sensitive-worker'

  const counterpartyName = role === 'holder' ? providerName : holderName
  const sessionView = await listSessionsForEngagement(detail.id)

  // Closeout banner triggers when capacity is mostly consumed OR within 30
  // days of validUntil — Curriculum subtype shows it eagerly on last session.
  const capacityFraction = detail.capacityGranted > 0
    ? detail.capacityRemaining / detail.capacityGranted : 1
  const within30d = !!detail.validUntil
    && new Date(detail.validUntil).getTime() - Date.now() < 30 * 86_400_000
  const isCurriculumLastClass = subtype === 'curriculum' && capacityFraction <= 0
  const showCloseout = !detail.assertionId
    && (capacityFraction <= 0.25 || within30d || isCurriculumLastClass)

  const isParty = role === 'holder' || role === 'provider'

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* 1. Compact bilateral header */}
      <CadenceHeader
        topic={topic}
        icon={icon}
        hubName={hubName}
        hubSlug={hubSlug}
        holderName={holderName}
        providerName={providerName}
        role={role}
        cadenceLabel={detail.cadence}
        sessionsLeft={detail.capacityRemaining}
        sessionsTotal={detail.capacityGranted}
        sessionNoun={noun}
        validUntil={detail.validUntil}
        subtype={subtype}
        quiet={resolvedShape.quiet}
      />

      {/* 2. NextStepCard — plain-language action prompt */}
      <NextStepCard step={nextStep} />

      {/* 3. SessionTimeline — primary surface */}
      <SessionTimeline
        view={sessionView}
        engagementId={detail.id}
        orgAddress={firstOrgAddr}
        isParty={isParty}
        topic={topic}
        counterpartyName={counterpartyName}
        capacityRemaining={detail.capacityRemaining}
        capacityGranted={detail.capacityGranted}
        cadenceLabel={detail.cadence}
        sessionNoun={noun}
        sessionVerb={verb}
        hideNotes={hideNotes}
      />

      {/* 4. Closeout banner — surfaces only when nearing the end */}
      {showCloseout && (
        <CloseoutBanner
          capacityFraction={capacityFraction}
          isLastClass={isCurriculumLastClass}
          sessionNoun={noun}
        />
      )}

      {/* 5. Journey disclosure — PhaseRibbon + AgreementCard split-pane + chrome */}
      <details style={discStyle}>
        <summary style={summaryStyle}>How this engagement is going · audit view</summary>
        <div style={{ paddingTop: '0.6rem' }}>
          <PhaseRibbon derivation={phaseDerivation} />
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
        </div>
      </details>

      {/* 6. Records disclosure — thread, evidence, determination */}
      <details
        id="records"
        style={discStyle}
        // Auto-open at closeout time so users land here on "Wrap up".
        open={showCloseout}
      >
        <summary style={summaryStyle}>
          {showCloseout ? 'Wrap up · sign-off and trust deposit' : 'Records · evidence and sign-off'}
        </summary>
        <div style={{ paddingTop: '0.6rem' }}>
          {/* Determination panel (Stage 7) */}
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

          {/* Evidence pin (Stage 6) — hidden in quiet mode unless deposit-blocking */}
          {!resolvedShape.quiet && (
            <>
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
            </>
          )}

          {/* Commitment Thread — full record. Quiet mode hides composer. */}
          <section id="thread" style={{ marginBottom: '1rem', scrollMarginTop: '1rem' }}>
            <h3 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', marginTop: 0 }}>
              Commitment thread ({threadEntries.length})
            </h3>
            {isParty && !resolvedShape.quiet && (
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

          {/* Generic-activity log button stays available as a fallback. */}
          {isParty && firstOrgAddr && detail.status !== 'fulfilled'
            && detail.status !== 'revoked' && detail.status !== 'expired' && (
            <div style={{ marginBottom: '1rem' }}>
              <LogFulfillmentForEntitlementButton
                entitlementId={detail.id}
                entitlementTitle={detail.terms.topic ?? 'this engagement'}
                orgAddress={firstOrgAddr}
                hubId={internalHubId}
              />
            </div>
          )}
        </div>
      </details>

      {/* 7. Status actions */}
      {isParty && (
        <EntitlementStatusActions entitlementId={detail.id} status={detail.status} />
      )}

      {void Link}
    </div>
  )
}

// ─── Header ────────────────────────────────────────────────────────

function CadenceHeader({
  topic, icon, hubName, hubSlug,
  holderName, providerName, role,
  cadenceLabel, sessionsLeft, sessionsTotal, sessionNoun,
  validUntil, subtype, quiet,
}: {
  topic: string
  icon: string
  hubName: string
  hubSlug: string
  holderName: string
  providerName: string
  role: 'holder' | 'provider' | 'observer'
  cadenceLabel: string
  sessionsLeft: number
  sessionsTotal: number
  sessionNoun: string
  validUntil: string | null
  subtype: string
  quiet: boolean
}) {
  void hubSlug
  const subtypeChip = subtype === 'prayer' ? 'Prayer'
    : subtype === 'curriculum' ? 'Curriculum'
    : subtype === 'sensitive-worker' ? 'Quiet care'
    : null
  return (
    <div style={{
      background: C.headerBg,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: '0.85rem 1.1rem',
      marginBottom: '1rem',
    }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {hubName} · Engagement
      </div>
      <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.2rem' }}>{icon}</span>
        {topic}
      </h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.78rem', color: C.textMuted }}>
        <span style={{ color: C.text, fontWeight: 600 }}>
          {role === 'holder' ? `with ${providerName}` : role === 'provider' ? `with ${holderName}` : `${holderName} ⇄ ${providerName}`}
        </span>
        <span>·</span>
        <span>{sessionsLeft} of {sessionsTotal} {sessionNoun === 'prayer time' ? 'prayer slots' : `${sessionNoun}s`} left</span>
        <span>·</span>
        <span>{cadenceLabel}</span>
        {validUntil && (<>
          <span>·</span>
          <span>through {new Date(validUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
        </>)}
        {subtypeChip && (
          <span style={{
            marginLeft: 'auto',
            fontSize: '0.6rem', fontWeight: 700,
            padding: '0.18rem 0.5rem', borderRadius: 999,
            background: quiet ? '#f5f3ff' : '#eff6ff',
            color: quiet ? '#6d28d9' : '#1d4ed8',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>{subtypeChip}</span>
        )}
      </div>
    </div>
  )
}

// ─── Closeout banner ───────────────────────────────────────────────

function CloseoutBanner({
  capacityFraction,
  isLastClass,
  sessionNoun,
}: {
  capacityFraction: number
  isLastClass: boolean
  sessionNoun: string
}) {
  const headline = isLastClass
    ? 'Last class — time to wrap up the curriculum.'
    : capacityFraction <= 0
      ? `All ${sessionNoun}s logged — wrap this up.`
      : `Nearing the end — ${Math.round(capacityFraction * 100)}% of ${sessionNoun}s remain.`
  return (
    <div style={{
      background: C.closeBg,
      border: `1px solid ${C.closeBorder}`,
      borderRadius: 10,
      padding: '0.75rem 1rem',
      marginBottom: '1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
    }}>
      <span style={{ fontSize: '1.2rem' }}>🏁</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: C.closeFg }}>{headline}</div>
        <div style={{ fontSize: '0.72rem', color: C.closeFg, marginTop: '0.15rem' }}>
          Open <a href="#records" style={{ color: C.closeFg, fontWeight: 600 }}>Wrap up</a> below to pin evidence and confirm the outcome with the other party.
        </div>
      </div>
    </div>
  )
}

// ─── Disclosure styles ─────────────────────────────────────────────

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
