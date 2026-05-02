/**
 * TrancheWorkspace — Money engagement primary workspace.
 *
 * Hero is the TrancheSchedule (vertical timeline of disbursements).
 * Reports *are* the activities; no generic activity feed shown.
 * DeterminationPanel surfaces only on the final tranche.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 Tranche.
 */

import { summarizeTranches } from '@/lib/actions/engagements/tranches.action'
import { CommitmentThread } from '@/components/engagements/CommitmentThread'
import { ThreadMessageComposer } from '@/components/engagements/ThreadMessageComposer'
import { DeterminationPanel } from '@/components/engagements/DeterminationPanel'
import { EntitlementStatusActions } from '@/app/h/[hubId]/(hub)/entitlements/[id]/EntitlementStatusActions'
import { NextStepCard } from '@/components/engagements/NextStepCard'
import { TrancheSchedule } from './tranche/TrancheSchedule'
import type { EngagementWorkspaceProps } from './types'
import { deriveNextStep } from '@/components/engagements/next-step'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  headerBg: '#fdfcf8',
}

export async function TrancheWorkspace(props: EngagementWorkspaceProps) {
  const {
    detail, threadEntries, hubSlug, hubName,
    role, holderName, providerName,
    topic, icon,
  } = props

  const summary = await summarizeTranches(detail.id)
  const totalGrantDollars = detail.capacityGranted
  const isParty = role === 'holder' || role === 'provider'

  // Tailor the next-step prompt for tranche flow specifically — we override
  // the generic NextStep here because the per-tranche state matters.
  const nextStep = trancheNextStep({
    role,
    summary,
    topic,
    counterpartyName: role === 'holder' ? providerName : holderName,
    deposited: !!detail.assertionId,
    iConfirmed: role === 'holder' ? !!detail.holderConfirmedAt
      : role === 'provider' ? !!detail.providerConfirmedAt : false,
    otherConfirmed: role === 'holder' ? !!detail.providerConfirmedAt
      : role === 'provider' ? !!detail.holderConfirmedAt : false,
  }) ?? props.nextStep

  // Closing-out gate: surface DeterminationPanel once all tranches are released.
  const allReleased = summary.tranches.length > 0
    && summary.tranches.every(t => t.state === 'released' || t.state === 'held')

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* Compact header */}
      <div style={{
        background: C.headerBg, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: '0.85rem 1.1rem', marginBottom: '1rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {hubName} · Money engagement
        </div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>{icon}</span>
          {topic}
        </h1>
        <div style={{ fontSize: '0.78rem', color: C.textMuted }}>
          {role === 'holder' ? `Funded by ${providerName}` : role === 'provider' ? `Recipient: ${holderName}` : `${holderName} ⇄ ${providerName}`}
        </div>
      </div>

      {/* Action prompt */}
      <NextStepCard step={nextStep} />

      {/* Hero — TrancheSchedule */}
      <TrancheSchedule
        summary={summary}
        role={role}
        engagementId={detail.id}
        totalGrantDollars={totalGrantDollars}
        validUntil={detail.validUntil}
        reportPrompt={REPORT_PROMPT_DEFAULT}
        restrictionLabel={detail.terms.scope ?? detail.terms.topic ?? undefined}
      />

      {/* Closeout gate */}
      {allReleased && !detail.assertionId && isParty && (
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

      {/* Records — full thread (where reports live as messages) */}
      <details style={discStyle} open={allReleased}>
        <summary style={summaryStyle}>Records · reports &amp; full thread</summary>
        <div style={{ paddingTop: '0.6rem' }}>
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
        </div>
      </details>

      {isParty && (
        <EntitlementStatusActions entitlementId={detail.id} status={detail.status} />
      )}
    </div>
  )
}

// ─── Tranche-specific NextStep override ────────────────────────────

const REPORT_PROMPT_DEFAULT = 'Narrative — what happened, what was funded, what is next.'

function trancheNextStep(args: {
  role: 'holder' | 'provider' | 'observer'
  summary: ReturnType<typeof summarizeTranches> extends Promise<infer T> ? T : never
  topic: string
  counterpartyName: string
  deposited: boolean
  iConfirmed: boolean
  otherConfirmed: boolean
}): ReturnType<typeof deriveNextStep> | null {
  const { role, summary, counterpartyName, deposited, iConfirmed, otherConfirmed } = args

  if (deposited) {
    return {
      headline: 'Grant closed and on both profiles.',
      subline: `All ${summary.totalCount} tranches released and reports filed. Trust deposit minted.`,
      ctaLabel: null,
      tone: 'celebration',
    }
  }

  if (iConfirmed && otherConfirmed) {
    return {
      headline: 'Both confirmed — closing now.',
      subline: 'The trust deposit is being minted.',
      ctaLabel: null,
      tone: 'celebration',
    }
  }

  if (iConfirmed && !otherConfirmed) {
    return {
      headline: `Waiting on ${counterpartyName} to confirm.`,
      subline: 'Final tranche released. Both parties must confirm to close the grant.',
      ctaLabel: null,
      tone: 'waiting',
    }
  }

  const cur = summary.currentTranche
  if (!cur) {
    // All released, neither confirmed yet.
    return {
      headline: 'All tranches released — confirm to close.',
      subline: 'Both holder and provider confirm; the engagement closes and lands on each profile.',
      ctaLabel: 'Confirm',
      ctaAnchor: 'determination',
      tone: 'action',
    }
  }

  if (role === 'holder') {
    if (cur.state === 'report-due') {
      return {
        headline: `Report due for Tranche ${cur.idx}.`,
        subline: `Submit a short narrative + financial detail. Once accepted, ${counterpartyName} releases the next $${Math.round(cur.amountCents / 100).toLocaleString()}.`,
        ctaLabel: 'Submit report',
        tone: 'action',
      }
    }
    if (cur.state === 'reported') {
      return {
        headline: `${counterpartyName} is reviewing your Tranche ${cur.idx} report.`,
        subline: 'Funds release once they accept and sign off.',
        ctaLabel: null,
        tone: 'waiting',
      }
    }
    if (cur.state === 'scheduled' && cur.idx > 1) {
      return {
        headline: `${counterpartyName} hasn't requested a report yet for Tranche ${cur.idx}.`,
        subline: 'You can prepare in advance — keep your project notes current.',
        ctaLabel: null,
        tone: 'waiting',
      }
    }
    if (cur.state === 'scheduled' && cur.idx === 1) {
      return {
        headline: `Initial Tranche 1 — $${Math.round(cur.amountCents / 100).toLocaleString()} pending wire.`,
        subline: `${counterpartyName} will release this on the scheduled date.`,
        ctaLabel: null,
        tone: 'waiting',
      }
    }
  }

  if (role === 'provider') {
    if (cur.idx === 1 && cur.state === 'scheduled') {
      return {
        headline: `Release Tranche 1 — $${Math.round(cur.amountCents / 100).toLocaleString()} to ${counterpartyName}.`,
        subline: `Initial disbursement; no report required for the first tranche.`,
        ctaLabel: 'Release first tranche',
        tone: 'action',
      }
    }
    if (cur.state === 'reported') {
      return {
        headline: `Tranche ${cur.idx} report received from ${counterpartyName}.`,
        subline: `Review and release $${Math.round(cur.amountCents / 100).toLocaleString()} when you've signed off.`,
        ctaLabel: 'Release tranche',
        tone: 'action',
      }
    }
    if (cur.state === 'scheduled' && cur.idx > 1) {
      return {
        headline: `Time to request the Tranche ${cur.idx} report.`,
        subline: `${counterpartyName} will write a short narrative; you review then release.`,
        ctaLabel: 'Request report',
        tone: 'action',
      }
    }
    if (cur.state === 'report-due') {
      return {
        headline: `Awaiting report from ${counterpartyName} for Tranche ${cur.idx}.`,
        subline: 'Once received, review and release the next disbursement.',
        ctaLabel: null,
        tone: 'waiting',
      }
    }
  }

  return null
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
