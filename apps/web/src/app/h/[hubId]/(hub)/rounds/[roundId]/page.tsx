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
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getRoundForViewer } from '@/lib/actions/rounds.action'
import { EligibilityBlock } from '../(components)/EligibilityBlock'
import { PriorStatsBlock } from '../(components)/PriorStatsBlock'
import { CancelRoundButton } from './CancelRoundButton'
import { roundLifecycle, lifecyclePalette } from '@/lib/rounds/lifecycle'
import { resolveAgentLabel, stripAgentIri } from '@/lib/agent-label'
import type { ReportingCadence } from '@smart-agent/sdk'
import type { RoundProposalBrief } from '@/lib/actions/grantProposals.action'

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

  // proposalsReceived comes from a SPARQL binding that's never
  // written (the `sa:proposalsReceived` triple isn't emitted by the
  // kb-sync — proposals are private and never reach GraphDB). Read the
  // count directly from org-mcp so the "View N proposals" CTA is
  // accurate. Returns 0 silently on failure.
  const { getRoundProposalCount, listRoundProposalsBrief } = await import('@/lib/actions/grantProposals.action')
  const fullRoundId = roundId.startsWith('urn:smart-agent:round:')
    ? roundId
    : `urn:smart-agent:round:${roundId}`
  const [proposalsReceived, proposalBriefs] = await Promise.all([
    getRoundProposalCount(fullRoundId),
    listRoundProposalsBrief(fullRoundId),
  ])

  // Read the on-chain round status + voting window so the page reflects
  // the lifecycle phase (accepting / voting / reviewing / decided / closed
  // / canceled), not just whether the deadline passed.
  type RoundStatus = 'open' | 'review' | 'decided' | 'closed' | 'canceled'
  let roundStatus: RoundStatus = 'open'
  let votingWindowStartsAt: string | null = null
  let votingWindowEndsAt: string | null = null
  try {
    const { createPublicClient, http, keccak256, toHex } = await import('viem')
    const { foundry } = await import('viem/chains')
    const { fundRegistryAbi } = await import('@smart-agent/sdk')
    const fundRegistry = process.env.FUND_REGISTRY_ADDRESS as `0x${string}` | undefined
    if (fundRegistry) {
      const client = createPublicClient({
        chain: foundry,
        transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
      })
      const slug = fullRoundId.slice('urn:smart-agent:round:'.length)
      const subject = keccak256(toHex(`sa:round:${slug}`))
      const [statusHash, cfg] = await Promise.all([
        client.readContract({ address: fundRegistry, abi: fundRegistryAbi, functionName: 'getRoundStatus', args: [subject] }) as Promise<`0x${string}`>,
        client.readContract({ address: fundRegistry, abi: fundRegistryAbi, functionName: 'getRoundVotingConfig', args: [subject] }).catch(() => null) as Promise<readonly [`0x${string}`, bigint, bigint, bigint] | null>,
      ])
      const STATUS_MAP: Record<string, RoundStatus> = {
        [keccak256(toHex('sa:RoundOpen')).toLowerCase()]:     'open',
        [keccak256(toHex('sa:RoundReview')).toLowerCase()]:   'review',
        [keccak256(toHex('sa:RoundDecided')).toLowerCase()]:  'decided',
        [keccak256(toHex('sa:RoundClosed')).toLowerCase()]:   'closed',
        [keccak256(toHex('sa:RoundCanceled')).toLowerCase()]: 'canceled',
      }
      roundStatus = STATUS_MAP[statusHash.toLowerCase()] ?? 'open'
      if (cfg) {
        const [, , startsAt, endsAt] = cfg
        if (startsAt > 0n) votingWindowStartsAt = new Date(Number(startsAt) * 1000).toISOString()
        if (endsAt > 0n)   votingWindowEndsAt   = new Date(Number(endsAt) * 1000).toISOString()
      }
    }
  } catch (e) {
    console.warn('[round-detail] status read failed (defaulting to open):', (e as Error).message)
  }

  const deadline = formatDate(round.deadline)
  const decision = formatDate(round.decisionDate)
  const operatorLabel = (await resolveAgentLabel(round.fundAgentId, 'Unresolved operator')).label
  const poolAddress = stripAgentIri(round.poolAgentId)
  const poolLabel = round.poolName
    ? round.poolName
    : poolAddress
      ? (await resolveAgentLabel(poolAddress, 'Unresolved pool')).label
      : null
  const mandateNarrative = (round.mandate.acceptedKinds ?? []).slice(0, 3).join(', ') || 'Open mandate'
  const tranches = round.milestoneTemplate.trancheHints
  const canApply = !deadline.isPast && roundStatus === 'open'
  const submissionsClosedMessage =
    roundStatus === 'review'   ? 'Submissions closed — round is in voting/review.'
  : roundStatus === 'decided'  ? 'Round decided — awards committed.'
  : roundStatus === 'closed'   ? 'Round closed.'
  : roundStatus === 'canceled' ? 'Round canceled.'
  : deadline.isPast            ? 'This round is closed for new submissions.'
  : 'This round is closed for new submissions.'
  // Steward gate (Phase 2.5): pool root / lead steward sees the cancel
  // button. The discovery query returns fundAgentId as a full IRI
  // (https://smartagent.io/ontology/core#agent/0x...); canManageAgent
  // expects the bare address. Strip the prefix.
  const fundAddress = stripAgentIri(round.fundAgentId)
  const canCancel = await canManageAgent(myAgent, fundAddress)

  // v1 placeholder for credential ownership. The AnonCreds verifier
  // helper (`userHoldsCredential`) is not yet wired — when it lands,
  // populate this array.
  const viewerCredentialKinds: string[] = []

  const lifecycle = roundLifecycle({
    status: roundStatus,
    deadline: round.deadline,
    votingWindowStartsAt,
    votingWindowEndsAt,
  })
  const lifecyclePal = lifecyclePalette(lifecycle.phase)

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* ─── Above-the-fold hero card ─────────────────────────────────
          Answers in one viewport: what is this round, can I apply,
          by when, for how much, and what is the current status.
          The detail sections (mandate, eligibility, schedule, etc.)
          remain below for users who want the full picture.            */}
      <RoundHeroCard
        hubSlug={slug}
        roundId={roundId}
        profileName={profile.name}
        displayName={round.displayName}
        mandateNarrative={mandateNarrative}
        lifecycle={lifecycle}
        lifecyclePal={lifecyclePal}
        roundStatus={roundStatus}
        deadline={deadline}
        budgetCeiling={round.mandate.budgetCeiling}
        expectedAwards={round.mandate.expectedAwards}
        requiredCredentials={round.requiredCredentials}
        addressedApplicants={round.addressedApplicants}
        canApply={canApply}
        canCancel={canCancel}
        proposalsReceived={proposalsReceived}
        visibility={round.visibility}
        poolLabel={poolLabel}
        poolAddress={poolAddress}
        submissionsClosedMessage={submissionsClosedMessage}
        votingWindowStartsAt={votingWindowStartsAt}
      />

      {/* Operator lifecycle banner — surfaces the "Close submissions,
          open voting" transition that is otherwise buried in the
          Lifecycle tab on /admin. First-time operators have no other
          discovery path. */}
      {canCancel && roundStatus === 'open' && (
        <div
          role="status"
          style={{
            background: '#fef3c7',
            border: '1px solid #fde68a',
            color: '#92400e',
            borderRadius: 10,
            padding: '0.85rem 1rem',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.85rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>
              Ready to open voting?
            </div>
            <div style={{ fontSize: '0.78rem', marginTop: '0.2rem', color: '#a16207' }}>
              Submissions close when you open voting. Stewards can then cast their votes on
              {proposalsReceived > 0 ? ` the ${proposalsReceived} proposal${proposalsReceived === 1 ? '' : 's'}` : ' submitted proposals'}.
            </div>
          </div>
          <Link
            href={`/h/${slug}/rounds/${roundId}/admin`}
            style={{
              padding: '0.5rem 0.95rem',
              background: '#92400e',
              color: '#fff',
              borderRadius: 8,
              fontSize: '0.82rem',
              fontWeight: 700,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Close submissions, open voting →
          </Link>
        </div>
      )}

      {/* Mandate */}
      <Section title="Round criteria">
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

      {/* Inline proposal list — members navigate from here to vote. The
          full review surface ([roundId]/proposals) remains available via
          the Apply / Review CTA below. */}
      {proposalBriefs.length > 0 && (
        <Section title={`Proposals submitted (${proposalBriefs.length})`}>
          <ProposalList hubSlug={slug} proposals={proposalBriefs} />
        </Section>
      )}

      {/* Apply CTA + steward actions */}
      <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Everyone with access can browse the proposals list. Stewards
              additionally see Admin + Cancel controls. The link shows
              unconditionally so users always have a way into the
              proposals view, including the empty state. */}
          <Link
            href={`/h/${slug}/rounds/${roundId}/proposals`}
            style={{ padding: '0.55rem 0.95rem', background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.82rem', fontWeight: 600, textDecoration: 'none' }}
          >
            {proposalsReceived > 0
              ? `${canCancel ? 'Review' : 'View'} ${proposalsReceived} proposal${proposalsReceived === 1 ? '' : 's'} →`
              : 'View proposals (none yet) →'}
          </Link>
          {canCancel && (
            <>
              <Link
                href={`/h/${slug}/rounds/${roundId}/admin`}
                style={{ padding: '0.55rem 0.95rem', background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.82rem', fontWeight: 600, textDecoration: 'none' }}
              >
                Lifecycle &amp; admin →
              </Link>
              <CancelRoundButton hubSlug={slug} roundId={roundId} />
            </>
          )}
        </div>
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
            {submissionsClosedMessage}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Round Hero Card ──────────────────────────────────────────────────
// First-viewport card answering: what is this, can I apply, by when,
// for how much. Replaces the previous loose header block.

interface HeroLifecycle {
  label: string
  caption: string
  phase: string
}
interface HeroLifecyclePal {
  bg: string
  fg: string
  border: string
}
interface HeroDeadline {
  rel: string
  abs: string
  isPast: boolean
}

function RoundHeroCard({
  hubSlug,
  roundId,
  profileName,
  displayName,
  mandateNarrative,
  lifecycle,
  lifecyclePal,
  roundStatus,
  deadline,
  budgetCeiling,
  expectedAwards,
  requiredCredentials,
  addressedApplicants,
  canApply,
  canCancel,
  proposalsReceived,
  visibility,
  poolLabel,
  poolAddress,
  submissionsClosedMessage,
  votingWindowStartsAt,
}: {
  hubSlug: string
  roundId: string
  profileName: string
  displayName: string | null | undefined
  mandateNarrative: string
  lifecycle: HeroLifecycle
  lifecyclePal: HeroLifecyclePal
  roundStatus: string
  deadline: HeroDeadline
  budgetCeiling: number
  expectedAwards: number
  requiredCredentials: string[]
  addressedApplicants?: string[]
  canApply: boolean
  canCancel: boolean
  proposalsReceived: number
  visibility: string
  poolLabel: string | null
  poolAddress: string | null | undefined
  submissionsClosedMessage: string
  votingWindowStartsAt: string | null
}) {
  const roundName = displayName ?? mandateNarrative

  // Eligibility chip — one short plain-English summary:
  //   private + addressed → "Invitation only"
  //   required credentials → "Requires: <kind>"
  //   open public         → "Open to hub members"
  const eligibilitySummary = (() => {
    if (visibility === 'private' && addressedApplicants && addressedApplicants.length > 0) {
      return 'Invitation only'
    }
    if (requiredCredentials.length > 0) {
      const first = requiredCredentials[0].replace(/^urn:smart-agent:credential-kind:/, '')
      return `Requires: ${first}${requiredCredentials.length > 1 ? ` + ${requiredCredentials.length - 1} more` : ''}`
    }
    return 'Open to hub members'
  })()

  function formatBudget(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '—'
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
    return `$${n}`
  }

  // Derive the secondary CTA label when the window is closed.
  const secondaryCtaText = (() => {
    if (roundStatus === 'review') {
      if (votingWindowStartsAt) {
        const d = new Date(votingWindowStartsAt)
        const now = Date.now()
        if (d.getTime() > now) return `Voting opens ${d.toISOString().slice(0, 10)}`
        return 'Voting is open'
      }
      return 'Voting in progress'
    }
    if (roundStatus === 'decided') return 'Decision made — awards committed'
    if (roundStatus === 'closed') return 'This round is closed'
    if (roundStatus === 'canceled') return 'This round was canceled'
    if (deadline.isPast) return 'Application window has closed'
    return submissionsClosedMessage
  })()

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: '1.25rem 1.35rem',
        marginBottom: '1rem',
      }}
    >
      {/* Eyebrow */}
      <div style={{ fontSize: '0.62rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.2rem' }}>
        {profileName} · Funding round
      </div>

      {/* Title + status pill */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: 0, flex: 1, minWidth: 0 }}>
          {roundName}
        </h1>
        <span
          aria-label={`Status: ${lifecycle.label}`}
          style={{
            flexShrink: 0,
            padding: '0.22rem 0.6rem',
            background: lifecyclePal.bg,
            color: lifecyclePal.fg,
            border: `1px solid ${lifecyclePal.border}`,
            borderRadius: 999,
            fontSize: '0.65rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginTop: '0.3rem',
          }}
        >
          {lifecycle.label}
        </span>
      </div>

      {/* Lifecycle caption */}
      {lifecycle.caption && (
        <p style={{ fontSize: '0.78rem', color: C.textMuted, margin: '0 0 0.75rem', lineHeight: 1.5 }}>
          {lifecycle.caption}
        </p>
      )}

      {/* Eligibility chip */}
      <div style={{ marginBottom: '0.9rem' }}>
        <span
          title="Who can apply to this round"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.22rem 0.7rem',
            background: 'rgba(139,94,60,0.07)',
            border: '1px solid rgba(139,94,60,0.18)',
            borderRadius: 999,
            fontSize: '0.72rem',
            color: C.text,
            fontWeight: 600,
          }}
        >
          <span aria-hidden style={{ fontSize: '0.65rem', color: C.accent }}>Eligible:</span>
          {eligibilitySummary}
        </span>
      </div>

      {/* Three metric tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0.6rem',
          marginBottom: '1.1rem',
        }}
      >
        <MetricTile
          label="Submission deadline"
          value={deadline.isPast ? 'Closed' : deadline.rel}
          sub={!deadline.isPast && deadline.abs && deadline.rel !== deadline.abs ? deadline.abs : undefined}
          urgent={!deadline.isPast && deadline.rel === 'today'}
        />
        <MetricTile
          label="Budget ceiling"
          value={formatBudget(budgetCeiling)}
        />
        <MetricTile
          label="Awards expected"
          value={expectedAwards > 0 ? String(expectedAwards) : '—'}
          sub={expectedAwards > 0 ? 'grants' : undefined}
        />
      </div>

      {/* Pool attribution */}
      {poolLabel && (
        <div style={{ fontSize: '0.75rem', color: C.textMuted, marginBottom: '0.9rem' }}>
          Funded by{' '}
          {poolAddress ? (
            <Link
              href={`/h/${hubSlug}/pools/${encodeURIComponent(poolAddress)}`}
              style={{ color: C.accent, fontWeight: 600, textDecoration: 'none' }}
            >
              {poolLabel}
            </Link>
          ) : (
            <strong style={{ color: C.text }}>{poolLabel}</strong>
          )}
          {proposalsReceived > 0 && (
            <span style={{ marginLeft: '0.5rem' }}>
              · {proposalsReceived} proposal{proposalsReceived === 1 ? '' : 's'} submitted
            </span>
          )}
        </div>
      )}

      {/* Primary CTA row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        {canApply ? (
          <Link
            href={`/h/${hubSlug}/rounds/${roundId}/apply`}
            style={{
              display: 'inline-block',
              padding: '0.7rem 1.25rem',
              background: C.accent,
              color: '#fff',
              borderRadius: 10,
              fontSize: '0.9rem',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Apply with a proposal
          </Link>
        ) : (
          <span
            style={{
              fontSize: '0.85rem',
              color: C.textMuted,
              fontStyle: 'italic',
              padding: '0.5rem 0',
            }}
          >
            {secondaryCtaText}
          </span>
        )}

        {/* Secondary nav links */}
        <Link
          href={`/h/${hubSlug}/rounds/${roundId}/proposals`}
          style={{
            fontSize: '0.8rem',
            color: C.accent,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {proposalsReceived > 0
            ? `View ${proposalsReceived} proposal${proposalsReceived === 1 ? '' : 's'}`
            : 'View proposals'}
        </Link>

        {canCancel && (
          <Link
            href={`/h/${hubSlug}/rounds/${roundId}/admin`}
            style={{ fontSize: '0.8rem', color: C.textMuted, textDecoration: 'none', fontWeight: 600 }}
          >
            Admin
          </Link>
        )}
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  sub,
  urgent,
}: {
  label: string
  value: string
  sub?: string
  urgent?: boolean
}) {
  return (
    <div
      style={{
        background: urgent ? '#fff8f0' : 'rgba(139,94,60,0.04)',
        border: `1px solid ${urgent ? 'rgba(139,94,60,0.25)' : C.border}`,
        borderRadius: 10,
        padding: '0.6rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.15rem',
      }}
    >
      <span
        style={{
          fontSize: '0.6rem',
          fontWeight: 700,
          color: C.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: '1.1rem',
          fontWeight: 700,
          color: urgent ? C.accent : C.text,
          lineHeight: 1.2,
        }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: '0.65rem', color: C.textMuted }}>{sub}</span>
      )}
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

function ProposalList({
  hubSlug,
  proposals,
}: {
  hubSlug: string
  proposals: RoundProposalBrief[]
}) {
  const STATUS_PALETTE: Record<string, { bg: string; fg: string; border: string }> = {
    submitted: { bg: 'rgba(13,148,136,0.08)',  fg: '#0f766e', border: 'rgba(13,148,136,0.25)' },
    awarded:   { bg: 'rgba(34,197,94,0.10)',   fg: '#166534', border: 'rgba(34,197,94,0.30)'  },
    withdrawn: { bg: '#f3f4f6',                fg: '#6b7280', border: '#e5e7eb'                },
    declined:  { bg: '#fef2f2',                fg: '#991b1b', border: '#fecaca'                },
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {proposals.map((p) => {
        const palette = STATUS_PALETTE[p.status] ?? STATUS_PALETTE.submitted
        const submittedLabel = p.submittedAt
          ? new Date(p.submittedAt).toISOString().slice(0, 10)
          : '—'
        return (
          <li key={p.id} style={{ marginBottom: '0.4rem' }}>
            <Link
              href={`/h/${hubSlug}/proposals/${encodeURIComponent(p.id)}`}
              style={{
                display: 'flex',
                gap: '0.6rem',
                alignItems: 'center',
                padding: '0.55rem 0.7rem',
                background: '#fff',
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                textDecoration: 'none',
                color: C.text,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.displayName}
              </span>
              <span style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                padding: '0.18rem 0.5rem',
                borderRadius: 999,
                background: palette.bg,
                color: palette.fg,
                border: `1px solid ${palette.border}`,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {p.status}
              </span>
              <span style={{ fontSize: '0.72rem', color: C.textMuted, minWidth: '5.5rem', textAlign: 'right' }}>
                {submittedLabel}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
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
