'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { expressIntent, type IntentDirection } from '@/lib/actions/intents.action'

const C = {
  card: '#ffffff', border: '#ece6db', text: '#5c4a3a', textMuted: '#9a8c7e',
  accent: '#8b5e3c', accentLight: 'rgba(139,94,60,0.10)',
  receiveBg: 'rgba(13,148,136,0.06)',  receiveFg: '#0f766e',  receiveBorder: 'rgba(13,148,136,0.20)',
  giveBg:    'rgba(217,119,6,0.06)',    giveFg:    '#92400e',  giveBorder:    'rgba(217,119,6,0.25)',
}

interface IntentTypeMeta {
  uri: string
  label: string
  direction: IntentDirection
  object: string             // resourceType:* concept URI
  hint: string
}

// Curated leaf vocabulary — mirrors cbox/intent-types.ttl.
// The ordering inside each group is editorial: most-common cases first.
const RECEIVE_TYPES: IntentTypeMeta[] = [
  { uri: 'intentType:NeedHelp',         label: 'Need help',           direction: 'receive', object: 'resourceType:Worker',  hint: 'Someone to lend a hand' },
  { uri: 'intentType:NeedCoaching',     label: 'Need coaching',       direction: 'receive', object: 'resourceType:Worker',  hint: 'A coach or mentor' },
  { uri: 'intentType:NeedInformation',  label: 'Need information',    direction: 'receive', object: 'resourceType:Data',    hint: 'I need to know X' },
  { uri: 'intentType:NeedFunding',      label: 'Need funding',        direction: 'receive', object: 'resourceType:Money',   hint: 'Money for a project' },
  { uri: 'intentType:NeedScripture',    label: 'Need scripture',      direction: 'receive', object: 'resourceType:Scripture', hint: 'Heart-language scripture access' },
  { uri: 'intentType:NeedVenue',        label: 'Need venue',          direction: 'receive', object: 'resourceType:Venue',   hint: 'A place to gather' },
  { uri: 'intentType:NeedConnector',    label: 'Need an introduction', direction: 'receive', object: 'resourceType:Connector', hint: 'Who can introduce me to X?' },
  { uri: 'intentType:NeedTreasurer',    label: 'Need treasurer',      direction: 'receive', object: 'resourceType:Worker',  hint: 'A financial steward' },
  { uri: 'intentType:NeedSafePlace',    label: 'Need safe place',     direction: 'receive', object: 'resourceType:Venue',   hint: 'Sensitive — short-term housing/refuge' },
  { uri: 'intentType:NeedTraumaCare',   label: 'Need trauma care',    direction: 'receive', object: 'resourceType:Worker',  hint: 'Sensitive — trauma-informed care provider' },
]
const GIVE_TYPES: IntentTypeMeta[] = [
  { uri: 'intentType:WantToContribute', label: 'Want to contribute',  direction: 'give', object: 'resourceType:Worker',     hint: 'Place me where useful' },
  { uri: 'intentType:OfferSkill',       label: 'Offer a skill',        direction: 'give', object: 'resourceType:Skill',      hint: 'A capability you carry' },
  { uri: 'intentType:OfferIntroduction',label: 'Offer introduction',   direction: 'give', object: 'resourceType:Connector',  hint: 'Who you can introduce to' },
  { uri: 'intentType:OfferInformation', label: 'Offer information',    direction: 'give', object: 'resourceType:Data',       hint: 'Research / data / answers — ask me' },
  { uri: 'intentType:OfferPrayer',      label: 'Offer prayer',         direction: 'give', object: 'resourceType:Prayer',     hint: 'Adopted, scheduled intercession' },
  { uri: 'intentType:OfferFunding',     label: 'Offer funding',        direction: 'give', object: 'resourceType:Money',      hint: 'Funding capacity' },
  { uri: 'intentType:OfferVenue',       label: 'Offer venue',          direction: 'give', object: 'resourceType:Venue',      hint: 'Hosting capacity' },
  { uri: 'intentType:OfferTeaching',    label: 'Offer teaching',       direction: 'give', object: 'resourceType:Curriculum', hint: 'Curriculum / training material' },
]

const SENSITIVE_TYPES = new Set(['intentType:NeedSafePlace', 'intentType:NeedTraumaCare'])

interface Props {
  hubId: string
  hubSlug: string
  eligibleAgents: { address: string; label: string }[]
}

export function ExpressIntentForm({ hubId, hubSlug, eligibleAgents }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  // Form state
  const [direction, setDirection] = useState<IntentDirection | null>(null)
  const [intentType, setIntentType] = useState<IntentTypeMeta | null>(null)
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [detail, setDetail] = useState('')
  const [priority, setPriority] = useState<'critical' | 'high' | 'normal' | 'low'>('normal')
  const [expressedByAgent, setExpressedByAgent] = useState(eligibleAgents[0]?.address ?? '')
  const [addressedTo, setAddressedTo] = useState<string>(`hub:${hubId}`)
  const [requirementGeo, setRequirementGeo] = useState('')
  const [requirementSkill, setRequirementSkill] = useState('')
  const [requirementRole, setRequirementRole] = useState('')
  const [outcomeDescription, setOutcomeDescription] = useState('')
  const [outcomeKind, setOutcomeKind] = useState<'count' | 'boolean' | 'date' | 'narrative'>('narrative')
  const [outcomeTarget, setOutcomeTarget] = useState('')

  const types = useMemo(() => direction === 'receive' ? RECEIVE_TYPES : direction === 'give' ? GIVE_TYPES : null, [direction])
  const sensitive = intentType ? SENSITIVE_TYPES.has(intentType.uri) : false

  function onSubmit() {
    setErr(null)
    if (!direction || !intentType) { setErr('Pick a direction and an intent type'); return }
    if (!title.trim()) { setErr('Title required'); return }
    if (!expressedByAgent) { setErr('Pick who expresses this intent'); return }

    start(async () => {
      const payload: Record<string, unknown> = {}
      if (requirementGeo) payload.geo = requirementGeo
      if (requirementSkill) payload.skill = requirementSkill
      if (requirementRole) payload.role = requirementRole

      const expectedOutcome = outcomeDescription.trim()
        ? {
            description: outcomeDescription.trim(),
            metric: {
              kind: outcomeKind,
              target: outcomeTarget || undefined,
            },
          }
        : undefined

      const res = await expressIntent({
        direction: intentType.direction,
        object: intentType.object,
        topic: topic || undefined,
        intentType: intentType.uri,
        intentTypeLabel: intentType.label,
        expressedByAgent,
        addressedTo,
        hubId,
        title: title.trim(),
        detail: detail.trim() || undefined,
        priority,
        visibility: sensitive ? 'private' : 'public',
        payload: Object.keys(payload).length ? payload : undefined,
        expectedOutcome,
      })
      if ('error' in res) setErr(res.error)
      else router.push(`/h/${hubSlug}/intents/${res.id}`)
    })
  }

  const fieldStyle = { width: '100%', padding: '0.45rem 0.6rem', fontSize: '0.85rem', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: '#fff' } as const
  const labelStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' } as const

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '1.25rem' }}>
      {/* Step 1 — direction */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={labelStyle}>Step 1 — Which direction?</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginTop: '0.4rem' }}>
          <DirectionTile
            active={direction === 'receive'}
            bg={C.receiveBg} fg={C.receiveFg} border={C.receiveBorder}
            icon="📥" label="Receive" sub="I need / I'm asking for…"
            onClick={() => { setDirection('receive'); setIntentType(null) }}
          />
          <DirectionTile
            active={direction === 'give'}
            bg={C.giveBg} fg={C.giveFg} border={C.giveBorder}
            icon="📤" label="Give" sub="I'm offering / contributing…"
            onClick={() => { setDirection('give'); setIntentType(null) }}
          />
        </div>
      </div>

      {/* Step 2 — intent type */}
      {types && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={labelStyle}>Step 2 — Which kind?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.45rem', marginTop: '0.4rem' }}>
            {types.map(t => (
              <button
                key={t.uri}
                type="button"
                onClick={() => setIntentType(t)}
                style={{
                  textAlign: 'left',
                  background: intentType?.uri === t.uri
                    ? (direction === 'receive' ? C.receiveBg : C.giveBg)
                    : '#fafaf6',
                  border: `1px solid ${
                    intentType?.uri === t.uri
                      ? (direction === 'receive' ? C.receiveBorder : C.giveBorder)
                      : C.border
                  }`,
                  borderRadius: 8,
                  padding: '0.55rem 0.7rem',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: C.text }}>
                  {t.label}
                  {SENSITIVE_TYPES.has(t.uri) && (
                    <span style={{ marginLeft: '0.3rem', fontSize: '0.6rem', color: '#991b1b', fontWeight: 700 }}>SENSITIVE</span>
                  )}
                </div>
                <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.1rem', lineHeight: 1.3 }}>{t.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3 — details */}
      {intentType && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.7rem', marginBottom: '1rem' }}>
            <div>
              <label style={labelStyle}>Title — one sentence</label>
              <input style={fieldStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder={direction === 'receive' ? "What do you need?" : "What are you offering?"} />
            </div>
            <div>
              <label style={labelStyle}>Topic / scope (optional)</label>
              <input style={fieldStyle} value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. unreached people groups in NoCo, well-water filter project" />
            </div>
            <div>
              <label style={labelStyle}>Detail (optional)</label>
              <textarea style={{ ...fieldStyle, fontFamily: 'inherit' }} rows={3} value={detail} onChange={e => setDetail(e.target.value)} placeholder="What context, qualifications, or constraints matter?" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={labelStyle}>Expressed by</label>
                <select style={fieldStyle} value={expressedByAgent} onChange={e => setExpressedByAgent(e.target.value)}>
                  {eligibleAgents.map(a => <option key={a.address} value={a.address}>{a.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Addressed to</label>
                <select style={fieldStyle} value={addressedTo} onChange={e => setAddressedTo(e.target.value)}>
                  <option value={`hub:${hubId}`}>The whole hub</option>
                  <option value={`network:${hubId}`}>The network</option>
                  <option value="self">Just me (draft)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={labelStyle}>Priority</label>
                <select style={fieldStyle} value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Geo (optional)</label>
                <input style={fieldStyle} value={requirementGeo} onChange={e => setRequirementGeo(e.target.value)} placeholder="us/colorado/loveland" />
              </div>
              <div>
                <label style={labelStyle}>{direction === 'receive' ? 'Required role' : 'Role you can play'} (optional)</label>
                <input style={fieldStyle} value={requirementRole} onChange={e => setRequirementRole(e.target.value)} placeholder="atl:CoachRole" />
              </div>
            </div>
          </div>

          {/* Outcome */}
          <div style={{ marginBottom: '1rem', padding: '0.75rem 0.85rem', background: '#fafaf6', border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            <div style={{ ...labelStyle, marginBottom: '0.45rem' }}>What would success look like? (drives outcome tracking)</div>
            <input style={fieldStyle} value={outcomeDescription} onChange={e => setOutcomeDescription(e.target.value)} placeholder='e.g. "Active coach assigned, biweekly cadence"' />
            {outcomeDescription && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.4rem' }}>
                <div>
                  <label style={labelStyle}>Metric kind</label>
                  <select style={fieldStyle} value={outcomeKind} onChange={e => setOutcomeKind(e.target.value as typeof outcomeKind)}>
                    <option value="narrative">Narrative</option>
                    <option value="count">Count of fulfillment activities</option>
                    <option value="boolean">Yes / no</option>
                    <option value="date">By a specific date</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Target ({outcomeKind})</label>
                  <input style={fieldStyle} value={outcomeTarget} onChange={e => setOutcomeTarget(e.target.value)} placeholder={outcomeKind === 'count' ? '3' : outcomeKind === 'date' ? '2026-06-01' : ''} />
                </div>
              </div>
            )}
          </div>

          {sensitive && (
            <div style={{ background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.20)', borderRadius: 8, padding: '0.55rem 0.75rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#92400e' }}>
              ⚠ This intent type is marked sensitive — visibility will default to <strong>private</strong> and routing will go through credentialed agents only.
            </div>
          )}

          {err && <div style={{ marginBottom: '0.75rem', fontSize: '0.78rem', color: '#991b1b' }}>{err}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => router.back()}
              disabled={pending}
              style={{ padding: '0.5rem 0.9rem', background: '#fff', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={pending}
              style={{ padding: '0.5rem 1rem', background: C.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.7 : 1 }}
            >
              {pending ? 'Expressing…' : 'Express intent →'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function DirectionTile({ active, bg, fg, border, icon, label, sub, onClick }: {
  active: boolean
  bg: string; fg: string; border: string
  icon: string; label: string; sub: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: active ? bg : '#fafaf6',
        border: `2px solid ${active ? border : '#ece6db'}`,
        borderRadius: 10,
        padding: '0.85rem 1rem',
        cursor: 'pointer',
      }}
    >
      <div style={{ fontSize: '1.4rem', marginBottom: '0.3rem' }}>{icon}</div>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: fg }}>{label}</div>
      <div style={{ fontSize: '0.78rem', color: '#5c4a3a', marginTop: '0.15rem' }}>{sub}</div>
    </button>
  )
}
