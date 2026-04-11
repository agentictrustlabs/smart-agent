'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { submitReview } from '@/lib/actions/submit-review.action'

const REVIEW_TYPES = [
  { value: 'performance', label: 'Performance Review' },
  { value: 'trust', label: 'Trust Review' },
  { value: 'quality', label: 'Quality Review' },
  { value: 'compliance', label: 'Compliance Review' },
  { value: 'safety', label: 'Safety Review' },
]

const RECOMMENDATIONS = [
  { value: 'endorses', label: 'Endorses', color: '#22c55e' },
  { value: 'recommends', label: 'Recommends', color: '#2563eb' },
  { value: 'neutral', label: 'Neutral', color: '#6b7280' },
  { value: 'flags', label: 'Flags', color: '#f59e0b' },
  { value: 'disputes', label: 'Disputes', color: '#ef4444' },
]

const DIMENSIONS = [
  'accuracy', 'reliability', 'responsiveness', 'compliance', 'safety', 'transparency', 'helpfulness',
]

interface Agent { address: string; name: string; delegationStatus: string; delegationExpiry: string | null }

export function SubmitReviewClient({ reviewableAgents }: { reviewableAgents: Agent[] }) {
  const router = useRouter()
  const [selectedAgent, setSelectedAgent] = useState(reviewableAgents[0]?.address ?? '')
  const [reviewType, setReviewType] = useState('performance')
  const [recommendation, setRecommendation] = useState('recommends')
  const [overallScore, setOverallScore] = useState(75)
  const [dimensions, setDimensions] = useState<Record<string, number>>(
    Object.fromEntries(DIMENSIONS.map((d) => [d, 70]))
  )
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  function setDimension(dim: string, score: number) {
    setDimensions((prev) => ({ ...prev, [dim]: Math.min(100, Math.max(0, score)) }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAgent) return

    setSubmitting(true)
    setError('')

    const result = await submitReview({
      subjectAddress: selectedAgent,
      reviewType,
      recommendation,
      overallScore,
      dimensions: DIMENSIONS.map((d) => ({ dimension: d, score: dimensions[d] })),
      comment,
    })

    setSubmitting(false)

    if (result.success) {
      setSuccess(true)
      setTimeout(() => router.push('/reviews'), 2000)
    } else {
      setError(result.error ?? 'Failed to submit review')
    }
  }

  if (success) {
    return (
      <div data-component="deploy-success">
        <h2>Review Submitted</h2>
        <p>Your review has been recorded on-chain. Redirecting to reviews...</p>
      </div>
    )
  }

  const selectedAgentData = reviewableAgents.find((a) => a.address === selectedAgent)
  const selectedAgentName = selectedAgentData?.name

  return (
    <form onSubmit={handleSubmit} data-component="deploy-form">
      {/* Agent */}
      <div data-component="form-field">
        <label htmlFor="agent">Agent to Review</label>
        <select id="agent" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} data-component="org-select">
          {reviewableAgents.map((a) => (
            <option key={a.address} value={a.address}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Delegation Status */}
      {selectedAgentData && (
        <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
          <h3>Delegation Status (ERC-7710)</h3>
          <dl>
            <dt>Status</dt>
            <dd>
              <span
                data-component="role-badge"
                data-status={selectedAgentData.delegationStatus === 'active' ? 'active' : selectedAgentData.delegationStatus === 'expired' ? 'revoked' : 'proposed'}
              >
                {selectedAgentData.delegationStatus === 'active' ? 'Active Delegation' : selectedAgentData.delegationStatus === 'expired' ? 'Expired' : 'Will Issue on Submit'}
              </span>
            </dd>
            {selectedAgentData.delegationExpiry && (
              <>
                <dt>Expires</dt>
                <dd>{new Date(selectedAgentData.delegationExpiry).toLocaleString()}</dd>
              </>
            )}
            <dt>Flow</dt>
            <dd style={{ fontSize: '0.8rem', color: '#6b7280' }}>
              DelegationManager.redeemDelegation() → Agent Account → AgentReviewRecord.createReview()
            </dd>
          </dl>
        </div>
      )}

      {/* Review Type */}
      <div data-component="form-field">
        <label htmlFor="type">Review Type</label>
        <select id="type" value={reviewType} onChange={(e) => setReviewType(e.target.value)} data-component="org-select">
          {REVIEW_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Recommendation */}
      <div data-component="form-field">
        <label>Recommendation</label>
        <div data-component="graph-filter" style={{ flexWrap: 'wrap' }}>
          {RECOMMENDATIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRecommendation(r.value)}
              data-component="filter-btn"
              data-active={recommendation === r.value ? 'true' : 'false'}
              style={recommendation === r.value ? { borderColor: r.color, color: r.color } : {}}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overall Score */}
      <div data-component="form-field">
        <label htmlFor="score">Overall Score: {overallScore}/100</label>
        <input
          id="score" type="range" min="0" max="100" value={overallScore}
          onChange={(e) => setOverallScore(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      {/* Dimension Scores */}
      <div data-component="form-field">
        <label>Dimension Scores</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          {DIMENSIONS.map((dim) => (
            <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#6b7280', width: '100px', textTransform: 'capitalize' }}>{dim}</span>
              <input
                type="range" min="0" max="100" value={dimensions[dim]}
                onChange={(e) => setDimension(dim, Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: '0.75rem', width: '30px', textAlign: 'right' }}>{dimensions[dim]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Comment */}
      <div data-component="form-field">
        <label htmlFor="comment">Comment</label>
        <textarea
          id="comment" value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder="Describe your experience with this agent..."
          rows={4}
        />
      </div>

      {error && <p role="alert" data-component="error-message">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Submitting via DelegationManager...' : `Submit Review for ${selectedAgentName}`}
      </button>
    </form>
  )
}
