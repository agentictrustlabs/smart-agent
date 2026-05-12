'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const C = {
  card: '#ffffff', border: '#ece6db', text: '#5c4a3a', textMuted: '#9a8c7e',
  accent: '#8b5e3c', accentLight: 'rgba(139,94,60,0.08)',
  ok: '#0f766e', danger: '#b91c1c',
  bg: 'rgba(139,94,60,0.04)',
}

type Tab = 'config' | 'lifecycle' | 'tally' | 'voters'

interface RoundView {
  id: string                       // URN form
  status: string
  deadline: string
  decisionDate: string
  votingStrategy: string
  votingThreshold: number
  votingWindowStartsAt: string | null
  votingWindowEndsAt: string | null
}

interface TallyRow {
  proposalId: string
  approves: number
  rejects: number
  abstains: number
  passes: boolean
}

interface Props {
  hubSlug: string
  round: RoundView
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open — accepting submissions',
  review: 'Review — voting',
  decided: 'Decided — awards committed',
  closed: 'Closed',
  canceled: 'Canceled',
}

const NEXT_LIFECYCLE_ACTIONS: Array<{ from: string; to: string; label: string; action: 'advance-to-review' | 'advance-to-decided' | 'advance-to-closed' | 'cancel'; danger?: boolean }> = [
  { from: 'open',    to: 'review',   action: 'advance-to-review',  label: 'Close submissions, open voting' },
  { from: 'review',  to: 'decided',  action: 'advance-to-decided', label: 'Finalize awards' },
  { from: 'decided', to: 'closed',   action: 'advance-to-closed',  label: 'Mark round closed (post-dispute window)' },
]

export function RoundAdminClient({ hubSlug, round: initial }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('config')
  const [round, setRound] = useState<RoundView>(initial)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  // ─── Config form state ─────────────────────────────────────────
  const [strategy, setStrategy] = useState(round.votingStrategy)
  const [threshold, setThreshold] = useState(round.votingThreshold)
  const [windowStart, setWindowStart] = useState(round.votingWindowStartsAt ?? '')
  const [windowEnd, setWindowEnd] = useState(round.votingWindowEndsAt ?? '')

  // ─── Tally polling ─────────────────────────────────────────────
  const [tally, setTally] = useState<TallyRow[] | null>(null)
  useEffect(() => {
    if (tab !== 'tally') return
    let cancelled = false
    async function load() {
      try {
        const r = await fetch(`/api/votes/tally?roundId=${encodeURIComponent(round.id)}`).then((r) => r.json())
        if (!cancelled && r.tally) setTally(r.tally)
      } catch { /* swallow */ }
    }
    load()
    const t = setInterval(load, 5000)
    return () => { cancelled = true; clearInterval(t) }
  }, [tab, round.id])

  /** Save voting config. Accepts explicit overrides so quick-action buttons
   *  ("Open voting now") can call us with the just-computed values without
   *  waiting for React to flush a state update + re-render. Without
   *  overrides we'd close over stale `windowStart`/`windowEnd` from the
   *  render in which `saveConfig` was defined. */
  function saveConfig(opts?: {
    windowStart?: string
    windowEnd?: string
    strategy?: string
    threshold?: number
  }) {
    setMsg(null)
    const wStart = opts?.windowStart ?? windowStart
    const wEnd = opts?.windowEnd ?? windowEnd
    const strat = opts?.strategy ?? strategy
    const thresh = opts?.threshold ?? threshold
    start(async () => {
      const r = await fetch('/api/round-admin/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roundFullId: round.id,
          votingStrategy: strat,
          votingThreshold: thresh,
          votingWindowStartsAt: wStart || undefined,
          votingWindowEndsAt: wEnd || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setMsg(`Failed: ${j.error ?? r.status}`); return }
      setMsg('Saved.')
      setRound((prev) => ({ ...prev, votingStrategy: strat, votingThreshold: thresh, votingWindowStartsAt: wStart || null, votingWindowEndsAt: wEnd || null }))
      router.refresh()
    })
  }

  function finalizeFromTally() {
    setMsg(null)
    start(async () => {
      const r = await fetch('/api/round-admin/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roundFullId: round.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setMsg(`Failed: ${j.error ?? r.status}`); return }
      setMsg(`Awards committed — ${j.winnerCount} winner${j.winnerCount === 1 ? '' : 's'}. Status → decided.`)
      setRound((prev) => ({ ...prev, status: 'decided' }))
      router.refresh()
    })
  }

  function advance(action: typeof NEXT_LIFECYCLE_ACTIONS[number]['action'] | 'cancel') {
    setMsg(null)
    start(async () => {
      const r = await fetch('/api/round-admin/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roundFullId: round.id, action }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setMsg(`Failed: ${j.error ?? r.status}`); return }
      setMsg(`Status → ${j.newStatus}.`)
      setRound((prev) => ({ ...prev, status: j.newStatus }))
      router.refresh()
    })
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '1.25rem' }}>
      {/* Tab nav */}
      <div style={{ display: 'flex', gap: '0.4rem', borderBottom: `1px solid ${C.border}`, marginBottom: '1rem' }}>
        {(['config', 'lifecycle', 'tally', 'voters'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '0.55rem 1.05rem',
              background: tab === t ? C.accentLight : 'transparent',
              color: tab === t ? C.accent : C.textMuted,
              fontSize: '0.85rem', fontWeight: 700,
              border: 'none', borderBottom: tab === t ? `2px solid ${C.accent}` : '2px solid transparent',
              borderRadius: '6px 6px 0 0', cursor: 'pointer', textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Status banner */}
      <div style={{ background: C.bg, borderRadius: 8, padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.85rem', color: C.text }}>
        Current status: <strong>{STATUS_LABEL[round.status] ?? round.status}</strong>
      </div>

      {tab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxWidth: '32rem' }}>
          <div>
            <label style={labelStyle}>Voting strategy</label>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} style={fieldStyle}>
              <option value="steward-quorum">Steward quorum (N approvals)</option>
              <option value="member-approval" disabled>Member approval (coming soon)</option>
              <option value="quadratic" disabled>Quadratic (coming soon)</option>
              <option value="ranked-choice" disabled>Ranked choice (coming soon)</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Approvals required (threshold)</label>
            <input type="number" min={1} max={20} value={threshold} onChange={(e) => setThreshold(parseInt(e.target.value || '0', 10) || 0)} style={fieldStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
            <div>
              <label style={labelStyle}>Voting opens (ISO)</label>
              <input type="datetime-local" value={windowStart ? toLocalInput(windowStart) : ''} onChange={(e) => setWindowStart(fromLocalInput(e.target.value))} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Voting closes (ISO)</label>
              <input type="datetime-local" value={windowEnd ? toLocalInput(windowEnd) : ''} onChange={(e) => setWindowEnd(fromLocalInput(e.target.value))} style={fieldStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem', flexWrap: 'wrap' }}>
            <button type="button" disabled={pending} onClick={() => saveConfig()} style={btnPrimary(pending)}>{pending ? 'Saving…' : 'Save config'}</button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                // Set voting window to start NOW and close 7 days later.
                // Shortcut for testing or stewards who want to skip ahead
                // of the original deadline. Doesn't touch the on-chain
                // submission deadline — that's immutable. Saves through
                // the same `round:update_voting_config` MCP path.
                const now = new Date()
                const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
                const wStart = now.toISOString()
                const wEnd = end.toISOString()
                setWindowStart(wStart)
                setWindowEnd(wEnd)
                // Pass values explicitly to bypass the stale-closure trap
                // (the old setTimeout(saveConfig, 0) captured the previous
                // render's empty window values).
                saveConfig({ windowStart: wStart, windowEnd: wEnd })
              }}
              style={{
                padding: '0.5rem 0.85rem',
                background: '#fff',
                color: '#8b5e3c',
                border: '1px solid #8b5e3c',
                borderRadius: 6,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: pending ? 'not-allowed' : 'pointer',
              }}
              title="Sets voting window to start now and close 7 days from now. Useful for testing or to skip ahead of the original deadline."
            >
              Open voting now (next 7d)
            </button>
            {msg && <span style={{ fontSize: '0.8rem', color: C.textMuted }}>{msg}</span>}
          </div>
        </div>
      )}

      {tab === 'lifecycle' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '36rem' }}>
          {NEXT_LIFECYCLE_ACTIONS
            .filter((a) => round.status === a.from)
            .map((a) => (
              <button key={a.action} type="button" disabled={pending} onClick={() => advance(a.action)} style={btnPrimary(pending)}>
                {pending ? 'Working…' : a.label}
              </button>
            ))}

          {round.status === 'review' && (
            <button type="button" disabled={pending} onClick={() => {
              if (confirm('Finalize awards from current vote tally? This commits the awards Merkle root on chain and opens the 72h dispute window.')) finalizeFromTally()
            }} style={btnPrimary(pending)}>
              {pending ? 'Working…' : 'Finalize awards from tally'}
            </button>
          )}

          {round.status !== 'closed' && round.status !== 'canceled' && (
            <button type="button" disabled={pending} onClick={() => {
              if (confirm('Cancel this round? This is reversible only by re-opening with a new round id.')) advance('cancel')
            }} style={btnDanger(pending)}>
              {pending ? 'Working…' : 'Cancel round'}
            </button>
          )}
          {msg && <span style={{ fontSize: '0.8rem', color: C.textMuted }}>{msg}</span>}
          <p style={{ fontSize: '0.78rem', color: C.textMuted, lineHeight: 1.5, marginTop: '0.6rem' }}>
            Lifecycle transitions write to chain via <code>FundRegistry.setRoundStatus</code> and mirror to the cache.
            <br />
            <Link href={`/h/${hubSlug}/rounds/${round.id.replace('urn:smart-agent:round:', '')}/proposals`} style={{ color: C.accent }}>
              Steward proposals view →
            </Link>
          </p>
        </div>
      )}

      {tab === 'voters' && (
        <VotersTab roundId={round.id} />
      )}

      {tab === 'tally' && (
        <div>
          {tally === null ? (
            <p style={{ fontSize: '0.85rem', color: C.textMuted }}>Loading tally…</p>
          ) : tally.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: C.textMuted }}>No proposals on this round yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={thStyle}>Proposal</th>
                  <th style={thStyleRight}>Approve</th>
                  <th style={thStyleRight}>Reject</th>
                  <th style={thStyleRight}>Abstain</th>
                  <th style={thStyleRight}>Result</th>
                </tr>
              </thead>
              <tbody>
                {tally.map((row) => (
                  <tr key={row.proposalId} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={tdStyle}>
                      <Link href={`/h/${hubSlug}/proposals/${row.proposalId}`} style={{ color: C.accent }}>
                        {row.proposalId.split(':').pop() ?? row.proposalId.slice(0, 12)}
                      </Link>
                    </td>
                    <td style={tdRight}>{row.approves}</td>
                    <td style={tdRight}>{row.rejects}</td>
                    <td style={tdRight}>{row.abstains}</td>
                    <td style={{ ...tdRight, color: row.passes ? C.ok : C.textMuted, fontWeight: 600 }}>
                      {row.passes ? `Awarded (${row.approves}/${round.votingThreshold})` : `Pending (${row.approves}/${round.votingThreshold})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function Link({ href, children, style }: { href: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return <a href={href} style={style}>{children}</a>
}

function VotersTab({ roundId }: { roundId: string }) {
  const [voter, setVoter] = useState('')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [msgKind, setMsgKind] = useState<'ok' | 'err'>('ok')

  function onAdd(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const target = voter.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
      setMsg('Enter the voter\'s smart-account address (0x… 40 hex chars).')
      setMsgKind('err')
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/round-admin/add-voter', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roundId, voterSmartAccount: target }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || json.ok === false) {
          setMsgKind('err')
          setMsg(`Failed: ${json.error ?? res.statusText}`)
          return
        }
        setMsgKind('ok')
        setMsg(`Voter added (credentialId: ${(json.credentialId ?? '').slice(0, 12)}…). They can now vote in this round from their own session.`)
        setVoter('')
      } catch (err) {
        setMsgKind('err')
        setMsg(`Failed: ${(err as Error).message}`)
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxWidth: '36rem' }}>
      <p style={{ fontSize: '0.85rem', color: C.text, margin: 0, lineHeight: 1.5 }}>
        Grant another person agent permission to vote in this round. Issues a
        <code style={{ background: C.bg, padding: '0 0.3rem', borderRadius: 4, margin: '0 0.3rem' }}>RoundVoterCredential</code>
        to the voter's person-mcp plus an on-chain admin→holder delegation
        scoped to <code style={{ background: C.bg, padding: '0 0.3rem', borderRadius: 4, margin: '0 0.3rem' }}>VoteRegistry.castVote</code>
        for this round only.
      </p>
      <form onSubmit={onAdd} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div>
          <label style={labelStyle}>Voter smart-account address</label>
          <input
            value={voter}
            onChange={(e) => setVoter(e.target.value)}
            placeholder="0x…40 hex chars"
            style={fieldStyle}
            spellCheck={false}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button type="submit" disabled={pending} style={btnPrimary(pending)}>
            {pending ? 'Adding…' : 'Add voter'}
          </button>
          {msg && (
            <span style={{ fontSize: '0.8rem', color: msgKind === 'err' ? C.danger : C.ok }}>
              {msg}
            </span>
          )}
        </div>
      </form>
      <p style={{ fontSize: '0.75rem', color: C.textMuted, margin: 0, lineHeight: 1.5 }}>
        v1 limitation: there's no "currently approved voters" list yet —
        ballots are nullifier-keyed on chain so we can't enumerate holders
        without per-voter cred lookups. Adding the same voter twice issues
        two credentials (idempotent at the cast level — only the first vote
        per round counts).
      </p>
    </div>
  )
}

function toLocalInput(iso: string): string {
  // datetime-local needs YYYY-MM-DDTHH:mm — drop the seconds + Z.
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(local: string): string {
  if (!local) return ''
  return new Date(local).toISOString()
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted,
  marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em',
}
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem',
  border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: '#fff',
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '0.5rem 0.4rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textMuted }
const thStyleRight: React.CSSProperties = { ...thStyle, textAlign: 'right' }
const tdStyle: React.CSSProperties = { padding: '0.55rem 0.4rem', color: C.text }
const tdRight: React.CSSProperties = { ...tdStyle, textAlign: 'right' }

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.6rem 1.1rem', borderRadius: 8,
    background: disabled ? '#cfc4b3' : C.accent, color: '#fff',
    border: 'none', fontSize: '0.85rem', fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
function btnDanger(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.6rem 1.1rem', borderRadius: 8,
    background: '#fff', color: C.danger,
    border: `1px solid ${C.danger}`, fontSize: '0.85rem', fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
