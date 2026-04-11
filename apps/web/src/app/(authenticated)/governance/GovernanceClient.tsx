'use client'

import { useState } from 'react'
import { createProposal, castVote } from '@/lib/actions/governance.action'

interface VoteView {
  id: string; voter: string; voterName: string; vote: string; comment: string | null; createdAt: string
}
interface ProposalView {
  id: string; title: string; description: string; actionType: string
  proposerName: string; targetName: string | null; targetAddress: string | null
  quorumRequired: number; votesFor: number; votesAgainst: number
  status: string; createdAt: string; votes: VoteView[]
}

interface Props {
  proposals: ProposalView[]
  orgAddress: string
  orgName: string
  canPropose: boolean
  canVote: boolean
  currentUserId: string
  businesses: Array<{ address: string; name: string }>
}

const ACTION_LABELS: Record<string, string> = {
  'pause-capital': 'Pause Capital',
  'graduate-wave': 'Graduate to Next Wave',
  'escalate-review': 'Escalate for Review',
  'general': 'General',
}

export function GovernanceClient({ proposals, orgAddress, orgName, canPropose, canVote, currentUserId, businesses }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [actionType, setActionType] = useState<string>('general')
  const [targetAddress, setTargetAddress] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await createProposal({
        orgAddress, title, description,
        actionType: actionType as 'pause-capital' | 'graduate-wave' | 'escalate-review' | 'general',
        targetAddress: targetAddress || undefined,
        quorumRequired: 2,
      })
      window.location.reload()
    } catch { alert('Failed to create proposal') }
    finally { setLoading(false) }
  }

  async function handleVote(proposalId: string, vote: 'for' | 'against') {
    try {
      await castVote({ proposalId, vote })
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to vote')
    }
  }

  const openProposals = proposals.filter(p => p.status === 'open')
  const closedProposals = proposals.filter(p => p.status !== 'open')

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#d97706' }}>{openProposals.length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Open Proposals</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#2e7d32' }}>{closedProposals.filter(p => p.status === 'passed').length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Passed</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#b91c1c' }}>{closedProposals.filter(p => p.status === 'rejected').length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Rejected</div>
        </div>
      </div>

      {/* Create Proposal */}
      {canPropose && (
        <section data-component="graph-section">
          <div data-component="section-header">
            <h2>Proposals</h2>
            <button onClick={() => setShowForm(!showForm)} data-component="section-action">
              {showForm ? 'Cancel' : '+ New Proposal'}
            </button>
          </div>
          {showForm && (
            <form onSubmit={handleCreate} data-component="protocol-info">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label>
                  <span style={{ fontSize: '0.8rem', color: '#616161' }}>Title</span>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Proposal title" required
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
                </label>
                <label>
                  <span style={{ fontSize: '0.8rem', color: '#616161' }}>Action Type</span>
                  <select value={actionType} onChange={e => setActionType(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }}>
                    <option value="general">General</option>
                    <option value="pause-capital">Pause Capital</option>
                    <option value="graduate-wave">Graduate to Next Wave</option>
                    <option value="escalate-review">Escalate for Review</option>
                  </select>
                </label>
              </div>
              {actionType !== 'general' && businesses.length > 0 && (
                <label style={{ display: 'block', marginTop: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', color: '#616161' }}>Target Business</span>
                  <select value={targetAddress} onChange={e => setTargetAddress(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }}>
                    <option value="">Select business...</option>
                    {businesses.map(b => <option key={b.address} value={b.address}>{b.name}</option>)}
                  </select>
                </label>
              )}
              <label style={{ display: 'block', marginTop: '0.75rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#616161' }}>Description</span>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} required placeholder="Describe the proposal and rationale..."
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
              </label>
              <button type="submit" disabled={loading} style={{ marginTop: '0.75rem' }}>
                {loading ? 'Creating...' : 'Create Proposal'}
              </button>
            </form>
          )}
        </section>
      )}

      {/* Open Proposals */}
      {openProposals.length > 0 && (
        <section data-component="graph-section">
          <h2>Open ({openProposals.length})</h2>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {openProposals.map(p => {
              const hasVoted = p.votes.some(v => v.voter === currentUserId)
              return (
                <div key={p.id} data-component="protocol-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <strong>{p.title}</strong>
                    <span data-component="role-badge" data-status="proposed">{ACTION_LABELS[p.actionType] ?? p.actionType}</span>
                    {p.targetName && <span style={{ fontSize: '0.8rem', color: '#616161' }}>→ {p.targetName}</span>}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#424242', margin: '0 0 0.5rem' }}>{p.description}</p>
                  <div style={{ fontSize: '0.8rem', color: '#616161', marginBottom: '0.5rem' }}>
                    Proposed by {p.proposerName} · {new Date(p.createdAt).toLocaleDateString()} · Quorum: {p.quorumRequired}
                  </div>

                  {/* Vote tally */}
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ color: '#2e7d32', fontWeight: 600 }}>For: {p.votesFor}</span>
                    <span style={{ color: '#b91c1c', fontWeight: 600 }}>Against: {p.votesAgainst}</span>
                  </div>

                  {/* Votes */}
                  {p.votes.length > 0 && (
                    <div style={{ borderTop: '1px solid #f0f1f3', paddingTop: '0.5rem', marginBottom: '0.5rem' }}>
                      {p.votes.map(v => (
                        <div key={v.id} style={{ fontSize: '0.8rem', display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 600 }}>{v.voterName}</span>
                          <span data-component="role-badge" data-status={v.vote === 'for' ? 'active' : v.vote === 'against' ? 'revoked' : 'proposed'}>
                            {v.vote}
                          </span>
                          {v.comment && <span style={{ color: '#616161' }}>{v.comment}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Vote buttons */}
                  {canVote && !hasVoted && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => handleVote(p.id, 'for')}
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem', background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: 4, color: '#2e7d32', cursor: 'pointer' }}>
                        Vote For
                      </button>
                      <button onClick={() => handleVote(p.id, 'against')}
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem', background: '#ffebee', border: '1px solid #ffcdd2', borderRadius: 4, color: '#b91c1c', cursor: 'pointer' }}>
                        Vote Against
                      </button>
                    </div>
                  )}
                  {hasVoted && <div style={{ fontSize: '0.8rem', color: '#616161' }}>You have voted on this proposal.</div>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Closed Proposals */}
      {closedProposals.length > 0 && (
        <section data-component="graph-section">
          <h2>Closed ({closedProposals.length})</h2>
          <table data-component="graph-table">
            <thead><tr><th>Title</th><th>Type</th><th>Result</th><th>Votes</th><th>Date</th></tr></thead>
            <tbody>
              {closedProposals.map(p => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td><span data-component="role-badge">{ACTION_LABELS[p.actionType] ?? p.actionType}</span></td>
                  <td><span data-component="role-badge" data-status={p.status === 'passed' ? 'active' : 'revoked'}>{p.status}</span></td>
                  <td>{p.votesFor} for / {p.votesAgainst} against</td>
                  <td style={{ fontSize: '0.8rem', color: '#616161' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {proposals.length === 0 && !canPropose && (
        <div data-component="empty-state">
          <p>No proposals yet. {canPropose ? 'Create the first proposal.' : 'Only oversight committee members can create proposals.'}</p>
        </div>
      )}
    </div>
  )
}
