'use client'

import { useState } from 'react'
import { logActivity } from '@/lib/actions/activity.action'
import { deleteActivity } from '@/lib/actions/genmap.action'

interface Activity {
  id: string; userId: string; userName: string
  activityType: string; typeLabel: string; title: string
  description: string | null; participants: number
  location: string | null; durationMinutes: number | null
  activityDate: string; createdAt: string
}

interface Props {
  activities: Activity[]
  orgAddress: string
  orgName: string
}

const FUNNEL = [
  { key: 'outreach', label: 'Entry', desc: 'Outreach / Prayer Walk', color: '#7c3aed' },
  { key: 'visit', label: 'Evangelism', desc: 'Gospel Conversation', color: '#1565c0' },
  { key: 'training', label: 'Discipleship', desc: 'Study / Baptism', color: '#0d9488' },
  { key: 'meeting', label: 'Formation', desc: 'Group Meeting', color: '#2e7d32' },
  { key: 'coaching', label: 'Leadership', desc: 'Leadership Development', color: '#ea580c' },
]

const CHAIN_NEXT: Record<string, string> = {
  outreach: 'visit', visit: 'training', training: 'meeting', meeting: 'coaching',
}

export function ActivityFeed({ activities, orgAddress }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState('outreach')
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formParticipants, setFormParticipants] = useState(1)
  const [formLocation, setFormLocation] = useState('')
  const [formDuration, setFormDuration] = useState(60)
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
  const [chainPrompt, setChainPrompt] = useState<string | null>(null)

  function resetForm(type?: string) {
    setFormType(type ?? 'outreach')
    setFormTitle('')
    setFormDesc('')
    setFormParticipants(1)
    setFormDuration(60)
    setFormDate(new Date().toISOString().split('T')[0])
    setChainPrompt(null)
  }

  async function handleSubmit() {
    if (!formTitle.trim()) return
    setSaving(true)
    try {
      await logActivity({
        orgAddress,
        activityType: formType as 'meeting',
        title: formTitle,
        description: formDesc || undefined,
        participants: formParticipants,
        location: formLocation || undefined,
        durationMinutes: formDuration,
        activityDate: formDate,
      })
      // Check for chain suggestion
      const next = CHAIN_NEXT[formType]
      if (next) {
        setChainPrompt(next)
      } else {
        setShowForm(false)
        resetForm()
      }
      window.location.reload()
    } catch { alert('Failed to log activity') }
    setSaving(false)
  }

  function handleChain(nextType: string) {
    const prev = FUNNEL.find(f => f.key === formType)
    resetForm(nextType)
    setFormTitle(`${FUNNEL.find(f => f.key === nextType)?.label ?? nextType} (from ${prev?.label ?? formType})`)
    setChainPrompt(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this activity?')) return
    await deleteActivity(id)
    window.location.reload()
  }

  const funnelItem = FUNNEL.find(f => f.key === formType)

  return (
    <div>
      {/* Funnel selector */}
      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1rem' }}>
        {FUNNEL.map((f, i) => (
          <button key={f.key}
            onClick={() => { setFormType(f.key); setShowForm(true); resetForm(f.key) }}
            style={{
              flex: 1, padding: '0.5rem', borderRadius: 6, border: `1px solid ${f.color}30`,
              background: `${f.color}08`, cursor: 'pointer', textAlign: 'center',
            }}>
            <div style={{ fontSize: '0.65rem', color: '#9e9e9e', marginBottom: '0.15rem' }}>Step {i + 1}</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: f.color }}>{f.label}</div>
            <div style={{ fontSize: '0.6rem', color: '#616161' }}>{f.desc}</div>
          </button>
        ))}
      </div>

      {/* Log form */}
      {showForm && (
        <div style={{ padding: '1rem', background: '#fafafa', borderRadius: 8, border: `2px solid ${funnelItem?.color ?? '#0d9488'}20`, marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, color: funnelItem?.color ?? '#1a1a2e', fontSize: '0.95rem' }}>
              Log {funnelItem?.label ?? 'Activity'}
            </h3>
            <button onClick={() => { setShowForm(false); resetForm() }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#616161' }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <label><span style={{ fontSize: '0.75rem', color: '#616161' }}>Title *</span>
              <input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="What happened?" style={{ width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} /></label>
            <label><span style={{ fontSize: '0.75rem', color: '#616161' }}>Date</span>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} style={{ width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} /></label>
            <label><span style={{ fontSize: '0.75rem', color: '#616161' }}>Location</span>
              <input value={formLocation} onChange={e => setFormLocation(e.target.value)} placeholder="Where?" style={{ width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} /></label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <label style={{ flex: 1 }}><span style={{ fontSize: '0.75rem', color: '#616161' }}>Participants</span>
                <input type="number" min={0} value={formParticipants} onChange={e => setFormParticipants(+e.target.value || 0)} style={{ width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} /></label>
              <label style={{ flex: 1 }}><span style={{ fontSize: '0.75rem', color: '#616161' }}>Minutes</span>
                <input type="number" min={0} value={formDuration} onChange={e => setFormDuration(+e.target.value || 0)} style={{ width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} /></label>
            </div>
          </div>
          <label><span style={{ fontSize: '0.75rem', color: '#616161' }}>Notes</span>
            <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2} placeholder="Details..." style={{ width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem', resize: 'vertical' }} /></label>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button onClick={handleSubmit} disabled={saving || !formTitle.trim()}
              style={{ padding: '0.5rem 1.25rem', background: funnelItem?.color ?? '#0d9488', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving...' : 'Log Activity'}
            </button>
          </div>

          {/* Chain prompt */}
          {chainPrompt && (() => {
            const next = FUNNEL.find(f => f.key === chainPrompt)
            return next ? (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: `${next.color}10`, borderRadius: 6, border: `1px solid ${next.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', color: next.color }}>Chain next: <strong>{next.label}</strong> ({next.desc})?</span>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <button onClick={() => handleChain(chainPrompt)} style={{ padding: '0.3rem 0.75rem', background: next.color, color: '#fff', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem' }}>Chain</button>
                  <button onClick={() => { setChainPrompt(null); setShowForm(false); resetForm() }} style={{ padding: '0.3rem 0.5rem', background: '#e0e0e0', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>Done</button>
                </div>
              </div>
            ) : null
          })()}
        </div>
      )}

      {/* Feed */}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {activities.length === 0 && (
          <p style={{ color: '#616161', textAlign: 'center', padding: '2rem' }}>No activities yet. Use the funnel above to log your first activity.</p>
        )}
        {activities.map(a => {
          const f = FUNNEL.find(f => f.key === a.activityType)
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.5rem 0.75rem', background: '#fff', borderRadius: 6,
              border: '1px solid #f0f1f3', borderLeft: `3px solid ${f?.color ?? '#9e9e9e'}`,
            }}>
              <div style={{ width: 60, textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: f?.color ?? '#616161' }}>{f?.label ?? a.activityType}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: '0.85rem' }}>{a.title}</strong>
                {a.description && <p style={{ fontSize: '0.75rem', color: '#616161', margin: '0.1rem 0 0' }}>{a.description}</p>}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#616161', flexShrink: 0, textAlign: 'right' }}>
                <div>{a.userName}</div>
                <div>{a.activityDate}</div>
                {a.participants > 0 && <div>{a.participants} people</div>}
              </div>
              <button onClick={() => handleDelete(a.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', color: '#b91c1c', flexShrink: 0 }}>✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
