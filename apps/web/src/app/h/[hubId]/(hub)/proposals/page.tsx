/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Your proposals (T058).
 *
 * Server component. Lists the viewer's proposals grouped by status with
 * the appropriate action affordance per status (FR-020):
 *   - draft               → "Resume editing"
 *   - submitted (open)    → "Edit" / "Withdraw"
 *   - submitted (closed)  → "View" only
 *   - withdrawn           → "View" only
 *   - awarded / declined  → "View" only
 *
 * Reads via `listMemberProposals()` (proposer-MCP read_self under the hood).
 * No GraphDB joins (IA P5).
 */

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { listMemberProposals } from '@/lib/actions/grantProposals.action'
import type { GrantProposal } from '@smart-agent/sdk'

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
}

const STATUS_ORDER: GrantProposal['status'][] = [
  'draft',
  'submitted',
  'awarded',
  'declined',
  'withdrawn',
]

const SECTION_LABEL: Record<GrantProposal['status'], string> = {
  draft: 'Drafts',
  submitted: 'Submitted',
  withdrawn: 'Withdrawn',
  awarded: 'Awarded',
  declined: 'Declined',
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return iso
  }
}

export default async function YourProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ hubId: string }>
  searchParams: Promise<{ msg?: string; err?: string }>
}) {
  const { hubId: slug } = await params
  const sp = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return <NotAuthorizedSurface hubSlug={slug} />
  }

  const { proposals } = await listMemberProposals()
  const grouped = STATUS_ORDER.reduce<Record<GrantProposal['status'], GrantProposal[]>>((acc, s) => {
    acc[s] = proposals.filter((p) => p.status === s)
    return acc
  }, { draft: [], submitted: [], withdrawn: [], awarded: [], declined: [] })

  const total = proposals.length

  return (
    <div style={{ paddingBottom: '2rem' }}>
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
          color: '#991b1b',
          padding: '0.7rem 0.95rem',
          borderRadius: 10,
          fontSize: '0.85rem',
          marginBottom: '0.85rem',
        }}>
          {sp.err}
        </div>
      )}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Your proposals
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          Your proposals{' '}
          {total > 0 && (
            <span style={{ color: C.textMuted, fontSize: '0.95rem', fontWeight: 500 }}>
              ({total})
            </span>
          )}
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          Drafts, submitted proposals, and decisions. Edit submitted proposals before the round&apos;s deadline.
        </p>
      </div>

      {total === 0 ? (
        <div style={{
          padding: '2rem',
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          textAlign: 'center',
          color: C.textMuted,
          fontSize: '0.9rem',
        }}>
          You haven&apos;t drafted or submitted any proposals yet.
          <div style={{ marginTop: '0.85rem' }}>
            <Link href={`/h/${slug}/rounds`} style={{
              display: 'inline-block',
              padding: '0.5rem 0.9rem',
              background: C.accent,
              color: '#fff',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '0.85rem',
              textDecoration: 'none',
            }}>
              Browse open rounds →
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {STATUS_ORDER.map((s) => {
            if (grouped[s].length === 0) return null
            return (
              <section key={s}>
                <h2 style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: C.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  margin: '0 0 0.5rem',
                }}>
                  {SECTION_LABEL[s]} ({grouped[s].length})
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {grouped[s].map((p) => (
                    <ProposalListRow key={p.id} proposal={p} hubSlug={slug} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ProposalListRow({ proposal, hubSlug }: { proposal: GrantProposal; hubSlug: string }) {
  const status = proposal.status
  const intentLabel = proposal.basedOnIntentId
    ? `${proposal.basedOnIntentId.slice(0, 8)}…`
    : '—'
  const roundLabel = proposal.roundId
    ? `${proposal.roundId.slice(0, 8)}…`
    : proposal.fundMandateId
      ? `Open call: ${proposal.fundMandateId.slice(0, 8)}…`
      : 'No target round'

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.7rem 1rem',
        color: C.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
        <span style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          color: statusColor(status),
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {SECTION_LABEL[status].slice(0, -1) /* trim plural s */}
        </span>
        <span style={{ fontSize: '0.7rem', color: C.textMuted }}>
          v{proposal.version}
        </span>
        <span style={{ fontSize: '0.7rem', color: C.textMuted }}>
          {status === 'draft' || status === 'withdrawn'
            ? `last edited ${formatDate(proposal.lastEditedAt)}`
            : `submitted ${formatDate(proposal.submittedAt)}`}
        </span>
      </div>
      <div style={{ fontSize: '0.85rem', color: C.text, marginBottom: '0.3rem' }}>
        Round: <code style={{ fontSize: '0.78rem', color: C.textMuted }}>{roundLabel}</code>
        <span style={{ marginLeft: '0.85rem' }}>
          Intent: <code style={{ fontSize: '0.78rem', color: C.textMuted }}>{intentLabel}</code>
        </span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Link
          href={`/h/${hubSlug}/proposals/${proposal.id}`}
          style={{
            fontSize: '0.78rem',
            color: C.accent,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {status === 'draft' ? 'Resume editing →' : 'View →'}
        </Link>
      </div>
    </div>
  )
}

function NotAuthorizedSurface({ hubSlug }: { hubSlug: string }) {
  return (
    <div style={{ padding: '2rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>Sign in required</h2>
      <p style={{ fontSize: '0.85rem', color: C.textMuted, marginBottom: '0.85rem' }}>
        Your proposals are stored in your agent&apos;s MCP — you need a person agent to view them.
      </p>
      <Link
        href={`/h/${hubSlug}`}
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
        Back to hub
      </Link>
    </div>
  )
}
