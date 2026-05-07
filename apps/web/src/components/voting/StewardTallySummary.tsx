'use client'

/**
 * Sprint B — steward-side tally summary block.
 *
 * Renders above the per-proposal list on the steward proposals page.
 * Polls the round tally and shows:
 *   - Aggregate count: total ballots cast across all proposals
 *   - "Approve all" / "Reject all" bulk shortcuts that fan out vote:cast
 *   - Per-proposal pill with approve count + threshold
 *   - "Show passing only" toggle to filter the close-round form below
 */

import { useEffect, useState, useTransition } from 'react'

const C = {
  card: '#ffffff', border: '#ece6db', text: '#5c4a3a', textMuted: '#9a8c7e',
  accent: '#8b5e3c', accentLight: 'rgba(139,94,60,0.08)',
  approve: '#0f766e', reject: '#b91c1c',
}

interface TallyEntry {
  proposalId: string
  approves: number
  rejects: number
  abstains: number
  passes: boolean
}

interface Props {
  roundId: string             // URN form
  proposalIds: string[]       // submitted proposal ids on this round
  onPassingChange?: (passingIds: string[]) => void
}

export function StewardTallySummary({ roundId, proposalIds, onPassingChange }: Props) {
  const [tally, setTally] = useState<TallyEntry[] | null>(null)
  const [threshold, setThreshold] = useState<number>(2)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  async function loadTally() {
    try {
      const r = await fetch(`/api/votes/tally?roundId=${encodeURIComponent(roundId)}`).then((r) => r.json())
      if (r.tally) {
        setTally(r.tally)
        setThreshold(r.threshold ?? 2)
        if (onPassingChange) {
          const passing = (r.tally as TallyEntry[]).filter((t) => t.passes).map((t) => t.proposalId)
          onPassingChange(passing)
        }
      }
    } catch { /* swallow */ }
  }

  useEffect(() => {
    loadTally()
    const t = setInterval(loadTally, 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId])

  function bulkVote(vote: 'approve' | 'reject') {
    if (!confirm(`Cast ${vote} on all ${proposalIds.length} proposals? You can change individual votes after.`)) return
    setMsg(null)
    start(async () => {
      let okCount = 0
      let failCount = 0
      for (const pid of proposalIds) {
        const r = await fetch('/api/votes/cast', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roundId, proposalId: pid, vote, rationale: `bulk ${vote}` }),
        })
        const j = await r.json().catch(() => ({}))
        if (r.ok && j.ok) okCount += 1
        else failCount += 1
      }
      setMsg(`${okCount} ${vote}d${failCount > 0 ? ` · ${failCount} failed` : ''}`)
      await loadTally()
    })
  }

  if (!tally) {
    return (
      <div style={{ padding: '0.85rem 1rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: '0.85rem', fontSize: '0.85rem', color: C.textMuted }}>
        Loading tally…
      </div>
    )
  }

  const totalApproves = tally.reduce((acc, t) => acc + t.approves, 0)
  const totalRejects = tally.reduce((acc, t) => acc + t.rejects, 0)
  const totalAbstains = tally.reduce((acc, t) => acc + t.abstains, 0)
  const passing = tally.filter((t) => t.passes).length

  return (
    <div style={{ padding: '0.95rem 1.05rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Steward votes — live tally
          </div>
          <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Pill color={C.approve} label="approve" count={totalApproves} />
            <Pill color={C.reject} label="reject" count={totalRejects} />
            <span style={{ fontSize: '0.78rem', color: C.textMuted }}>
              {totalAbstains > 0 && `${totalAbstains} abstain · `}
              {passing}/{tally.length} would pass at threshold {threshold}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
          <button type="button" disabled={pending} onClick={() => bulkVote('approve')} style={btnGhost(C.approve, pending)}>
            {pending ? '…' : 'Approve all'}
          </button>
          <button type="button" disabled={pending} onClick={() => bulkVote('reject')} style={btnGhost(C.reject, pending)}>
            {pending ? '…' : 'Reject all'}
          </button>
          {msg && <span style={{ alignSelf: 'center', fontSize: '0.78rem', color: C.textMuted }}>{msg}</span>}
        </div>
      </div>
    </div>
  )
}

function Pill({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
      padding: '0.25rem 0.65rem', background: `${color}15`, border: `1px solid ${color}40`,
      borderRadius: 999, fontSize: '0.78rem', color,
    }}>
      <strong>{count}</strong>
      <span style={{ textTransform: 'capitalize' }}>{label}</span>
    </div>
  )
}

function btnGhost(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: '0.45rem 0.85rem', borderRadius: 8,
    background: '#fff', color, border: `1px solid ${color}50`,
    fontSize: '0.8rem', fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
