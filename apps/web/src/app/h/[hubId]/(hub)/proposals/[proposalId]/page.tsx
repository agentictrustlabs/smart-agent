/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Proposal detail (T059).
 *
 * Server component. State-aware view:
 *   - draft               → fields shown; "Edit on apply page" link (apply
 *                           page is the canonical composer; in v1 the
 *                           proposalId is NOT pre-loaded into apply, so
 *                           drafts re-target by going back to a round).
 *                           // TODO: in-page edit form for drafts.
 *   - submitted (open)    → read-only render + "Edit", "Withdraw", "Clone"
 *   - submitted (closed)  → read-only + "Withdraw", "Clone" only
 *   - withdrawn / awarded / declined → read-only + "Clone"
 *
 * For v1 the edit form is a minimal hidden-form POST per editable field
 * (allowed fields per the EditGrantProposalRequest contract). Inline
 * structured editing of milestones / line-items is a follow-up.
 *
 * Implements FR-022 (state-aware mounts).
 */

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getMemberProposal } from '@/lib/actions/grantProposals.action'
import { getRoundForViewer } from '@/lib/actions/rounds.action'
import { ProposalVotePanel } from '@/components/voting/ProposalVotePanel'
import { FundingAndOutcomesPanel } from '@/components/voting/FundingAndOutcomesPanel'
import { canManageAgent } from '@/lib/agent-registry'
import type { GrantProposal } from '@smart-agent/sdk'
import { getCommitmentForProposal, getMilestoneRelease } from '@/lib/actions/commitments.action'
import { proposalSubject as proposalSubjectFn } from '@smart-agent/sdk'
import { CommitmentTimelinePanel } from './CommitmentTimelinePanel'
import type { Address, Hex } from 'viem'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  draftFg: '#92400e',
  submittedFg: '#0f766e',
  withdrawnFg: '#6b7280',
  awardedFg: '#0f766e',
  declinedFg: '#991b1b',
  danger: '#991b1b',
}

function statusColor(s: GrantProposal['status']): string {
  switch (s) {
    case 'draft': return C.draftFg
    case 'submitted': return C.submittedFg
    case 'withdrawn': return C.withdrawnFg
    case 'awarded': return C.awardedFg
    case 'declined': return C.declinedFg
  }
}

function formatBudget(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n}`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return iso
  }
}

export default async function ProposalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ hubId: string; proposalId: string }>
  searchParams: Promise<{ msg?: string; err?: string }>
}) {
  const { hubId: slug, proposalId } = await params
  const sp = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return <NotFoundSurface hubSlug={slug} reason="no-agent" />
  }

  const proposal = await getMemberProposal(proposalId)
  if (!proposal) {
    return <NotFoundSurface hubSlug={slug} reason="not-found" />
  }

  // Look up the round to compute the deadline-aware action set + the
  // fund agent (needed for the funding panel's canManage gate).
  let deadlinePassed = false
  let fundAgentForRound: string | null = null
  if (proposal.roundId) {
    const { round } = await getRoundForViewer(proposal.roundId, myAgent)
    if (round?.deadline) {
      deadlinePassed = Date.now() > Date.parse(round.deadline)
    }
    fundAgentForRound = round?.fundAgentId ?? null
  }
  let canManageFund = false
  if (fundAgentForRound) {
    try { canManageFund = await canManageAgent(myAgent, fundAgentForRound) } catch { canManageFund = false }
  }

  // Spec 006 — load the on-chain commitment row for this proposal (if any)
  // and the per-milestone release records. We compute the proposal subject
  // from the proposal slug (proposalId is either URN or bare slug). The
  // donor is the round's pool agent (unified governance: round operator =
  // pool, also serves as donor for grant-lane commitments).
  let commitment: Awaited<ReturnType<typeof getCommitmentForProposal>> = null
  let milestoneReleases: Array<{ id: string; label: string; trancheBps: number; releasedAmount: string | null; releasedAt: number | null }> = []
  if (proposal.status === 'awarded' && fundAgentForRound) {
    const proposalSlug = proposal.id.replace(/^urn:smart-agent:proposal:/, '')
    const proposalSubjectHex = proposalSubjectFn(proposalSlug) as Hex
    // Strip the IRI prefix the discovery layer attaches.
    const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'
    const donorAddr = (fundAgentForRound.startsWith(AGENT_IRI_PREFIX)
      ? fundAgentForRound.slice(AGENT_IRI_PREFIX.length)
      : fundAgentForRound) as Address
    commitment = await getCommitmentForProposal(proposalSubjectHex, donorAddr)
    if (commitment) {
      let parsed: Array<{ id?: string; label?: string; trancheBps?: number }> = []
      try { parsed = JSON.parse(commitment.milestonesJson || '[]') } catch { parsed = [] }
      if (parsed.length === 0) {
        parsed = [{ id: 'single', label: 'On award', trancheBps: 10000 }]
      }
      const { keccak256: keccak, toBytes: kbToBytes } = await import('viem')
      milestoneReleases = await Promise.all(parsed.map(async (m) => {
        const id = m.id ?? 'single'
        const mid = keccak(kbToBytes(id)) as Hex
        const rel = await getMilestoneRelease(commitment!.commitmentSubject, mid)
        return {
          id,
          label: m.label ?? id,
          trancheBps: m.trancheBps ?? Math.floor(10000 / parsed.length),
          releasedAmount: rel?.amount ?? null,
          releasedAt: rel?.releasedAt ?? null,
        }
      }))
    }
  }

  const status = proposal.status
  const canEdit = status === 'submitted' && !deadlinePassed
  const canWithdraw = status === 'submitted' || status === 'draft'
  const canClone = true
  const isProposer = proposal.proposerAgentId.toLowerCase() === myAgent.toLowerCase()
                  || proposal.proposerAgentId.toLowerCase() === `person_${user.id}`.toLowerCase()

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Proposal
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          {proposal.displayName
            || (proposal.plan?.narrative
              ? proposal.plan.narrative.slice(0, 80) + (proposal.plan.narrative.length > 80 ? '…' : '')
              : 'Untitled proposal')}
        </h1>
        <div style={{ fontSize: '0.78rem', color: C.textMuted, display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: statusColor(status), textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {status}
          </span>
          <span>v{proposal.version}</span>
          {proposal.submittedAt && <span>Submitted {formatDate(proposal.submittedAt)}</span>}
          <span>Last edited {formatDate(proposal.lastEditedAt)}</span>
          {deadlinePassed && status === 'submitted' && (
            <span style={{ color: C.draftFg, fontStyle: 'italic' }}>
              Deadline passed — read-only
            </span>
          )}
        </div>
        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link href={`/h/${slug}/proposals`} style={{ color: C.accent, fontSize: '0.78rem', textDecoration: 'none' }}>
            ← Back to your proposals
          </Link>
          {proposal.roundId && (
            <Link
              href={`/h/${slug}/rounds/${encodeURIComponent(proposal.roundId.replace('urn:smart-agent:round:', ''))}`}
              style={{ color: C.accent, fontSize: '0.78rem', textDecoration: 'none' }}
            >
              ← Back to round
            </Link>
          )}
        </div>
      </div>

      {/* Flash messages */}
      {sp.msg && (
        <div style={{
          background: 'rgba(13,148,136,0.08)',
          border: '1px solid rgba(13,148,136,0.25)',
          color: '#0f766e',
          padding: '0.7rem 0.95rem',
          borderRadius: 10,
          fontSize: '0.85rem',
          marginBottom: '0.85rem',
        }}>
          {sp.msg}
        </div>
      )}
      {sp.err && (
        <div style={{
          background: 'rgba(220,38,38,0.08)',
          border: '1px solid rgba(220,38,38,0.30)',
          color: C.danger,
          padding: '0.7rem 0.95rem',
          borderRadius: 10,
          fontSize: '0.85rem',
          marginBottom: '0.85rem',
        }}>
          {sp.err}
        </div>
      )}

      {/* Target */}
      <Section title="Target">
        <Row label="Round">
          {proposal.roundId ? (
            <Link href={`/h/${slug}/rounds/${proposal.roundId}`} style={{ color: C.accent, textDecoration: 'none' }}>
              {proposal.roundId}
            </Link>
          ) : proposal.fundMandateId ? (
            <span>Open call · fund {proposal.fundMandateId}</span>
          ) : (
            <span style={{ color: C.textMuted, fontStyle: 'italic' }}>None — re-target by browsing rounds</span>
          )}
        </Row>
        <Row label="Based on intent">
          <code style={{ fontSize: '0.78rem' }}>{proposal.basedOnIntentId || '—'}</code>
        </Row>
      </Section>

      {/* Plan */}
      <Section title="Plan narrative">
        <p style={{ fontSize: '0.88rem', color: C.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {proposal.plan?.narrative || <em>(empty)</em>}
        </p>
        {proposal.plan?.planArtifactRef && (
          <div style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
            <strong style={{ color: C.accent }}>Artifact:</strong>{' '}
            <a href={proposal.plan.planArtifactRef} style={{ color: C.accent }}>
              {proposal.plan.planArtifactRef}
            </a>
          </div>
        )}
      </Section>

      {/* Budget */}
      <Section title="Budget">
        <Row label="Total">{formatBudget(proposal.budget?.total ?? 0)}</Row>
        {proposal.budget?.lineItems?.length ? (
          <ul style={{ margin: '0.4rem 0 0 1.2rem', padding: 0, fontSize: '0.8rem', color: C.text }}>
            {proposal.budget.lineItems.map((li, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>
                <strong>{li.name}</strong> — {formatBudget(li.amount)} {li.unit}
                {li.justification && (
                  <span style={{ color: C.textMuted }}>{' '}· {li.justification}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: '0.8rem', color: C.textMuted, fontStyle: 'italic' }}>No line items.</div>
        )}
      </Section>

      {/* Milestones */}
      {proposal.milestones?.length > 0 && (
        <Section title={`Milestones (${proposal.milestones.length})`}>
          <ul style={{ margin: 0, padding: '0 0 0 1.2rem', fontSize: '0.82rem', color: C.text }}>
            {proposal.milestones.map((m, i) => (
              <li key={i} style={{ marginBottom: '0.35rem' }}>
                <strong>{m.name}</strong>
                {m.dueDate && <span style={{ color: C.textMuted }}> · due {formatDate(m.dueDate)}</span>}
                {m.trancheAmount > 0 && <span style={{ color: C.textMuted }}> · tranche {formatBudget(m.trancheAmount)}</span>}
                {m.evidenceRequired && (
                  <div style={{ fontSize: '0.78rem', color: C.textMuted, marginTop: '0.15rem' }}>
                    Evidence: {m.evidenceRequired}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Desired outcomes */}
      {proposal.desiredOutcomes?.length > 0 && (
        <Section title={`Desired outcomes (${proposal.desiredOutcomes.length})`}>
          <ul style={{ margin: 0, padding: '0 0 0 1.2rem', fontSize: '0.82rem', color: C.text }}>
            {proposal.desiredOutcomes.map((o, i) => (
              <li key={i} style={{ marginBottom: '0.35rem' }}>
                <strong>{o.statement}</strong>
                {o.measurable && (
                  <div style={{ fontSize: '0.78rem', color: C.textMuted, marginTop: '0.15rem' }}>
                    Measurable: {o.measurable}
                  </div>
                )}
                {o.validators?.length > 0 && (
                  <div style={{ fontSize: '0.75rem', color: C.textMuted, marginTop: '0.15rem' }}>
                    Validators: {o.validators.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Reporting obligations */}
      <Section title="Reporting">
        <Row label="Cadence">{proposal.reportingObligations?.cadence ?? '—'}</Row>
        <Row label="Format">{proposal.reportingObligations?.format ?? '—'}</Row>
      </Section>

      {/* Organisational background */}
      <Section title="Organisational background">
        <p style={{ fontSize: '0.88rem', color: C.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {proposal.organisationalBackground?.narrative || <em>(empty)</em>}
        </p>
        {proposal.organisationalBackground?.priorTrackRecordRefs?.length ? (
          <div style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
            <strong style={{ color: C.accent }}>Prior track record:</strong>
            <ul style={{ margin: '0.2rem 0 0 1.2rem', padding: 0 }}>
              {proposal.organisationalBackground.priorTrackRecordRefs.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      {/* Steward voting panel — visible to everyone but only stewards can cast.
          Renders only when the proposal is on a round (drafts skip). */}
      {proposal.roundId && proposal.status !== 'draft' && (
        <ProposalVotePanel roundId={proposal.roundId} proposalId={proposal.id} />
      )}

      {/* Spec 006 — universal commitment timeline. Renders for any
          awarded proposal that has a CommitmentRegistry row. */}
      {proposal.status === 'awarded' && commitment && (
        <CommitmentTimelinePanel
          commitment={commitment}
          milestones={milestoneReleases}
          canRelease={canManageFund}
        />
      )}

      {/* Funding + outcomes — only for awarded proposals (Sprint C). */}
      {proposal.status === 'awarded' && fundAgentForRound && (
        <FundingAndOutcomesPanel
          proposalId={proposal.id}
          fundAgent={fundAgentForRound}
          isProposer={isProposer}
          canManageFund={canManageFund}
          milestoneLabels={(proposal.milestones ?? []).map((m) => m.name).filter(Boolean)}
        />
      )}

      {/* Action affordances */}
      <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
        {canEdit && (
          <EditNarrativeForm proposal={proposal} hubSlug={slug} />
        )}
        {canClone && (
          <form action={`/h/${slug}/proposals/${proposalId}/clone`} method="post" style={{ display: 'inline' }}>
            <button type="submit" style={ghostButtonStyle()}>
              Clone as draft
            </button>
          </form>
        )}
        {canWithdraw && (
          <form action={`/h/${slug}/proposals/${proposalId}/withdraw`} method="post" style={{ display: 'inline' }}>
            <button type="submit" style={dangerButtonStyle()}>
              Withdraw
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function EditNarrativeForm({ proposal, hubSlug }: { proposal: GrantProposal; hubSlug: string }) {
  // Minimal pre-deadline edit surface: lets the proposer update plan
  // narrative + organisational background. Full structured editing
  // (milestones, budget line items) is a follow-up — those fields are
  // shown read-only above. Per FR-021, version bumps on the MCP side
  // for any edit; this minimal form is enough to demonstrate the
  // version-bump round-trip end-to-end.
  return (
    <details style={{ display: 'inline-block' }}>
      <summary style={{ ...ghostButtonStyle(), listStyle: 'none', cursor: 'pointer' }}>
        Edit narrative
      </summary>
      <form
        action={`/h/${hubSlug}/proposals/${proposal.id}/edit`}
        method="post"
        style={{
          marginTop: '0.6rem',
          padding: '0.85rem',
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          minWidth: 360,
        }}
      >
        <label style={{ display: 'block', fontSize: '0.7rem', color: C.textMuted, fontWeight: 600, marginBottom: '0.2rem' }}>
          Plan narrative
        </label>
        <textarea
          name="planNarrative"
          defaultValue={proposal.plan?.narrative ?? ''}
          rows={4}
          style={{
            width: '100%',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: '0.5rem',
            fontSize: '0.85rem',
            fontFamily: 'inherit',
          }}
        />
        <label style={{ display: 'block', fontSize: '0.7rem', color: C.textMuted, fontWeight: 600, margin: '0.6rem 0 0.2rem' }}>
          Organisational background
        </label>
        <textarea
          name="organisationalBackground"
          defaultValue={proposal.organisationalBackground?.narrative ?? ''}
          rows={4}
          style={{
            width: '100%',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: '0.5rem',
            fontSize: '0.85rem',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ marginTop: '0.6rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" style={accentButtonStyle()}>
            Save (bumps version)
          </button>
        </div>
      </form>
    </details>
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

function accentButtonStyle(): React.CSSProperties {
  return {
    padding: '0.55rem 1rem',
    background: C.accent,
    color: '#fff',
    borderRadius: 10,
    fontSize: '0.85rem',
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
  }
}

function ghostButtonStyle(): React.CSSProperties {
  return {
    padding: '0.55rem 1rem',
    background: '#fff',
    color: C.text,
    borderRadius: 10,
    fontSize: '0.85rem',
    fontWeight: 600,
    border: `1px solid ${C.border}`,
    cursor: 'pointer',
  }
}

function dangerButtonStyle(): React.CSSProperties {
  return {
    padding: '0.55rem 1rem',
    background: '#fff',
    color: C.danger,
    borderRadius: 10,
    fontSize: '0.85rem',
    fontWeight: 700,
    border: `1px solid ${C.danger}`,
    cursor: 'pointer',
  }
}

function NotFoundSurface({ hubSlug, reason }: { hubSlug: string; reason: 'no-agent' | 'not-found' }) {
  const title = reason === 'no-agent' ? 'Sign in required' : 'Proposal not found'
  const body = reason === 'no-agent'
    ? 'This page needs a person agent.'
    : 'This proposal either does not exist or is not yours.'
  return (
    <div style={{ padding: '2rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>{title}</h2>
      <p style={{ fontSize: '0.85rem', color: C.textMuted, marginBottom: '0.85rem' }}>{body}</p>
      <Link
        href={`/h/${hubSlug}/proposals`}
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
        Back to your proposals
      </Link>
    </div>
  )
}
