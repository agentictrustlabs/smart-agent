'use client'

import { useState, useTransition } from 'react'
import { createProposal, voteOnProposal } from '@/lib/actions/governance.action'

// ─── CIL Palette ─────────────────────────────────────────────────────

const CIL = {
  bg: '#f8fafc',
  card: '#ffffff',
  accent: '#2563EB',
  accentLight: 'rgba(37,99,235,0.08)',
  accentBorder: 'rgba(37,99,235,0.20)',
  text: '#1e293b',
  textMuted: '#64748b',
  border: '#e2e8f0',
}

// ─── Types ───────────────────────────────────────────────────────────

export interface Proposal {
  id: string
  title: string
  description: string
  actionType: string
  proposerName: string
  votesFor: number
  votesAgainst: number
  quorumRequired: number
  status: string
  executedAt: string | null
  createdAt: string
}

interface Props {
  openProposals: Proposal[]
  completedProposals: Proposal[]
  role: string
  orgAddress: string
}

// ─── Action Type Badge ───────────────────────────────────────────────

const ACTION_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  'pause-capital': { bg: 'rgba(220,38,38,0.10)', color: '#dc2626', label: 'Pause Capital' },
  'graduate-wave': { bg: 'rgba(22,163,74,0.10)', color: '#16a34a', label: 'Graduate Wave' },
  'escalate-review': { bg: 'rgba(217,119,6,0.10)', color: '#d97706', label: 'Escalate Review' },
  general: { bg: 'rgba(37,99,235,0.10)', color: '#2563eb', label: 'General' },
}

// ─── Component ───────────────────────────────────────────────────────

export default function GovernancePageClient({
  openProposals,
  completedProposals,
  role,
  orgAddress,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [isPending, startTransition] = useTransition()

  const canCreate = role === 'ilad-ops' || role === 'admin'
  const canVoteOnProposals = role === 'admin' || role === 'funder'

  // ─── Create Proposal Form ───────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    startTransition(async () => {
      await createProposal({
        orgAddress,
        title: fd.get('title') as string,
        description: fd.get('description') as string,
        actionType: fd.get('actionType') as 'pause-capital' | 'graduate-wave' | 'escalate-review' | 'general',
      })
      setShowForm(false)
    })
  }

  function handleVote(proposalId: string, vote: 'for' | 'against') {
    startTransition(async () => {
      await voteOnProposal(proposalId, vote)
    })
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: CIL.text, fontWeight: 700 }}>
          Governance
        </h1>
        <p style={{ fontSize: '0.85rem', color: CIL.textMuted, margin: 0 }}>
          OOC oversight, proposals, and escalation management
        </p>
      </div>

      {/* Create Proposal button */}
      {canCreate && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          style={{
            padding: '0.5rem 1rem',
            background: CIL.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: 'pointer',
            marginBottom: '1rem',
          }}
        >
          Create Proposal
        </button>
      )}

      {/* Inline create form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            background: CIL.card,
            border: `1px solid ${CIL.border}`,
            borderRadius: 10,
            padding: '1rem',
            marginBottom: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <input
            name="title"
            placeholder="Proposal title"
            required
            style={{
              padding: '0.5rem 0.75rem',
              border: `1px solid ${CIL.border}`,
              borderRadius: 6,
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          <textarea
            name="description"
            placeholder="Description"
            required
            rows={3}
            style={{
              padding: '0.5rem 0.75rem',
              border: `1px solid ${CIL.border}`,
              borderRadius: 6,
              fontSize: '0.85rem',
              outline: 'none',
              resize: 'vertical',
            }}
          />
          <select
            name="actionType"
            defaultValue="general"
            style={{
              padding: '0.5rem 0.75rem',
              border: `1px solid ${CIL.border}`,
              borderRadius: 6,
              fontSize: '0.85rem',
              outline: 'none',
              background: '#fff',
            }}
          >
            <option value="general">General</option>
            <option value="pause-capital">Pause Capital</option>
            <option value="graduate-wave">Graduate Wave</option>
            <option value="escalate-review">Escalate Review</option>
          </select>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="submit"
              disabled={isPending}
              style={{
                padding: '0.5rem 1rem',
                background: CIL.accent,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: isPending ? 'wait' : 'pointer',
                opacity: isPending ? 0.7 : 1,
              }}
            >
              {isPending ? 'Submitting...' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{
                padding: '0.5rem 1rem',
                background: CIL.card,
                color: CIL.text,
                border: `1px solid ${CIL.border}`,
                borderRadius: 6,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Active Proposals */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          color: CIL.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: '0.5rem',
        }}>
          Active Proposals ({openProposals.length})
        </h2>

        {openProposals.length === 0 && (
          <p style={{ fontSize: '0.85rem', color: CIL.textMuted }}>No active proposals.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {openProposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              canVote={canVoteOnProposals}
              isPending={isPending}
              onVote={handleVote}
            />
          ))}
        </div>
      </div>

      {/* Completed Proposals */}
      <div>
        <button
          onClick={() => setShowCompleted(!showCompleted)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: CIL.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: '0.5rem',
          }}
        >
          <span style={{ transform: showCompleted ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
            &#9654;
          </span>
          Completed Proposals ({completedProposals.length})
        </button>

        {showCompleted && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {completedProposals.length === 0 && (
              <p style={{ fontSize: '0.85rem', color: CIL.textMuted }}>No completed proposals.</p>
            )}
            {completedProposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                canVote={false}
                isPending={false}
                onVote={() => {}}
                muted
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Proposal Card ───────────────────────────────────────────────────

function ProposalCard({
  proposal,
  canVote,
  isPending,
  onVote,
  muted = false,
}: {
  proposal: Proposal
  canVote: boolean
  isPending: boolean
  onVote: (id: string, vote: 'for' | 'against') => void
  muted?: boolean
}) {
  const badge = ACTION_BADGE[proposal.actionType] ?? ACTION_BADGE.general
  const progressPct = proposal.quorumRequired > 0
    ? Math.min(100, Math.round((proposal.votesFor / proposal.quorumRequired) * 100))
    : 0

  const statusLabel = proposal.status === 'passed'
    ? 'Passed'
    : proposal.status === 'rejected'
      ? 'Rejected'
      : proposal.status === 'executed'
        ? 'Executed'
        : null

  return (
    <div style={{
      background: muted ? '#f8fafc' : CIL.card,
      border: `1px solid ${CIL.border}`,
      borderRadius: 10,
      padding: '0.75rem 1rem',
      opacity: muted ? 0.7 : 1,
    }}>
      {/* Title + badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.92rem', color: CIL.text }}>
          {proposal.title}
        </span>
        <span style={{
          fontSize: '0.68rem',
          fontWeight: 600,
          background: badge.bg,
          color: badge.color,
          padding: '0.12rem 0.5rem',
          borderRadius: 10,
          whiteSpace: 'nowrap',
        }}>
          {badge.label}
        </span>
        {statusLabel && (
          <span style={{
            fontSize: '0.68rem',
            fontWeight: 600,
            background: proposal.status === 'passed' || proposal.status === 'executed'
              ? 'rgba(22,163,74,0.10)' : 'rgba(220,38,38,0.10)',
            color: proposal.status === 'passed' || proposal.status === 'executed'
              ? '#16a34a' : '#dc2626',
            padding: '0.12rem 0.5rem',
            borderRadius: 10,
          }}>
            {statusLabel}
          </span>
        )}
      </div>

      {/* Description */}
      <p style={{ fontSize: '0.82rem', color: CIL.textMuted, margin: '0 0 0.5rem', lineHeight: 1.4 }}>
        {proposal.description}
      </p>

      {/* Proposer + date */}
      <div style={{ fontSize: '0.72rem', color: CIL.textMuted, marginBottom: '0.5rem' }}>
        Proposed by {proposal.proposerName} &middot; {new Date(proposal.createdAt).toLocaleDateString()}
      </div>

      {/* Vote progress bar */}
      <div style={{ marginBottom: '0.35rem' }}>
        <div style={{
          height: 6,
          background: CIL.border,
          borderRadius: 3,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPct}%`,
            background: CIL.accent,
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }} />
        </div>
        <div style={{ fontSize: '0.72rem', color: CIL.textMuted, marginTop: '0.2rem' }}>
          {proposal.votesFor} of {proposal.quorumRequired} votes needed
          {proposal.votesAgainst > 0 && ` (${proposal.votesAgainst} against)`}
        </div>
      </div>

      {/* Vote buttons */}
      {canVote && proposal.status === 'open' && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button
            onClick={() => onVote(proposal.id, 'for')}
            disabled={isPending}
            style={{
              padding: '0.35rem 0.75rem',
              background: 'rgba(22,163,74,0.10)',
              color: '#16a34a',
              border: '1px solid rgba(22,163,74,0.25)',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: '0.78rem',
              cursor: isPending ? 'wait' : 'pointer',
            }}
          >
            Vote For
          </button>
          <button
            onClick={() => onVote(proposal.id, 'against')}
            disabled={isPending}
            style={{
              padding: '0.35rem 0.75rem',
              background: 'rgba(220,38,38,0.08)',
              color: '#dc2626',
              border: '1px solid rgba(220,38,38,0.20)',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: '0.78rem',
              cursor: isPending ? 'wait' : 'pointer',
            }}
          >
            Vote Against
          </button>
        </div>
      )}
    </div>
  )
}
