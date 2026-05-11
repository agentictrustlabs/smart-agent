/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Steward proposals view (T051).
 *
 * Server component. Steward-side ranked proposals on a round.
 *
 * Auth gate (v1 simplification):
 *   - Viewer must have a person agent.
 *   - Viewer is treated as a steward of the fund when their agent address
 *     matches the round's `fundAgentId`. v1 only — production resolves a
 *     stewards roster via the fund's pool agent metadata.
 *   // TODO: replace with real steward roster lookup.
 *
 * Federation (v1 simplification):
 *   - Same-DB read of `proposal_submissions` rows for the round via the
 *     `grant_proposal:list_for_round` MCP tool. Production fans out to each
 *     proposer's MCP using the `proposal:read_for_review` cross-delegation.
 *   // TODO(cross-mcp): wire federated proposer-MCP fan-out.
 *
 * Ranking:
 *   - `stewardSideSignals` per proposal (hops fund → proposer + proposer's
 *     prior fulfilled/abandoned ratio).
 *   - Tie-break on `submittedAt` desc per FR-019.
 *
 * Read-only here — review / decision / award belong to the downstream spec.
 */

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getRoundForViewer } from '@/lib/actions/rounds.action'
import { listProposalsForRoundSteward } from '@/lib/actions/grantProposals.action'
import { StewardTallySummary } from '@/components/voting/StewardTallySummary'
import { rankCue } from '@smart-agent/sdk'
import type { RankBasis, GrantProposal } from '@smart-agent/sdk'
import { CloseRoundForm, type CloseableProposal } from './CloseRoundForm'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  matchBg: 'rgba(13,148,136,0.08)',
  matchFg: '#0f766e',
  matchBorder: 'rgba(13,148,136,0.25)',
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return iso
  }
}

function formatBudget(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n}`
}

function STATUS_LABEL(status: GrantProposal['status']): { label: string; color: string } {
  switch (status) {
    case 'submitted': return { label: 'Submitted', color: '#0f766e' }
    case 'withdrawn': return { label: 'Withdrawn', color: '#6b7280' }
    case 'awarded': return { label: 'Awarded', color: '#0f766e' }
    case 'declined': return { label: 'Declined', color: '#991b1b' }
    case 'draft': return { label: 'Draft', color: '#92400e' }
  }
}

export default async function StewardProposalsPage({
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

  // Steward gate (v1.5): viewer must be able to manage the round's fund —
  // either via a governance edge (ROLE_OWNER / ROLE_OPERATOR / ROLE_BOARD)
  // or via the fund's ATL_CONTROLLER list. canManageAgent encapsulates both
  // paths and matches the catalyst-seed auth model. Production round-creation
  // flows will surface a real stewards roster on the pool.
  //
  // The discovery query returns fundAgentId as a full IRI; strip the
  // prefix so canManageAgent receives a bare address.
  const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'
  const fundAddress = round.fundAgentId.startsWith(AGENT_IRI_PREFIX)
    ? round.fundAgentId.slice(AGENT_IRI_PREFIX.length)
    : round.fundAgentId
  const isSteward = await canManageAgent(myAgent, fundAddress)
  if (!isSteward) {
    return <NotAuthorizedSurface hubSlug={slug} reason="not-steward" />
  }

  // The MCP tool's WHERE clause matches roundId exactly; rows are stored
  // with full URN (urn:smart-agent:round:<slug>) while the URL param is
  // just the slug. Normalize.
  const fullRoundId = roundId.startsWith('urn:smart-agent:round:')
    ? roundId
    : `urn:smart-agent:round:${roundId}`
  const ranked = await listProposalsForRoundSteward({
    roundId: fullRoundId,
    stewardAgentId: myAgent,
    fundAgentId: round.fundAgentId,
  })

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Steward · Proposals on this round
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          {round.mandate.acceptedKinds?.[0] ?? 'Round'}{' '}
          <span style={{ color: C.textMuted, fontSize: '0.9rem', fontWeight: 500 }}>
            ({ranked.length} proposal{ranked.length === 1 ? '' : 's'})
          </span>
        </h1>
        <p style={{ fontSize: '0.8rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          Ranked by proximity to your fund and the proposer&apos;s prior fulfilled / abandoned ratio.
          Ties break on most-recent submission first.
        </p>
        <div style={{ marginTop: '0.6rem' }}>
          <Link
            href={`/h/${slug}/rounds/${roundId}`}
            style={{ color: C.accent, fontSize: '0.78rem', textDecoration: 'none' }}
          >
            ← Back to round detail
          </Link>
        </div>
      </div>

      {ranked.length === 0 ? (
        <div style={{
          padding: '2rem',
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          textAlign: 'center',
          color: C.textMuted,
          fontSize: '0.9rem',
        }}>
          No submitted proposals on this round yet.
        </div>
      ) : (<>
        <StewardTallySummary
          roundId={fullRoundId}
          proposalIds={ranked.filter(r => r.proposal.status === 'submitted').map(r => r.proposal.id)}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {ranked.map((r, i) => (
            <ProposalRow
              key={r.proposal.id}
              proposal={r.proposal}
              basis={r.basis}
              rank={i + 1}
              hubSlug={slug}
            />
          ))}
        </div>
      </>)}

      {/* Phase 2.5 — close-round form. Renders only when the round is still
          open (non-canceled, non-closed) AND there's at least one submitted
          proposal to award. */}
      <CloseRoundForm
        hubSlug={slug}
        roundId={roundId}
        poolAgentId={round.fundAgentId}
        proposals={ranked
          .filter(r => r.proposal.status === 'submitted')
          .map<CloseableProposal>(r => ({
            proposalIRI: r.proposal.id,
            proposerAgentId: r.proposal.proposerAgentId,
            proposerLabel: `${r.proposal.proposerAgentId.slice(0, 6)}…${r.proposal.proposerAgentId.slice(-4)}`,
            suggestedAmount: r.proposal.budget?.total ?? 0,
            unit: r.proposal.budget?.lineItems?.[0]?.unit ?? 'USD',
          }))}
      />
    </div>
  )
}

function ProposalRow({
  proposal,
  basis,
  rank,
  hubSlug,
}: {
  proposal: GrantProposal
  basis: RankBasis
  rank: number
  hubSlug: string
}) {
  const proposerLabel = `${proposal.proposerAgentId.slice(0, 6)}…${proposal.proposerAgentId.slice(-4)}`
  const intentLabel = proposal.basedOnIntentId
    ? `${proposal.basedOnIntentId.slice(0, 8)}…`
    : '—'
  const status = STATUS_LABEL(proposal.status)
  return (
    <div
      style={{
        display: 'block',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.85rem 1rem',
        color: C.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          padding: '0.18rem 0.55rem',
          borderRadius: 999,
          background: C.matchBg,
          color: C.matchFg,
          border: `1px solid ${C.matchBorder}`,
        }}>
          #{rank}
        </span>
        <span style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          color: status.color,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {status.label}
        </span>
        <span style={{ fontSize: '0.78rem', color: C.text, fontWeight: 600 }}>
          Proposer: {proposerLabel}
        </span>
        <span style={{ fontSize: '0.7rem', color: C.textMuted }}>
          v{proposal.version} · submitted {formatDate(proposal.submittedAt)}
        </span>
      </div>

      <Link
        href={`/h/${hubSlug}/proposals/${proposal.id}`}
        style={{ fontSize: '1rem', fontWeight: 700, color: C.text, marginBottom: '0.3rem', display: 'block', textDecoration: 'none' }}
      >
        {proposal.displayName || <em style={{ color: C.textMuted, fontWeight: 400 }}>(untitled proposal)</em>}
      </Link>

      <div style={{ fontSize: '0.85rem', color: C.text, marginBottom: '0.4rem' }}>
        Based on intent <code style={{ fontSize: '0.78rem', color: C.textMuted }}>{intentLabel}</code>
        {proposal.budget?.total ? (
          <span style={{ marginLeft: '0.85rem', color: C.textMuted }}>
            · Budget: {formatBudget(proposal.budget.total)}
          </span>
        ) : null}
        {proposal.milestones?.length ? (
          <span style={{ marginLeft: '0.85rem', color: C.textMuted }}>
            · {proposal.milestones.length} milestone{proposal.milestones.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <details>
        <summary style={{
          listStyle: 'none',
          cursor: 'pointer',
          fontSize: '0.7rem',
          color: C.textMuted,
          display: 'inline-flex',
          gap: '0.35rem',
          alignItems: 'center',
        }}>
          <span style={{ color: C.accent, fontWeight: 600 }}>Why rank:</span>
          <span>{rankCue(basis)}</span>
        </summary>
        <div style={{ marginTop: '0.3rem', fontSize: '0.7rem', color: C.text, paddingLeft: '0.5rem' }}>
          <div>
            <strong style={{ color: C.accent }}>Proximity:</strong> {basis.proximityHops} hop{basis.proximityHops === 1 ? '' : 's'}
            <span style={{ color: C.textMuted }}> · score {basis.proximityScore.toFixed(2)}</span>
          </div>
          <div>
            <strong style={{ color: C.accent }}>Outcomes:</strong>{' '}
            {basis.isColdStart
              ? 'no prior history yet'
              : `${basis.priorOutcomes.fulfilled} fulfilled / ${basis.priorOutcomes.abandoned} abandoned`}
            <span style={{ color: C.textMuted }}> · score {basis.outcomeScore.toFixed(2)}</span>
          </div>
          <div>
            <strong style={{ color: C.accent }}>Composite:</strong> {basis.composite.toFixed(3)}
          </div>
        </div>
      </details>
      <div style={{ marginTop: '0.4rem' }}>
        <Link
          href={`/h/${hubSlug}/rounds/${proposal.roundId ?? ''}`}
          style={{ fontSize: '0.7rem', color: C.accent, textDecoration: 'none' }}
        >
          View round detail →
        </Link>
      </div>
    </div>
  )
}

function NotAuthorizedSurface({ hubSlug, reason }: { hubSlug: string; reason: 'no-agent' | 'not-found-or-private' | 'not-steward' }) {
  const title =
    reason === 'no-agent' ? 'Sign in required'
      : reason === 'not-steward' ? 'Steward access required'
        : 'Round not available'
  const body =
    reason === 'no-agent' ? 'This page needs a person agent.'
      : reason === 'not-steward' ? 'You are not registered as a steward of this round\'s fund.'
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
