'use client'

/**
 * Sprint A — per-proposal vote panel.
 *
 * Mounted on the proposal detail page (and the steward review page in
 * Sprint B). Shows:
 *   - Eligibility banner (canVote + reason)
 *   - Current ballot (if any) + Change-vote affordance
 *   - Cast-ballot form for eligible voters
 *   - Live tally for the proposal (this proposal only)
 *
 * Tally polls every 5s during the voting window. Submit is fire-and-forget;
 * the view re-fetches eligibility + tally after a successful cast.
 */

import { useEffect, useState, useTransition } from 'react'

type Vote = 'approve' | 'reject' | 'abstain'

interface Tally {
  approves: number
  rejects: number
  abstains: number
  threshold: number
  passes: boolean
}

interface Eligibility {
  canVote: boolean
  weight: number
  reason?: string
  message: string
  threshold: number
  strategy: string
}

interface MyVote {
  vote: Vote
  rationale?: string | null
  castAt: string
  updatedAt: string
}

const C = {
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  approve: '#0f766e',
  reject: '#b91c1c',
  abstain: '#92400e',
  bg: 'rgba(139,94,60,0.04)',
}

function btnStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '0.55rem 1rem',
    borderRadius: 8,
    border: `1px solid ${active ? color : C.border}`,
    background: active ? color : '#fff',
    color: active ? '#fff' : C.text,
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
  }
}

interface Props {
  roundId: string
  proposalId: string
}

export function ProposalVotePanel({ roundId, proposalId }: Props) {
  const [elig, setElig] = useState<Eligibility | null>(null)
  const [eligErr, setEligErr] = useState<string | null>(null)
  const [tally, setTally] = useState<Tally | null>(null)
  const [myVote, setMyVote] = useState<MyVote | null>(null)
  const [vote, setVote] = useState<Vote | null>(null)
  const [rationale, setRationale] = useState('')
  const [pending, start] = useTransition()
  const [castMsg, setCastMsg] = useState<string | null>(null)

  async function refresh() {
    const [eligR, tallyR, myR] = await Promise.all([
      fetch(`/api/votes/eligibility?roundId=${encodeURIComponent(roundId)}`).then((r) => r.json()),
      fetch(`/api/votes/tally?roundId=${encodeURIComponent(roundId)}`).then((r) => r.json()),
      fetch(`/api/votes/my-vote?roundId=${encodeURIComponent(roundId)}&proposalId=${encodeURIComponent(proposalId)}`).then((r) => r.json()),
    ])
    if (eligR.error) { setEligErr(eligR.error); setElig(null) } else { setElig(eligR); setEligErr(null) }
    // Tally: when nobody has voted yet, `tally:[]` is a valid response —
    // render zero counts instead of staying in "Loading tally…". The
    // `proposalId === requested` find can also miss when the tally
    // endpoint returns aggregate-only rows; in that case zeros are still
    // the right empty state.
    if (Array.isArray(tallyR?.tally)) {
      const entry = tallyR.tally.find((t: { proposalId: string }) => t.proposalId === proposalId)
      if (entry) {
        setTally({
          approves: entry.approves, rejects: entry.rejects, abstains: entry.abstains,
          threshold: tallyR.threshold, passes: entry.passes,
        })
      } else {
        setTally({
          approves: 0, rejects: 0, abstains: 0,
          threshold: tallyR.threshold ?? 0, passes: false,
        })
      }
    }
    if (myR && !myR.error && myR.vote) {
      setMyVote(myR)
      setVote(myR.vote)
      setRationale(myR.rationale ?? '')
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(() => refresh(), 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, proposalId])

  function onSubmit() {
    if (!vote) return
    setCastMsg(null)
    start(async () => {
      const r = await fetch('/api/votes/cast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Spec 004 — vote:cast expects the on-chain `proposalSubject`
        // (bytes32 hex). `proposalId` in this component IS that subject
        // (set from the URL on the proposal detail page).
        body: JSON.stringify({ roundId, proposalSubject: proposalId, vote, rationale: rationale.trim() || undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) {
        setCastMsg(`Failed: ${j.error ?? r.status}`)
        return
      }
      setCastMsg(j.status === 'updated' ? 'Vote updated' : 'Vote cast')
      await refresh()
    })
  }

  return (
    <section
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: '1rem 1.1rem', marginBottom: '0.9rem',
      }}
    >
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem' }}>
        Steward votes
      </h2>

      {/* Tally */}
      {tally ? (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.85rem' }}>
          <Pill color={C.approve} label="approve" count={tally.approves} />
          <Pill color={C.reject} label="reject" count={tally.rejects} />
          <Pill color={C.abstain} label="abstain" count={tally.abstains} />
          <div style={{ marginLeft: 'auto', fontSize: '0.78rem', color: C.textMuted }}>
            {tally.passes
              ? `Awarded — ${tally.approves} / ${tally.threshold} required`
              : `Pending — ${tally.approves} / ${tally.threshold} approves`}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.65rem' }}>Loading tally…</div>
      )}

      {/* Eligibility */}
      <div style={{
        background: C.bg, padding: '0.6rem 0.75rem', borderRadius: 8, fontSize: '0.8rem', color: C.text,
        marginBottom: elig?.canVote ? '0.85rem' : 0,
      }}>
        {eligErr ? `Couldn't load eligibility: ${eligErr}`
         : elig?.message ?? 'Checking eligibility…'}
        {elig && !elig.canVote && elig.reason && (
          <div style={{ marginTop: '0.25rem', fontSize: '0.72rem', color: C.textMuted }}>
            reason: <code>{elig.reason}</code>
            {elig.reason === 'voting-not-started' && ' — voting opens after the submission deadline'}
            {elig.reason === 'voting-closed' && ' — voting window has ended'}
          </div>
        )}
      </div>

      {/* Cast / change ballot — only when eligible */}
      {elig?.canVote && (
        <div>
          {myVote && (
            <div style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.55rem' }}>
              Your current vote: <strong style={{ color: C.text }}>{myVote.vote}</strong> · cast {new Date(myVote.castAt).toLocaleString()}
              {myVote.updatedAt !== myVote.castAt && ` · updated ${new Date(myVote.updatedAt).toLocaleString()}`}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.65rem' }}>
            <button type="button" onClick={() => setVote('approve')} style={btnStyle(vote === 'approve', C.approve)}>Approve</button>
            <button type="button" onClick={() => setVote('reject')} style={btnStyle(vote === 'reject', C.reject)}>Reject</button>
            <button type="button" onClick={() => setVote('abstain')} style={btnStyle(vote === 'abstain', C.abstain)}>Abstain</button>
          </div>
          <textarea
            placeholder="Optional rationale (1-2 lines)"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={2}
            style={{
              width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem',
              border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: '#fff',
              resize: 'vertical', marginBottom: '0.55rem',
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!vote || pending}
              style={{
                padding: '0.6rem 1.1rem', borderRadius: 8,
                background: vote && !pending ? C.accent : '#cfc4b3',
                color: '#fff', border: 'none', fontSize: '0.85rem', fontWeight: 700,
                cursor: vote && !pending ? 'pointer' : 'not-allowed',
              }}
            >
              {pending ? 'Submitting…' : myVote ? 'Update vote' : 'Cast vote'}
            </button>
            {castMsg && <span style={{ fontSize: '0.78rem', color: C.textMuted }}>{castMsg}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function Pill({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
      padding: '0.25rem 0.6rem', background: `${color}15`, border: `1px solid ${color}40`,
      borderRadius: 999, fontSize: '0.78rem', color,
    }}>
      <strong>{count}</strong>
      <span style={{ textTransform: 'capitalize' }}>{label}</span>
    </div>
  )
}
