'use client'

/**
 * Round Create wizard form. Posts JSON to the sibling submit/route.ts
 * which calls openRound() server action.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  errorBg: '#fef2f2',
  errorFg: '#991b1b',
}

const CADENCE_OPTIONS = ['monthly', 'quarterly', 'annual', 'milestone', 'none'] as const

export interface EligiblePool {
  /** URN identifier for this pool (urn:smart-agent:pool:<slug>). */
  poolAgentId: string
  /** Hex address of the pool's on-chain AgentAccount. Becomes BOTH the
   *  round's `poolAgent` AND its `fundAgent` (operator) under the
   *  unified-governance rule. */
  poolAgentAddress: string
  name: string
  acceptedKinds: string[]
  acceptedGeo: string[]
}

interface Props {
  hubSlug: string
  pools: EligiblePool[]
}

const isoDateInputToDateTime = (s: string): string => s ? new Date(s + 'T00:00:00Z').toISOString() : ''

export function RoundCreateForm({ hubSlug, pools }: Props) {
  const router = useRouter()
  const [pickedPoolId, setPickedPoolId] = useState(pools[0]?.poolAgentId ?? '')
  const [slug, setSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [acceptedKinds, setAcceptedKinds] = useState(pools[0]?.acceptedKinds.join(', ') ?? '')
  const [acceptedGeo, setAcceptedGeo] = useState(pools[0]?.acceptedGeo.join(', ') ?? 'us/colorado')
  const [budgetCeiling, setBudgetCeiling] = useState('250000')
  const [expectedAwards, setExpectedAwards] = useState('6')
  const [reportingCadence, setReportingCadence] = useState<typeof CADENCE_OPTIONS[number]>('quarterly')
  const today = new Date()
  const fortnight = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const month = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [deadline, setDeadline] = useState(fortnight)
  const [decisionDate, setDecisionDate] = useState(month)
  // Voting strategy config (Sprint B). Defaults match the steward-quorum
  // 2-of-3 + 7-day window decided up-front.
  const [votingStrategy, setVotingStrategy] = useState<'steward-quorum' | 'member-approval' | 'quadratic' | 'ranked-choice'>('steward-quorum')
  const [votingThreshold, setVotingThreshold] = useState(2)
  const [votingWindowDays, setVotingWindowDays] = useState(7)
  // Validator EOA(s) — comma-separated 0x… addresses. Each address ends
  // up in `sa:roundValidatorRequirements` on the round subject; the tasks
  // inbox uses this list to surface attestation tasks to those EOAs.
  // v1 supports any number of validators; UI hint is single-address per
  // line. Empty = no validator required (legacy "any steward" behavior).
  const [validatorEoas, setValidatorEoas] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // When a different pool is picked, prefill the kind/geo lists from that pool's mandate.
  function pickPool(id: string) {
    setPickedPoolId(id)
    const p = pools.find(x => x.poolAgentId === id)
    if (p) {
      setAcceptedKinds(p.acceptedKinds.join(', '))
      setAcceptedGeo(p.acceptedGeo.join(', '))
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!pickedPoolId) { setError('Pick a pool first.'); return }
    if (!slug.trim() || !displayName.trim()) { setError('Slug and display name are required.'); return }
    if (!/^[a-z0-9-]+$/.test(slug)) { setError('Slug must be lowercase letters, digits, and dashes only.'); return }

    const pool = pools.find(p => p.poolAgentId === pickedPoolId)!
    const kinds = acceptedKinds.split(',').map(s => s.trim()).filter(Boolean)
    if (kinds.length === 0) {
      setError('Enter at least one accepted kind — e.g. "trauma-care, CompassionMinistry". This defines what proposals the round will consider.')
      return
    }
    const geo = acceptedGeo.split(',').map(s => s.trim()).filter(Boolean)
    const ceiling = Number(budgetCeiling)
    const awards = Number(expectedAwards)
    const validators = validatorEoas
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    for (const v of validators) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
        setError(`Validator EOA "${v}" is not a valid 0x address.`)
        return
      }
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/h/${hubSlug}/rounds/new/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: slug,
            displayName,
            // Unified governance: operator = pool. Both fundAgent and
            // poolAgent point at the pool's AgentAccount. Pool owners are
            // the round's operators by inheritance.
            fundAgentId: pool.poolAgentAddress,
            poolAgentId: pool.poolAgentAddress,
            mandate: {
              acceptedKinds: kinds,
              acceptedGeo: geo,
              budgetCeiling: Number.isFinite(ceiling) ? ceiling : 0,
              expectedAwards: Number.isFinite(awards) ? awards : 1,
            },
            reportingCadence,
            deadline: isoDateInputToDateTime(deadline),
            decisionDate: isoDateInputToDateTime(decisionDate),
            visibility: 'public',
            requiredCredentials: [],
            votingStrategy,
            votingThreshold,
            votingWindowDays,
            validators,
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(j.error ?? `Open failed: ${res.status}`)
          return
        }
        router.push(`/h/${hubSlug}/rounds/${encodeURIComponent(slug)}`)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  function field(label: string, child: React.ReactNode) {
    return (
      <label style={{ display: 'block', marginBottom: '0.7rem' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: C.text, marginBottom: '0.25rem' }}>
          {label}
        </div>
        {child}
      </label>
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.45rem 0.6rem',
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    fontSize: '0.85rem',
    background: '#fff',
    color: C.text,
  }

  return (
    <form onSubmit={onSubmit} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1.1rem 1.2rem', maxWidth: '38rem' }}>
      {field('Pool this round draws from', (
        <>
          <select value={pickedPoolId} onChange={e => pickPool(e.target.value)} style={inputStyle}>
            {pools.map(p => <option key={p.poolAgentId} value={p.poolAgentId}>{p.name}</option>)}
          </select>
          <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.25rem' }}>
            The pool&apos;s owners (you + the org that anchors the pool) become this
            round&apos;s operators — they can edit voting config, open / close voting,
            and finalize awards.
          </div>
        </>
      ))}
      {field('Round slug (lowercase, dash-separated)', (
        <input type="text" value={slug} onChange={e => setSlug(e.target.value)} placeholder="demo-trauma-care-q3" style={inputStyle} required />
      ))}
      {field('Display name', (
        <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Trauma-Care for Migrant Families — Q3" style={inputStyle} required />
      ))}
      {field('Accepted kinds (comma-separated)', (
        <>
          <input type="text" value={acceptedKinds} onChange={e => setAcceptedKinds(e.target.value)} placeholder="trauma-care, CompassionMinistry" style={inputStyle} />
          {!acceptedKinds.trim() && pickedPoolId && (
            <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.3rem' }}>
              This pool has no preset kinds. Add at least one to define what proposals are eligible.
            </div>
          )}
        </>
      ))}
      {field('Accepted geo (comma-separated)', (
        <input type="text" value={acceptedGeo} onChange={e => setAcceptedGeo(e.target.value)} placeholder="us/colorado" style={inputStyle} />
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
        {field('Budget ceiling ($)', (
          <input type="number" min={0} value={budgetCeiling} onChange={e => setBudgetCeiling(e.target.value)} style={inputStyle} />
        ))}
        {field('Expected awards', (
          <input type="number" min={1} value={expectedAwards} onChange={e => setExpectedAwards(e.target.value)} style={inputStyle} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
        {field('Submission deadline', (
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} style={inputStyle} required />
        ))}
        {field('Decision date', (
          <input type="date" value={decisionDate} onChange={e => setDecisionDate(e.target.value)} style={inputStyle} required />
        ))}
      </div>
      {field('Reporting cadence', (
        <select value={reportingCadence} onChange={e => setReportingCadence(e.target.value as typeof CADENCE_OPTIONS[number])} style={inputStyle}>
          {CADENCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}

      {/* Validators — comma-separated 0x… EOAs */}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '0.85rem', marginTop: '0.55rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.55rem' }}>
          Validators
        </div>
        {field('Validator EOA(s) — comma-separated 0x addresses', (
          <>
            <input
              type="text"
              value={validatorEoas}
              onChange={e => setValidatorEoas(e.target.value)}
              placeholder="0xabc…, 0xdef…"
              style={inputStyle}
            />
            <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.25rem' }}>
              Each validator attests milestone delivery on chain before the steward
              can release the matching tranche. Leave empty to fall back to
              steward-only attestation.
            </div>
          </>
        ))}
      </div>

      {/* Voting strategy config (Sprint B) */}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '0.85rem', marginTop: '0.55rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.55rem' }}>
          Steward voting
        </div>
        {field('Voting strategy', (
          <select value={votingStrategy} onChange={e => setVotingStrategy(e.target.value as typeof votingStrategy)} style={inputStyle}>
            <option value="steward-quorum">Steward quorum (N approvals)</option>
            <option value="member-approval" disabled>Member approval (coming soon)</option>
            <option value="quadratic" disabled>Quadratic (coming soon)</option>
            <option value="ranked-choice" disabled>Ranked choice (coming soon)</option>
          </select>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
          {field('Approvals required', (
            <input type="number" min={1} max={20} value={votingThreshold} onChange={e => setVotingThreshold(parseInt(e.target.value || '0', 10) || 0)} style={inputStyle} />
          ))}
          {field('Voting window (days post-deadline)', (
            <input type="number" min={1} max={60} value={votingWindowDays} onChange={e => setVotingWindowDays(parseInt(e.target.value || '0', 10) || 0)} style={inputStyle} />
          ))}
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '0.7rem', padding: '0.5rem 0.7rem', background: C.errorBg, color: C.errorFg, borderRadius: 6, fontSize: '0.78rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={isPending}
          style={{ padding: '0.55rem 1.1rem', background: C.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
        >
          {isPending ? 'Opening…' : 'Open round'}
        </button>
      </div>
    </form>
  )
}
