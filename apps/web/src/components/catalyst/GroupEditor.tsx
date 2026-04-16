'use client'

import { useState, useRef } from 'react'
import { ChurchCircle, type HealthData, DEFAULT_HEALTH } from './ChurchCircle'

export interface GroupData {
  id?: string
  name: string
  /** .agent name label for this circle (e.g., "wellington") */
  nameLabel?: string
  location: string
  leaderName: string
  startDate: string
  peoplGroup: string
  health: HealthData
  status: string
}

interface Props {
  initial?: GroupData
  parentName?: string
  /** Parent's .agent name (e.g., "catalyst.agent") for building the full path */
  parentAgentName?: string
  onSave: (data: GroupData) => Promise<void>
  onClose: () => void
  mode: 'create' | 'edit'
}

/* ── Shared styles ── */
const lbl: React.CSSProperties = { fontSize: '0.8rem', color: '#616161', display: 'block', marginBottom: '0.15rem' }
const inp: React.CSSProperties = { width: '100%', padding: '0.45rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }
const sectionTitle: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 700, display: 'block', marginBottom: '0.5rem', color: '#334155' }
const sectionBox: React.CSSProperties = { padding: '0.75rem', background: '#fafafa', borderRadius: 8, border: '1px solid #e2e4e8', marginBottom: '0.75rem' }

/* ── Reusable sub-components ── */

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const base: React.CSSProperties = {
    padding: '0.3rem 0.75rem', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600,
    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <button type="button" style={{ ...base, background: value ? '#475569' : '#e2e4e8', color: value ? '#fff' : '#616161' }}
        onClick={() => onChange(true)}>Yes</button>
      <button type="button" style={{ ...base, background: !value ? '#475569' : '#e2e4e8', color: !value ? '#fff' : '#616161' }}
        onClick={() => onChange(false)}>No</button>
    </span>
  )
}

function ChipSelect({ options, selected, onChange, multi = false }: {
  options: string[]; selected: string | string[]; onChange: (v: string | string[]) => void; multi?: boolean
}) {
  const sel = Array.isArray(selected) ? selected : [selected]
  const base: React.CSSProperties = {
    padding: '0.3rem 0.65rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 500,
    border: '1.5px solid', cursor: 'pointer', transition: 'all 0.15s',
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(o => {
        const active = sel.includes(o)
        return (
          <button key={o} type="button" style={{
            ...base,
            background: active ? '#0d9488' : '#fff',
            color: active ? '#fff' : '#64748b',
            borderColor: active ? '#0d9488' : '#cbd5e1',
          }} onClick={() => {
            if (multi) {
              const arr = [...sel]
              if (active) onChange(arr.filter(x => x !== o))
              else onChange([...arr, o])
            } else {
              onChange(o)
            }
          }}>{o}</button>
        )
      })}
    </div>
  )
}

function NumberStepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  const btn: React.CSSProperties = {
    width: 28, height: 28, borderRadius: 6, border: '1px solid #cbd5e1',
    background: '#f8fafc', cursor: 'pointer', fontSize: '1rem', fontWeight: 600, color: '#334155',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button type="button" style={btn} onClick={() => onChange(Math.max(min, value - 1))}>-</button>
      <span style={{ minWidth: 28, textAlign: 'center', fontSize: '0.85rem', fontWeight: 600 }}>{value}</span>
      <button type="button" style={btn} onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

function Slider({ value, max, onChange, color = '#0d9488' }: { value: number; max: number; onChange: (v: number) => void; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="range" min={0} max={Math.max(max, 1)} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{ flex: 1, accentColor: color }} />
      <span style={{ minWidth: 24, fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>{value}</span>
    </div>
  )
}

/* ── Preset data ── */
const LANGUAGE_OPTIONS = ['Spanish', 'Levantine Arabic', 'Nepali', 'Unknown', 'Other']
const PEOPLE_GROUP_OPTIONS = ['Mexican', 'Arab', 'Gurkha/Nepali', 'Unknown', 'Other']
const RELIGION_OPTIONS = ['Sunni Islam', 'Roman Catholicism', 'Hinduism', 'Unknown', 'Other']
const GLOBAL_SEGMENTS = [
  'Children', 'Youth', 'College/University Students', 'Elderly', 'Men', 'Women',
  'Business Professionals', 'Slum Dwellers', 'Urban Dwellers', 'Rural Dwellers',
  'Refugees', 'Displaced Peoples', 'Widows', 'Orphans', 'Other',
]
const FREQUENCY_OPTIONS = [
  { label: 'Less than once a week', value: 'less-weekly' },
  { label: 'Once a week', value: 'weekly' },
  { label: 'More than once a week', value: 'multiple' },
]

const HEALTH_INDICATORS: Array<{
  key: keyof HealthData; icon: string; label: string
  subKey?: keyof HealthData; subLabel?: string
}> = [
  { key: 'appointedLeaders', icon: '\u{1F465}', label: 'Appointed Leaders?' },
  { key: 'practicesBaptism', icon: '\u{1F30A}', label: 'Practices Baptism?', subKey: 'doingOwnBaptism', subLabel: 'Doing own Baptism?' },
  { key: 'lordsSupper', icon: '\u{1F35E}', label: "Lord's Supper?", subKey: 'servesLordsSupper', subLabel: "Serves Lord's Supper?" },
  { key: 'makingDisciples', icon: '\u{1F6B6}', label: 'Making Disciples?' },
  { key: 'practicesGiving', icon: '\u{1F4B0}', label: 'Practices Giving?' },
  { key: 'regularTeaching', icon: '\u{1F4D6}', label: 'Regular Teaching?', subKey: 'givesOwnTeaching', subLabel: 'Gives own Teaching?' },
  { key: 'practicesService', icon: '\u{2764}\u{FE0F}', label: 'Practices Service?' },
  { key: 'accountability', icon: '\u{1F91D}', label: 'Accountability?' },
  { key: 'practicesPrayer', icon: '\u{1F64F}', label: 'Practices Prayer?' },
  { key: 'practicesPraising', icon: '\u{1F3B5}', label: 'Practices Praising?' },
]

const EMPTY_PEOPLE_GROUP = { name: 'Unknown', language: 'Unknown', religiousBackground: 'Unknown', numberAttending: 0, numberOfBelievers: 0, numberOfBaptizedBelievers: 0 }

/* ── Main Component ── */

export function GroupEditor({ initial, parentName, parentAgentName, onSave, onClose, mode }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [nameLabel, setNameLabel] = useState(initial?.nameLabel ?? '')
  const [nameLabelError, setNameLabelError] = useState<string | null>(null)
  const [nameLabelChecking, setNameLabelChecking] = useState(false)
  const [location, setLocation] = useState(initial?.location ?? '')
  const [leader, setLeader] = useState(initial?.leaderName ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? new Date().toISOString().split('T')[0])
  const [peoplGroup, setPeoplGroup] = useState(initial?.peoplGroup ?? '')
  const [health, setHealth] = useState<HealthData>(initial?.health ?? { ...DEFAULT_HEALTH })
  const [status, setStatus] = useState(initial?.status ?? 'active')
  const [saving, setSaving] = useState(false)
  const [locating, setLocating] = useState(false)
  const commentsRef = useRef<HTMLDivElement>(null)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Derive the full .agent name from label + parent
  const fullAgentName = nameLabel && parentAgentName
    ? `${nameLabel}.${parentAgentName}`
    : nameLabel
      ? `${nameLabel}.agent`
      : ''

  // Check name availability (debounced)
  function handleNameLabelChange(val: string) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setNameLabel(cleaned)
    setNameLabelError(null)

    if (!cleaned) return

    // Validate format
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(cleaned)) {
      setNameLabelError('Must be alphanumeric with optional hyphens')
      return
    }

    // Debounced availability check
    if (checkTimer.current) clearTimeout(checkTimer.current)
    setNameLabelChecking(true)
    checkTimer.current = setTimeout(async () => {
      try {
        const checkName = parentAgentName ? `${cleaned}.${parentAgentName}` : `${cleaned}.agent`
        const res = await fetch(`/api/naming/check?name=${encodeURIComponent(checkName)}`)
        const data = await res.json()
        if (data.exists) {
          setNameLabelError(`"${checkName}" is already registered`)
        }
      } catch { /* availability check failed — allow proceeding */ }
      setNameLabelChecking(false)
    }, 500)
  }

  const h = (patch: Partial<HealthData>) => setHealth(prev => ({ ...prev, ...patch }))

  async function handleSave() {
    if (!name.trim()) return
    if (mode === 'create' && nameLabelError) return
    setSaving(true)
    try {
      await onSave({ id: initial?.id, name, nameLabel: nameLabel || undefined, location, leaderName: leader, startDate, peoplGroup, health, status })
    } catch { /* handled by parent */ }
    setSaving(false)
  }

  const peopleGroups = health.peopleGroups ?? []

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 480, height: '100vh', zIndex: 1100,
      background: 'white', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', overflowY: 'auto',
      borderLeft: '3px solid #0d9488', padding: '1.25rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{mode === 'create' ? 'New Circle' : 'Edit Circle'}</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#616161' }}>{'\u2715'}</button>
      </div>

      {parentName && (
        <div style={{ fontSize: '0.8rem', color: '#0d9488', marginBottom: '0.75rem' }}>
          Under: <strong>{parentName}</strong>
        </div>
      )}

      {/* ─── 1. Identity ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
        <label><span style={lbl}>Name *</span><input value={name} onChange={e => setName(e.target.value)} placeholder="Circle name" style={inp} /></label>
        <label><span style={lbl}>Leader</span><input value={leader} onChange={e => setLeader(e.target.value)} placeholder="Leader name" style={inp} /></label>
        <label><span style={lbl}>Start Date</span><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} /></label>
      </div>

      {/* ─── .agent Name ─── */}
      {mode === 'create' && (
        <div style={{ marginBottom: '0.75rem', padding: '0.65rem', background: '#faf8f3', borderRadius: 8, border: '1px solid #ece6db' }}>
          <span style={{ ...lbl, color: '#8b5e3c', fontWeight: 600 }}>.agent Name</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 4 }}>
            <input
              value={nameLabel}
              onChange={e => handleNameLabelChange(e.target.value)}
              placeholder="label"
              style={{
                ...inp, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none',
                fontFamily: 'monospace', width: 120, flexShrink: 0,
              }}
            />
            <span style={{
              padding: '0.45rem 0.5rem', background: '#f0ebe3', border: '1px solid #e2e4e8',
              borderTopRightRadius: 6, borderBottomRightRadius: 6,
              fontSize: '0.82rem', color: '#9a8c7e', fontFamily: 'monospace', whiteSpace: 'nowrap',
            }}>
              .{parentAgentName || 'agent'}
            </span>
          </div>
          {fullAgentName && !nameLabelError && (
            <div style={{ fontSize: '0.72rem', color: '#8b5e3c', fontFamily: 'monospace' }}>
              {nameLabelChecking ? 'Checking...' : `✓ ${fullAgentName}`}
            </div>
          )}
          {nameLabelError && (
            <div style={{ fontSize: '0.72rem', color: '#c62828' }}>{nameLabelError}</div>
          )}
        </div>
      )}

      {/* ─── Location ─── */}
      <div style={{ marginBottom: '0.75rem' }}>
        <span style={lbl}>Location</span>
        <input value={location} onChange={e => setLocation(e.target.value)} placeholder="City or area" style={{ ...inp, marginBottom: 6 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => {
            if (!navigator.geolocation) return
            setLocating(true)
            navigator.geolocation.getCurrentPosition(
              pos => { h({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); setLocating(false) },
              () => setLocating(false),
              { enableHighAccuracy: true, timeout: 10000 }
            )
          }} style={{
            padding: '0.3rem 0.65rem', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600,
            border: '1.5px solid #0d9488', background: '#fff', color: '#0d9488', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {'\uD83D\uDCCD'} {locating ? 'Locating...' : 'Use Current Location'}
          </button>
          {health.latitude != null && health.longitude != null && (
            <span style={{ fontSize: '0.75rem', color: '#9e9e9e' }}>
              Coordinates: {health.latitude.toFixed(4)}, {health.longitude.toFixed(4)}
            </span>
          )}
        </div>
      </div>

      {/* ─── 2. Status ─── */}
      <div style={sectionBox}>
        <span style={sectionTitle}>Status</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
          <div>
            <span style={lbl}>Is Church?</span>
            <YesNo value={health.isChurch} onChange={v => h({ isChurch: v })} />
          </div>
          <div>
            <span style={lbl}>Is Active?</span>
            <YesNo value={status === 'active'} onChange={v => setStatus(v ? 'active' : 'inactive')} />
          </div>
        </div>
        <div>
          <span style={lbl}>Meeting Frequency</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {FREQUENCY_OPTIONS.map(f => {
              const active = (health.meetingFrequency ?? 'weekly') === f.value
              return (
                <button key={f.value} type="button" onClick={() => h({ meetingFrequency: f.value })}
                  style={{
                    padding: '0.3rem 0.65rem', borderRadius: 999, fontSize: '0.73rem', fontWeight: 500,
                    border: '1.5px solid', cursor: 'pointer', transition: 'all 0.15s',
                    background: active ? '#0d9488' : '#fff',
                    color: active ? '#fff' : '#64748b',
                    borderColor: active ? '#0d9488' : '#cbd5e1',
                  }}>{f.label}</button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ─── 3. Church Health Indicators ─── */}
      <div style={sectionBox}>
        <span style={sectionTitle}>Church Health Indicators</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {HEALTH_INDICATORS.map(ind => {
            const val = health[ind.key] as boolean
            const subVal = ind.subKey ? (health[ind.subKey] as boolean) : false
            return (
              <div key={ind.key}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '1rem' }}>{ind.icon}</span> {ind.label}
                  </span>
                  <YesNo value={val} onChange={v => {
                    const patch: Partial<HealthData> = { [ind.key]: v }
                    if (!v && ind.subKey) patch[ind.subKey] = false as never
                    h(patch)
                  }} />
                </div>
                {val && ind.subKey && ind.subLabel && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: '2rem', marginTop: 4 }}>
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{ind.subLabel}</span>
                    <YesNo value={subVal} onChange={v => h({ [ind.subKey!]: v } as Partial<HealthData>)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ─── Health Metrics (numbers) ─── */}
      <div style={sectionBox}>
        <span style={sectionTitle}>Health Metrics</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
          <label><span style={{ ...lbl, color: '#1565c0' }}>Attenders</span>
            <input type="number" min={0} value={health.attenders ?? health.seekers} onChange={e => h({ attenders: +e.target.value || 0, seekers: +e.target.value || 0 })} style={inp} /></label>
          <label><span style={{ ...lbl, color: '#ea580c' }}>Believers</span>
            <input type="number" min={0} value={health.believers} onChange={e => h({ believers: +e.target.value || 0 })} style={inp} /></label>
          <label><span style={{ ...lbl, color: '#2e7d32' }}>Baptized</span>
            <input type="number" min={0} value={health.baptized} onChange={e => h({ baptized: +e.target.value || 0 })} style={inp} /></label>
          <label><span style={{ ...lbl, color: '#7c3aed' }}>Leaders</span>
            <input type="number" min={0} value={health.leaders} onChange={e => h({ leaders: +e.target.value || 0 })} style={inp} /></label>
          <label><span style={lbl}>Circles Started</span>
            <input type="number" min={0} value={health.groupsStarted} onChange={e => h({ groupsStarted: +e.target.value || 0 })} style={inp} /></label>
        </div>
      </div>

      {/* ─── 4. Languages Used ─── */}
      <div style={sectionBox}>
        <span style={sectionTitle}>Languages Used</span>
        <ChipSelect options={LANGUAGE_OPTIONS} selected={health.languages ?? []} multi
          onChange={v => h({ languages: v as string[] })} />
      </div>

      {/* ─── 5. People Circles Attending ─── */}
      <div style={sectionBox}>
        <span style={sectionTitle}>People Circles Attending</span>
        {peopleGroups.map((pg, i) => (
          <div key={i} style={{ padding: '0.6rem', background: '#fff', borderRadius: 8, border: '1px solid #e2e4e8', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>Circle {i + 1}</span>
              <button type="button" onClick={() => {
                const next = [...peopleGroups]
                next.splice(i, 1)
                h({ peopleGroups: next })
              }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.9rem' }}>{'\u{1F5D1}'}</button>
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={lbl}>People Group</span>
              <ChipSelect options={PEOPLE_GROUP_OPTIONS} selected={pg.name}
                onChange={v => { const next = [...peopleGroups]; next[i] = { ...pg, name: v as string }; h({ peopleGroups: next }) }} />
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={lbl}>Language</span>
              <ChipSelect options={LANGUAGE_OPTIONS} selected={pg.language}
                onChange={v => { const next = [...peopleGroups]; next[i] = { ...pg, language: v as string }; h({ peopleGroups: next }) }} />
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={lbl}>Religious Background</span>
              <ChipSelect options={RELIGION_OPTIONS} selected={pg.religiousBackground}
                onChange={v => { const next = [...peopleGroups]; next[i] = { ...pg, religiousBackground: v as string }; h({ peopleGroups: next }) }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              <div>
                <span style={lbl}>Number Attending</span>
                <NumberStepper value={pg.numberAttending} onChange={v => { const next = [...peopleGroups]; next[i] = { ...pg, numberAttending: v }; h({ peopleGroups: next }) }} />
              </div>
              <div>
                <span style={lbl}>Believers</span>
                <Slider value={pg.numberOfBelievers} max={pg.numberAttending}
                  onChange={v => { const next = [...peopleGroups]; next[i] = { ...pg, numberOfBelievers: v }; h({ peopleGroups: next }) }} color="#ea580c" />
              </div>
              <div>
                <span style={lbl}>Baptized</span>
                <Slider value={pg.numberOfBaptizedBelievers} max={pg.numberOfBelievers}
                  onChange={v => { const next = [...peopleGroups]; next[i] = { ...pg, numberOfBaptizedBelievers: v }; h({ peopleGroups: next }) }} color="#2e7d32" />
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => h({ peopleGroups: [...peopleGroups, { ...EMPTY_PEOPLE_GROUP }] })}
          style={{ width: '100%', padding: '0.4rem', background: '#fff', border: '1.5px dashed #cbd5e1', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem', color: '#0d9488', fontWeight: 600 }}>
          + Add Another
        </button>
      </div>

      {/* ─── 6. Global Segments ─── */}
      <div style={sectionBox}>
        <span style={sectionTitle}>Global Segments</span>
        <ChipSelect options={GLOBAL_SEGMENTS} selected={health.globalSegments ?? []} multi
          onChange={v => h({ globalSegments: v as string[] })} />
      </div>

      {/* ─── 7. Comments (Rich Text) ─── */}
      <div style={{ marginBottom: '0.75rem' }}>
        <span style={sectionTitle}>Comments</span>
        <div style={{ border: '1px solid #e2e4e8', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 2, padding: '3px 4px', background: '#f5f5f5', borderBottom: '1px solid #e2e4e8' }}>
            <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('bold') }}
              style={{ width: 24, height: 24, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>B</button>
            <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('italic') }}
              style={{ width: 24, height: 24, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontStyle: 'italic', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>I</button>
            <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('hiliteColor', false, '#fef08a') }}
              style={{ width: 24, height: 24, border: '1px solid #d1d5db', borderRadius: 4, background: '#fef9c3', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>{'\uD83D\uDD8D'}</button>
          </div>
          <div
            ref={commentsRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={() => { if (commentsRef.current) h({ comments: commentsRef.current.innerHTML }) }}
            onInput={() => { if (commentsRef.current) h({ comments: commentsRef.current.innerHTML }) }}
            dangerouslySetInnerHTML={{ __html: health.comments ?? '' }}
            style={{ minHeight: 72, padding: '0.45rem', fontSize: '0.85rem', outline: 'none', lineHeight: 1.5 }}
          />
        </div>
      </div>

      {/* ─── Legacy People Group field ─── */}
      <label style={{ display: 'block', marginBottom: '0.75rem' }}>
        <span style={lbl}>People Group (legacy)</span>
        <input value={peoplGroup} onChange={e => setPeoplGroup(e.target.value)} placeholder="e.g. Vietnamese" style={inp} />
      </label>

      {/* ─── 8. Church Circle Preview ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', padding: '0.75rem', background: '#f5f5f5', borderRadius: 8 }}>
        <ChurchCircle health={health} size={80} />
        <div style={{ fontSize: '0.75rem', color: '#616161' }}>
          <div>{health.isChurch ? 'Solid = Established' : 'Dashed = Gathering'}</div>
          <div style={{ marginTop: '0.2rem' }}>TL: Attenders | TR: Baptized</div>
          <div>BL: Believers | BR: Leaders</div>
          <div style={{ marginTop: '0.2rem' }}>Dots = self-functioning practices</div>
        </div>
      </div>

      {/* ─── Actions ─── */}
      <div style={{ display: 'flex', gap: '0.5rem', paddingBottom: '1rem' }}>
        <button onClick={handleSave} disabled={saving || !name.trim()}
          style={{ flex: 1, padding: '0.6rem', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
          {saving ? 'Saving...' : mode === 'create' ? 'Create Circle' : 'Save Changes'}
        </button>
        <button onClick={onClose}
          style={{ padding: '0.6rem 1rem', background: '#e0e0e0', color: '#1a1a2e', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
