'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createOffering, type OfferingCapability } from '@/lib/actions/needs.action'

const C = {
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
}

interface ResourceTypeMeta {
  uri: string
  label: string
  icon: string
  blurb: string
  /** v0 form support — types without dedicated forms use the generic form */
  form: 'skill' | 'worker' | 'prayer' | 'connector' | 'generic'
}

const TYPES: ResourceTypeMeta[] = [
  { uri: 'resourceType:Skill',        label: 'Skill',          icon: '🎯', blurb: 'A capability you carry — bridges to skill-claim',           form: 'skill' },
  { uri: 'resourceType:Worker',       label: 'Worker',         icon: '👷', blurb: 'You\'re available to deploy / coach / serve',                form: 'worker' },
  { uri: 'resourceType:Prayer',       label: 'Prayer',         icon: '🙏', blurb: 'Adopted, scheduled intercession',                            form: 'prayer' },
  { uri: 'resourceType:Connector',    label: 'Connector',      icon: '🤝', blurb: 'Who you know — introductions across orgs / sectors',       form: 'connector' },
  { uri: 'resourceType:Money',        label: 'Funding',        icon: '💰', blurb: 'Restricted gift, grant, or micro-finance',                  form: 'generic' },
  { uri: 'resourceType:Venue',        label: 'Venue',          icon: '🏠', blurb: 'Physical hosting capacity',                                  form: 'generic' },
  { uri: 'resourceType:Curriculum',   label: 'Curriculum',     icon: '📚', blurb: 'Discipleship content / training material',                  form: 'generic' },
  { uri: 'resourceType:Scripture',    label: 'Scripture',      icon: '📖', blurb: 'Heart-language scripture / oral Bible',                     form: 'generic' },
  { uri: 'resourceType:Data',         label: 'Data',           icon: '📊', blurb: 'Datasets, research, demographic intel',                     form: 'generic' },
  { uri: 'resourceType:Church',       label: 'Church',         icon: '⛪', blurb: 'Local body, multiplication parent',                          form: 'generic' },
  { uri: 'resourceType:Organization', label: 'Organization',   icon: '🏛️', blurb: 'Org-level capability, alliance role',                       form: 'generic' },
  { uri: 'resourceType:Credential',   label: 'Credential',     icon: '🎓', blurb: 'Issuable attestation — ECFA, ordination, leadership cert', form: 'generic' },
]

export interface OfferResourceDialogProps {
  open: boolean
  onClose: () => void
  hubId: string
  myAgent: string
}

export function OfferResourceDialog(props: OfferResourceDialogProps) {
  const [picked, setPicked] = useState<ResourceTypeMeta | null>(null)
  if (!props.open) return null
  return (
    <div
      onClick={props.onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 60, padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', maxWidth: 720, width: '100%', maxHeight: '90vh',
          overflow: 'auto', borderRadius: 14, padding: '1.25rem 1.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: C.text }}>
            {picked ? `Offer: ${picked.label}` : 'What are you offering?'}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: C.textMuted, cursor: 'pointer' }}
          >×</button>
        </div>

        {!picked ? (
          <>
            <p style={{ fontSize: '0.85rem', color: C.textMuted, marginTop: 0, marginBottom: '0.85rem' }}>
              Pick a category. You can fill in the details on the next screen.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.55rem' }}>
              {TYPES.map(t => (
                <button
                  key={t.uri}
                  type="button"
                  onClick={() => setPicked(t)}
                  style={{
                    textAlign: 'left',
                    background: C.accentLight,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: '0.7rem 0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '1.3rem', marginBottom: '0.2rem' }}>{t.icon}</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: C.text }}>{t.label}</div>
                  <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.15rem', lineHeight: 1.3 }}>{t.blurb}</div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <OfferForm
            type={picked}
            hubId={props.hubId}
            myAgent={props.myAgent}
            onBack={() => setPicked(null)}
            onDone={() => { props.onClose(); setPicked(null) }}
          />
        )}
      </div>
    </div>
  )
}

// ─── Forms (one per form type) ──────────────────────────────────────

interface FormProps {
  type: ResourceTypeMeta
  hubId: string
  myAgent: string
  onBack: () => void
  onDone: () => void
}

function OfferForm({ type, hubId, myAgent, onBack, onDone }: FormProps) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  // Type-keyed form fields
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [skill, setSkill] = useState('')
  const [role, setRole] = useState('')
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'experienced' | 'expert'>('intermediate')
  const [geo, setGeo] = useState('')
  const [recurrence, setRecurrence] = useState('weekly')
  const [days, setDays] = useState('mon,wed,fri')
  const [capacityAmount, setCapacityAmount] = useState(2)
  const [capacityUnit, setCapacityUnit] = useState('hours-per-week')
  const [adoptedTarget, setAdoptedTarget] = useState('')
  const [introTo, setIntroTo] = useState('')
  const [introScope, setIntroScope] = useState('')

  function buildPayload() {
    const base = {
      offeredByAgent: myAgent,
      hubId,
      resourceType: type.uri,
      resourceTypeLabel: type.label,
      title,
      detail: detail || undefined,
      geo: geo || undefined,
    }
    let capabilities: OfferingCapability[] = []
    let timeWindow: { recurrence?: string; days?: string } | undefined
    let capacity: { unit: string; amount: number } | undefined

    switch (type.form) {
      case 'skill':
        capabilities = [{ skill: skill || undefined, level, role: role || undefined }]
        break
      case 'worker':
        capabilities = [{ role: role || undefined, level, evidence: detail || undefined }]
        timeWindow = { recurrence }
        capacity = { unit: capacityUnit, amount: capacityAmount }
        break
      case 'prayer':
        capabilities = [{ skill: 'intercession', evidence: adoptedTarget }]
        timeWindow = { recurrence, days }
        break
      case 'connector':
        capabilities = [{
          role: 'connector',
          evidence: `Introduces to: ${introTo}; scope: ${introScope}`,
        }]
        break
      case 'generic':
      default:
        capabilities = []
    }
    return { ...base, capabilities, timeWindow: timeWindow as { start?: string; end?: string; recurrence?: string } | undefined, capacity }
  }

  function onSubmit() {
    setErr(null)
    const payload = buildPayload()
    if (!payload.title.trim()) {
      setErr('Title required')
      return
    }
    start(async () => {
      const res = await createOffering(payload)
      if ('error' in res) setErr(res.error)
      else {
        router.refresh()
        onDone()
      }
    })
  }

  const fieldStyle = { width: '100%', padding: '0.4rem 0.55rem', fontSize: '0.85rem', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: '#fff' } as const
  const labelStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' } as const

  return (
    <div>
      <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: '0.78rem', padding: 0, marginBottom: '0.85rem' }}>
        ← Pick a different type
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.7rem' }}>
        <div>
          <label style={labelStyle}>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={type.form === 'connector' ? 'e.g. "Front Range pastor introductions"' : `${type.label} offering`} style={fieldStyle} />
        </div>
        <div>
          <label style={labelStyle}>Detail (optional)</label>
          <textarea value={detail} onChange={e => setDetail(e.target.value)} rows={2} style={{ ...fieldStyle, fontFamily: 'inherit' }} placeholder="What's the context, qualification, or limit?" />
        </div>

        {/* Type-keyed fields */}
        {type.form === 'skill' && (
          <>
            <div>
              <label style={labelStyle}>Skill (concept ID)</label>
              <input value={skill} onChange={e => setSkill(e.target.value)} placeholder="e.g. custom:grant-writing" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Level</label>
              <select value={level} onChange={e => setLevel(e.target.value as typeof level)} style={fieldStyle}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="experienced">Experienced</option>
                <option value="expert">Expert</option>
              </select>
            </div>
          </>
        )}

        {type.form === 'worker' && (
          <>
            <div>
              <label style={labelStyle}>Role you can play</label>
              <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. atl:CoachRole" style={fieldStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={labelStyle}>Capacity</label>
                <input type="number" min={1} value={capacityAmount} onChange={e => setCapacityAmount(Number(e.target.value) || 1)} style={fieldStyle} />
              </div>
              <div>
                <label style={labelStyle}>Unit</label>
                <select value={capacityUnit} onChange={e => setCapacityUnit(e.target.value)} style={fieldStyle}>
                  <option value="hours-per-week">hours/week</option>
                  <option value="hours-per-month">hours/month</option>
                  <option value="trips-per-year">trips/year</option>
                  <option value="people">people</option>
                </select>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Cadence</label>
              <select value={recurrence} onChange={e => setRecurrence(e.target.value)} style={fieldStyle}>
                <option value="weekly">Weekly</option>
                <option value="bi-weekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="ad-hoc">Ad hoc</option>
              </select>
            </div>
          </>
        )}

        {type.form === 'prayer' && (
          <>
            <div>
              <label style={labelStyle}>Adopted target (place / people / person)</label>
              <input value={adoptedTarget} onChange={e => setAdoptedTarget(e.target.value)} placeholder="e.g. wellington.colorado.us.geo or Familia Morales" style={fieldStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={labelStyle}>Cadence</label>
                <select value={recurrence} onChange={e => setRecurrence(e.target.value)} style={fieldStyle}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Days (if weekly)</label>
                <input value={days} onChange={e => setDays(e.target.value)} placeholder="mon,wed,fri" style={fieldStyle} />
              </div>
            </div>
          </>
        )}

        {type.form === 'connector' && (
          <>
            <div>
              <label style={labelStyle}>I can introduce to…</label>
              <input value={introTo} onChange={e => setIntroTo(e.target.value)} placeholder="e.g. NoCo donor-advised funds, Front Range pastors" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Scope</label>
              <select value={introScope} onChange={e => setIntroScope(e.target.value)} style={fieldStyle}>
                <option value="">— pick one —</option>
                <option value="hub">My hub</option>
                <option value="region">Regional</option>
                <option value="national">National</option>
                <option value="international">International</option>
              </select>
            </div>
          </>
        )}

        <div>
          <label style={labelStyle}>Geo (optional)</label>
          <input value={geo} onChange={e => setGeo(e.target.value)} placeholder="e.g. us/colorado/wellington" style={fieldStyle} />
        </div>
      </div>

      {err && <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#991b1b' }}>{err}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          style={{ padding: '0.5rem 0.9rem', background: '#fff', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending}
          style={{ padding: '0.5rem 0.9rem', background: C.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600, cursor: pending ? 'wait' : 'pointer' }}
        >
          {pending ? 'Saving…' : 'Publish offering'}
        </button>
      </div>
    </div>
  )
}
