'use client'

/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pledge composer (US3).
 *
 * Client form holding the full PoolPledge draft state. POSTs as JSON to the
 * sibling `submit/route.ts`. Fields per data-model.md:
 *   - cadence (one-time / monthly / annual)
 *   - unit (sourced from pool.acceptedUnits)
 *   - amount
 *   - duration (conditional on cadence)
 *   - restrictions (subset checklist sourced from pool.acceptedRestrictions)
 *   - storyPermissions (public / shareWithSupportTeam / anonymous)
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

type Cadence = 'one-time' | 'monthly' | 'annual'
type StoryPermission = 'public' | 'shareWithSupportTeam' | 'anonymous'

interface PoolContext {
  name: string
  domain: string
  visibility: 'public' | 'private'
  acceptedUnits: string[]
  acceptedRestrictions: {
    kinds?: string[]
    geoRoots?: string[]
    notForAdmin?: boolean
    notForDiscretionary?: boolean
  }
  ceilingPolicy: 'block' | 'waitlist' | 'accept'
  capacityCeiling?: number
  pledgedTotal: number
}

export interface PledgeComposerProps {
  hubSlug: string
  poolId: string
  pool: PoolContext
}

export function PledgeComposer(props: PledgeComposerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [cadence, setCadence] = useState<Cadence>('one-time')
  const defaultUnit = props.pool.acceptedUnits[0] ?? 'USD'
  const [unit, setUnit] = useState<string>(defaultUnit)
  const [amount, setAmount] = useState<string>('')
  const [duration, setDuration] = useState<string>('12')
  const [storyPermissions, setStoryPermissions] = useState<StoryPermission>('shareWithSupportTeam')

  const allowedKinds = props.pool.acceptedRestrictions.kinds ?? []
  const allowedGeo = props.pool.acceptedRestrictions.geoRoots ?? []
  const allowsNotForAdmin = !!props.pool.acceptedRestrictions.notForAdmin
  const allowsNotForDiscretionary = !!props.pool.acceptedRestrictions.notForDiscretionary

  const [selectedKinds, setSelectedKinds] = useState<Set<string>>(new Set())
  const [selectedGeo, setSelectedGeo] = useState<Set<string>>(new Set())
  const [restrictNotForAdmin, setRestrictNotForAdmin] = useState(false)
  const [restrictNotForDisc, setRestrictNotForDisc] = useState(false)

  function toggleKind(k: string) {
    setSelectedKinds(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function toggleGeo(g: string) {
    setSelectedGeo(prev => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

  // Derive ceiling-aware total preview.
  const numAmount = Number(amount) || 0
  const numDuration = Number(duration) || 0
  const total = cadence === 'one-time'
    ? numAmount
    : numAmount * Math.max(1, numDuration)

  const isRecurring = cadence === 'monthly' || cadence === 'annual'

  function buildRestrictions() {
    const r: PoolContext['acceptedRestrictions'] = {}
    if (selectedKinds.size > 0) r.kinds = Array.from(selectedKinds)
    if (selectedGeo.size > 0) r.geoRoots = Array.from(selectedGeo)
    if (restrictNotForAdmin) r.notForAdmin = true
    if (restrictNotForDisc) r.notForDiscretionary = true
    if (Object.keys(r).length === 0) return undefined
    return r
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    if (!amount || numAmount <= 0) {
      setSubmitError('Amount must be greater than 0.')
      return
    }
    if (isRecurring && (!duration || numDuration <= 0)) {
      setSubmitError('Recurring pledges require a duration.')
      return
    }

    const payload = {
      poolAgentId: props.poolId,
      cadence,
      unit,
      amount: numAmount,
      duration: isRecurring ? numDuration : undefined,
      restrictions: buildRestrictions(),
      storyPermissions,
      poolVisibility: props.pool.visibility,
    }

    startTransition(async () => {
      try {
        const res = await fetch(
          `/h/${props.hubSlug}/pools/${encodeURIComponent(props.poolId)}/pledge/submit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'follow',
          },
        )
        if (res.redirected) {
          router.push(res.url)
          return
        }
        const json = await res.json()
        if (!json.ok) {
          const errKind = json.error?.kind ?? 'validation'
          let msg = `Submit failed: ${errKind}`
          if (errKind === 'unit-not-accepted') {
            msg = `Unit not accepted. Allowed: ${(json.error.allowedUnits ?? []).join(', ')}`
          } else if (errKind === 'restriction-not-accepted') {
            msg = `Restriction not accepted. Allowed kinds: ${(json.error.allowedRestrictions?.kinds ?? []).join(', ') || '(none)'}`
          } else if (errKind === 'ceiling-blocked') {
            msg = `Pool ceiling reached. Remaining capacity: ${json.error.remainingCapacity}.`
          } else if (errKind === 'private-pool-not-addressed') {
            msg = 'You are not on this private pool’s addressed members list.'
          } else if (json.error?.messages) {
            msg = `Validation: ${(json.error.messages as string[]).join('; ')}`
          }
          setSubmitError(msg)
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Pledge to
        </div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          {props.pool.name}
        </h1>
        <div style={{ fontSize: '0.78rem', color: C.textMuted }}>
          {props.pool.domain} · {props.pool.visibility} pool
        </div>
      </div>

      {submitError && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.65rem 0.85rem',
          background: C.errorBg,
          color: C.errorFg,
          border: `1px solid ${C.errorFg}40`,
          borderRadius: 8,
          fontSize: '0.85rem',
        }}>
          {submitError}
        </div>
      )}

      <Section title="Cadence + amount">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
          {(['one-time', 'monthly', 'annual'] as Cadence[]).map(c => (
            <label key={c} style={{ fontSize: '0.85rem', color: C.text, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="radio" name="cadence" value={c} checked={cadence === c} onChange={() => setCadence(c)} />
              {c}
            </label>
          ))}
        </div>
        <Row label="Amount">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100"
            style={inputStyle}
          />
          <select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ ...inputStyle, marginLeft: '0.4rem' }}>
            {props.pool.acceptedUnits.length === 0 ? (
              <option value="USD">USD</option>
            ) : (
              props.pool.acceptedUnits.map(u => <option key={u} value={u}>{u}</option>)
            )}
          </select>
        </Row>
        {isRecurring && (
          <Row label={cadence === 'monthly' ? 'Duration (months)' : 'Duration (years)'}>
            <input
              type="number"
              min="1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              style={inputStyle}
            />
          </Row>
        )}
        <Row label="Total commitment">
          <span style={{ fontWeight: 600, color: C.accent }}>
            {total > 0 ? `${total} ${unit}` : '—'}
          </span>
        </Row>
      </Section>

      <Section title="Restrictions (optional)">
        {allowedKinds.length === 0 && allowedGeo.length === 0 && !allowsNotForAdmin && !allowsNotForDiscretionary ? (
          <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>
            This pool does not declare an accepted restriction set — your pledge
            is unrestricted.
          </div>
        ) : (
          <>
            {allowedKinds.length > 0 && (
              <Row label="Kinds">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {allowedKinds.map(k => (
                    <label key={k} style={{ fontSize: '0.85rem', color: C.text, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <input type="checkbox" checked={selectedKinds.has(k)} onChange={() => toggleKind(k)} />
                      {k}
                    </label>
                  ))}
                </div>
              </Row>
            )}
            {allowedGeo.length > 0 && (
              <Row label="Geo">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {allowedGeo.map(g => (
                    <label key={g} style={{ fontSize: '0.85rem', color: C.text, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <input type="checkbox" checked={selectedGeo.has(g)} onChange={() => toggleGeo(g)} />
                      {g}
                    </label>
                  ))}
                </div>
              </Row>
            )}
            {allowsNotForAdmin && (
              <Row label="Not for admin">
                <label style={{ fontSize: '0.85rem', color: C.text, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <input type="checkbox" checked={restrictNotForAdmin} onChange={(e) => setRestrictNotForAdmin(e.target.checked)} />
                  Restrict from admin overhead
                </label>
              </Row>
            )}
            {allowsNotForDiscretionary && (
              <Row label="Not discretionary">
                <label style={{ fontSize: '0.85rem', color: C.text, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <input type="checkbox" checked={restrictNotForDisc} onChange={(e) => setRestrictNotForDisc(e.target.checked)} />
                  Restrict from discretionary use
                </label>
              </Row>
            )}
          </>
        )}
      </Section>

      <Section title="Story permissions">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', fontSize: '0.85rem', color: C.text }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
            <input type="radio" name="story" value="public" checked={storyPermissions === 'public'} onChange={() => setStoryPermissions('public')} />
            <span>
              <strong>Public attribution</strong> — your name appears on this pool&rsquo;s public story.
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
            <input type="radio" name="story" value="shareWithSupportTeam" checked={storyPermissions === 'shareWithSupportTeam'} onChange={() => setStoryPermissions('shareWithSupportTeam')} />
            <span>
              <strong>Share with the support team</strong> — pool stewards see you; the public capacity widget reflects your contribution without naming you.
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
            <input type="radio" name="story" value="anonymous" checked={storyPermissions === 'anonymous'} onChange={() => setStoryPermissions('anonymous')} />
            <span>
              <strong>Anonymous</strong> — only you see the pledge. No on-chain anchor; the pool&rsquo;s aggregate widget includes the contribution.
            </span>
          </label>
        </div>
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: '0.65rem 1.25rem',
            background: C.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: '0.9rem',
            fontWeight: 700,
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.7 : 1,
          }}
        >
          {isPending ? 'Submitting…' : 'Submit pledge'}
        </button>
      </div>
    </form>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '0.45rem 0.65rem',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: '0.85rem',
  color: C.text,
  background: '#fff',
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
    <div style={{ display: 'flex', gap: '0.85rem', marginBottom: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
      <div style={{ flex: '0 0 130px', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: C.text }}>
        {children}
      </div>
    </div>
  )
}
