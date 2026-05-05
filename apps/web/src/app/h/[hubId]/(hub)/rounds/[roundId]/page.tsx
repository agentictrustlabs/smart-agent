/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Round detail (T036).
 *
 * Server component. The "informed effort decision" surface
 * (FR-005 / FR-006 / FR-007). Composes:
 *   - Header (mandate narrative + accepted kinds + fund label)
 *   - <EligibilityBlock />        — geo / org / required credentials
 *   - Budget envelope             — ceiling, expected awards, tranche hints
 *   - Milestone template          — count bounds + tranche template
 *   - Validator requirements      — min count, accepted kinds
 *   - Reporting cadence
 *   - Deadline + decision date    — relative + absolute
 *   - <PriorStatsBlock />         — prior-cycle stats / first-cycle empty
 *   - Apply CTA                   — link to [roundId]/apply (US3)
 *
 * Visibility:
 *   - Public rounds render to anyone in the hub.
 *   - Private rounds: getRoundForViewer returns null when the viewer is
 *     not in the addressed-applicants list. The page renders the
 *     same friendly "not authorized" surface as a 404.
 *
 * Credential ownership is a v1 placeholder: an empty
 * `viewerCredentialKinds` array is passed down so EligibilityBlock
 * renders the "✗ <Kind> — obtain via …" guidance for every required
 * credential. Wiring the AnonCreds verifier helper is left for a
 * follow-up (Research R4) — the component already accepts the array.
 */

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getRoundForViewer } from '@/lib/actions/rounds.action'
import { EligibilityBlock } from '../(components)/EligibilityBlock'
import { PriorStatsBlock } from '../(components)/PriorStatsBlock'
import type { ReportingCadence } from '@smart-agent/sdk'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  privateFg: '#991b1b',
}

const REPORTING_LABEL: Record<ReportingCadence, string> = {
  quarterly: 'Quarterly',
  milestone: 'At each milestone',
  annual: 'Annual',
  none: 'None required',
}

function formatBudget(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n}`
}

function formatDate(iso: string): { rel: string; abs: string; isPast: boolean } {
  if (!iso) return { rel: '—', abs: '', isPast: false }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { rel: '—', abs: iso, isPast: false }
  const ms = d.getTime() - Date.now()
  const days = Math.round(ms / (1000 * 60 * 60 * 24))
  const abs = d.toISOString().slice(0, 10)
  if (ms < 0) return { rel: 'closed', abs, isPast: true }
  if (days === 0) return { rel: 'today', abs, isPast: false }
  if (days === 1) return { rel: 'tomorrow', abs, isPast: false }
  if (days <= 90) return { rel: `in ${days}d`, abs, isPast: false }
  return { rel: abs, abs, isPast: false }
}

export default async function RoundDetailPage({
  params,
}: {
  params: Promise<{ hubId: string; roundId: string }>
}) {
  const { hubId: slug, roundId } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return <NotAuthorizedSurface hubSlug={slug} reason="no-agent" />
  }

  const { round } = await getRoundForViewer(roundId, myAgent)
  if (!round) {
    return <NotAuthorizedSurface hubSlug={slug} reason="not-found-or-private" />
  }

  const deadline = formatDate(round.deadline)
  const decision = formatDate(round.decisionDate)
  const fundLabel = round.fundAgentId
    ? `${round.fundAgentId.slice(0, 6)}…${round.fundAgentId.slice(-4)}`
    : 'Unknown fund'
  const mandateNarrative = (round.mandate.acceptedKinds ?? []).slice(0, 3).join(', ') || 'Open mandate'
  const tranches = round.milestoneTemplate.trancheHints
  const canApply = !deadline.isPast

  // v1 placeholder for credential ownership. The AnonCreds verifier
  // helper (`userHoldsCredential`) is not yet wired — when it lands,
  // populate this array.
  const viewerCredentialKinds: string[] = []

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Round
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          {mandateNarrative}
        </h1>
        <div style={{ fontSize: '0.78rem', color: C.textMuted, display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Operated by {fundLabel}</span>
          {round.visibility === 'private' && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, color: C.privateFg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Private
            </span>
          )}
          {deadline.isPast && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999, background: '#f3f4f6', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Closed
            </span>
          )}
        </div>
      </div>

      {/* Mandate */}
      <Section title="Mandate">
        <div style={{ fontSize: '0.85rem', color: C.text, lineHeight: 1.5 }}>
          Accepts <strong>{(round.mandate.acceptedKinds ?? []).join(', ') || 'any kind'}</strong>
          {round.mandate.acceptedGeo?.length > 0 && (
            <> in <strong>{round.mandate.acceptedGeo.join(', ')}</strong></>
          )}
          .
        </div>
      </Section>

      {/* Eligibility */}
      <EligibilityBlock round={round} viewerCredentialKinds={viewerCredentialKinds} />

      {/* Budget envelope */}
      <Section title="Budget envelope">
        <Row label="Ceiling">{formatBudget(round.mandate.budgetCeiling)}</Row>
        {round.mandate.expectedAwards > 0 && (
          <Row label="Expected awards">{round.mandate.expectedAwards}</Row>
        )}
        {tranches && (tranches.atKickoff !== undefined || tranches.midpoint !== undefined || tranches.completion !== undefined) && (
          <Row label="Tranche template">
            {[
              tranches.atKickoff !== undefined ? `${tranches.atKickoff}% at kickoff` : null,
              tranches.midpoint !== undefined ? `${tranches.midpoint}% at midpoint` : null,
              tranches.completion !== undefined ? `${tranches.completion}% at completion` : null,
            ].filter(Boolean).join(' · ')}
          </Row>
        )}
      </Section>

      {/* Milestone template */}
      {(round.milestoneTemplate.minMilestones !== undefined || round.milestoneTemplate.maxMilestones !== undefined) && (
        <Section title="Milestone template">
          <Row label="Count">
            {round.milestoneTemplate.minMilestones !== undefined && round.milestoneTemplate.maxMilestones !== undefined
              ? `${round.milestoneTemplate.minMilestones}–${round.milestoneTemplate.maxMilestones} milestones`
              : round.milestoneTemplate.minMilestones !== undefined
              ? `at least ${round.milestoneTemplate.minMilestones}`
              : `at most ${round.milestoneTemplate.maxMilestones}`}
          </Row>
        </Section>
      )}

      {/* Validator requirements */}
      {(round.validatorRequirements.minValidators !== undefined ||
        (round.validatorRequirements.acceptedValidatorKinds?.length ?? 0) > 0) && (
        <Section title="Validator requirements">
          {round.validatorRequirements.minValidators !== undefined && (
            <Row label="Minimum">{round.validatorRequirements.minValidators}</Row>
          )}
          {(round.validatorRequirements.acceptedValidatorKinds?.length ?? 0) > 0 && (
            <Row label="Accepted kinds">
              {(round.validatorRequirements.acceptedValidatorKinds ?? []).join(', ')}
            </Row>
          )}
        </Section>
      )}

      {/* Reporting cadence */}
      <Section title="Reporting">
        <Row label="Cadence">{REPORTING_LABEL[round.reportingCadence]}</Row>
      </Section>

      {/* Deadline + decision date */}
      <Section title="Schedule">
        <Row label="Submission deadline">
          <span style={{ fontWeight: 600 }}>{deadline.rel}</span>
          {deadline.abs && deadline.rel !== deadline.abs && (
            <span style={{ color: C.textMuted, marginLeft: '0.4rem' }}>· {deadline.abs}</span>
          )}
        </Row>
        <Row label="Decision date">
          <span style={{ fontWeight: 600 }}>{decision.rel}</span>
          {decision.abs && decision.rel !== decision.abs && (
            <span style={{ color: C.textMuted, marginLeft: '0.4rem' }}>· {decision.abs}</span>
          )}
        </Row>
      </Section>

      {/* Prior stats */}
      <PriorStatsBlock stats={round.priorStats} />

      {/* Apply CTA */}
      <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        {canApply ? (
          <Link
            href={`/h/${slug}/rounds/${roundId}/apply`}
            style={{
              padding: '0.65rem 1.1rem',
              background: C.accent,
              color: '#fff',
              borderRadius: 10,
              fontSize: '0.9rem',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Draft a proposal →
          </Link>
        ) : (
          <span style={{ fontSize: '0.85rem', color: C.textMuted, padding: '0.65rem 1.1rem', fontStyle: 'italic' }}>
            This round is closed for new submissions.
          </span>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.95rem 1rem',
        marginBottom: '0.85rem',
      }}
    >
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.85rem', marginBottom: '0.4rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
      <div style={{ flex: '0 0 130px', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: C.text }}>
        {children}
      </div>
    </div>
  )
}

function NotAuthorizedSurface({ hubSlug, reason }: { hubSlug: string; reason: 'no-agent' | 'not-found-or-private' }) {
  const title = reason === 'no-agent' ? 'Sign in required' : 'Round not available'
  const body = reason === 'no-agent'
    ? 'This page needs a person agent.'
    : 'This round either does not exist or is private and not addressed to you.'
  return (
    <div style={{ padding: '2rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>{title}</h2>
      <p style={{ fontSize: '0.85rem', color: C.textMuted, marginBottom: '0.85rem' }}>{body}</p>
      <Link
        href={`/h/${hubSlug}/rounds`}
        style={{
          display: 'inline-block',
          padding: '0.5rem 0.9rem',
          background: C.accent,
          color: '#fff',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: '0.85rem',
          textDecoration: 'none',
        }}
      >
        Back to rounds
      </Link>
    </div>
  )
}
