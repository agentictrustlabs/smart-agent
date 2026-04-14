'use client'

import { useState } from 'react'
import { logActivity } from '@/lib/actions/activity.action'

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

const TYPES: Array<{ key: string; label: string; icon: string; color: string }> = [
  { key: 'outreach', label: 'Outreach', icon: '🚶', color: '#7c3aed' },
  { key: 'visit', label: 'Visit', icon: '🏠', color: '#1565c0' },
  { key: 'training', label: 'Training', icon: '📖', color: '#0d9488' },
  { key: 'meeting', label: 'Meeting', icon: '🤝', color: '#2e7d32' },
  { key: 'coaching', label: 'Coaching', icon: '🎯', color: '#ea580c' },
  { key: 'follow-up', label: 'Follow-up', icon: '📞', color: '#8b5e3c' },
  { key: 'prayer', label: 'Prayer', icon: '🙏', color: '#7c3aed' },
  { key: 'service', label: 'Service', icon: '❤️', color: '#dc2626' },
  { key: 'assessment', label: 'Review', icon: '📊', color: '#475569' },
  { key: 'other', label: 'Other', icon: '📝', color: '#6b7280' },
]

const TYPE_MAP = new Map(TYPES.map(t => [t.key, t]))

// Warm palette
const C = {
  bg: '#faf8f3',
  card: '#ffffff',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.08)',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
}

export function ActivityFeed({ activities, orgAddress }: Props) {
  const [filter, setFilter] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState('outreach')
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formParticipants, setFormParticipants] = useState(1)
  const [formLocation, setFormLocation] = useState('')
  const [formDuration, setFormDuration] = useState(60)
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)

  const filtered = filter
    ? activities.filter(a => a.activityType === filter)
    : activities

  // Type counts for filter pills
  const typeCounts: Record<string, number> = {}
  for (const a of activities) {
    typeCounts[a.activityType] = (typeCounts[a.activityType] ?? 0) + 1
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
      setShowForm(false)
      setFormTitle(''); setFormDesc(''); setFormParticipants(1); setFormLocation(''); setFormDuration(60)
      window.location.reload()
    } catch { alert('Failed to log activity') }
    setSaving(false)
  }

  const selectedType = TYPE_MAP.get(formType)

  return (
    <div>
      {/* Type filter pills */}
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button
          onClick={() => setFilter(null)}
          style={{
            padding: '0.35rem 0.75rem', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
            border: `1.5px solid ${filter === null ? C.accent : C.border}`,
            background: filter === null ? C.accent : C.card,
            color: filter === null ? '#fff' : C.text,
            cursor: 'pointer',
          }}
        >
          All ({activities.length})
        </button>
        {TYPES.filter(t => typeCounts[t.key]).map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(filter === t.key ? null : t.key)}
            style={{
              padding: '0.35rem 0.75rem', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
              border: `1.5px solid ${filter === t.key ? t.color : C.border}`,
              background: filter === t.key ? t.color : C.card,
              color: filter === t.key ? '#fff' : C.text,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
            }}
          >
            <span>{t.icon}</span> {t.label} ({typeCounts[t.key]})
          </button>
        ))}
      </div>

      {/* Log activity button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          style={{
            width: '100%', padding: '0.75rem', borderRadius: 10,
            border: `2px dashed ${C.border}`, background: C.card,
            color: C.accent, fontSize: '0.9rem', fontWeight: 600,
            cursor: 'pointer', marginBottom: '1rem',
          }}
        >
          + Log New Activity
        </button>
      )}

      {/* Log form */}
      {showForm && (
        <div style={{
          padding: '1.25rem', background: C.card, borderRadius: 12,
          border: `2px solid ${selectedType?.color ?? C.accent}20`,
          marginBottom: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, color: selectedType?.color ?? C.accent, fontSize: '1rem', fontWeight: 700 }}>
              {selectedType?.icon} Log {selectedType?.label ?? 'Activity'}
            </h3>
            <button onClick={() => setShowForm(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: C.textMuted }}>x</button>
          </div>

          {/* Type selector */}
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {TYPES.slice(0, 8).map(t => (
              <button key={t.key} onClick={() => setFormType(t.key)}
                style={{
                  padding: '0.3rem 0.6rem', borderRadius: 16, fontSize: '0.72rem', fontWeight: 600,
                  border: `1.5px solid ${formType === t.key ? t.color : C.border}`,
                  background: formType === t.key ? `${t.color}15` : C.card,
                  color: formType === t.key ? t.color : C.textMuted,
                  cursor: 'pointer',
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <label>
              <span style={{ fontSize: '0.75rem', color: C.textMuted, fontWeight: 600 }}>Title *</span>
              <input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="What happened?"
                style={{ width: '100%', padding: '0.45rem 0.6rem', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.85rem', boxSizing: 'border-box' }} />
            </label>
            <label>
              <span style={{ fontSize: '0.75rem', color: C.textMuted, fontWeight: 600 }}>Date</span>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.85rem', boxSizing: 'border-box' }} />
            </label>
            <label>
              <span style={{ fontSize: '0.75rem', color: C.textMuted, fontWeight: 600 }}>Location</span>
              <input value={formLocation} onChange={e => setFormLocation(e.target.value)} placeholder="Where?"
                style={{ width: '100%', padding: '0.45rem 0.6rem', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.85rem', boxSizing: 'border-box' }} />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <label style={{ flex: 1 }}>
                <span style={{ fontSize: '0.75rem', color: C.textMuted, fontWeight: 600 }}>People</span>
                <input type="number" min={0} value={formParticipants} onChange={e => setFormParticipants(+e.target.value || 0)}
                  style={{ width: '100%', padding: '0.45rem 0.6rem', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.85rem', boxSizing: 'border-box' }} />
              </label>
              <label style={{ flex: 1 }}>
                <span style={{ fontSize: '0.75rem', color: C.textMuted, fontWeight: 600 }}>Minutes</span>
                <input type="number" min={0} value={formDuration} onChange={e => setFormDuration(+e.target.value || 0)}
                  style={{ width: '100%', padding: '0.45rem 0.6rem', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.85rem', boxSizing: 'border-box' }} />
              </label>
            </div>
          </div>
          <label>
            <span style={{ fontSize: '0.75rem', color: C.textMuted, fontWeight: 600 }}>Notes</span>
            <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2} placeholder="Details..."
              style={{ width: '100%', padding: '0.45rem 0.6rem', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.85rem', resize: 'vertical', boxSizing: 'border-box' }} />
          </label>
          <button onClick={handleSubmit} disabled={saving || !formTitle.trim()}
            style={{
              marginTop: '0.75rem', padding: '0.5rem 1.5rem',
              background: selectedType?.color ?? C.accent, color: '#fff',
              border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Log Activity'}
          </button>
        </div>
      )}

      {/* Activity feed */}
      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: C.textMuted }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
          <p style={{ fontSize: '0.9rem', fontWeight: 500 }}>
            {filter ? `No ${TYPE_MAP.get(filter)?.label ?? filter} activities yet` : 'No activities yet'}
          </p>
          <p style={{ fontSize: '0.8rem' }}>Use the button above to log your first activity.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {filtered.map(a => {
          const t = TYPE_MAP.get(a.activityType)
          const daysAgo = Math.floor((Date.now() - new Date(a.activityDate).getTime()) / 86400000)
          const dateLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`

          return (
            <div key={a.id} style={{
              display: 'flex', gap: '0.75rem', padding: '0.75rem 1rem',
              background: C.card, borderRadius: 10,
              border: `1px solid ${C.border}`, borderLeft: `4px solid ${t?.color ?? '#9e9e9e'}`,
            }}>
              {/* Type icon */}
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: `${t?.color ?? '#9e9e9e'}12`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.2rem', flexShrink: 0,
              }}>
                {t?.icon ?? '📝'}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.15rem' }}>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700, color: t?.color ?? C.textMuted,
                    padding: '0.1rem 0.4rem', borderRadius: 4,
                    background: `${t?.color ?? '#9e9e9e'}12`,
                    textTransform: 'uppercase', letterSpacing: '0.03em',
                  }}>
                    {t?.label ?? a.activityType}
                  </span>
                  {a.location && (
                    <span style={{ fontSize: '0.72rem', color: C.textMuted }}>
                      📍 {a.location}
                    </span>
                  )}
                </div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: C.text, marginBottom: '0.1rem' }}>
                  {a.title}
                </div>
                {a.description && (
                  <p style={{ fontSize: '0.78rem', color: C.textMuted, margin: 0, lineHeight: 1.4 }}>
                    {a.description.length > 120 ? a.description.slice(0, 120) + '...' : a.description}
                  </p>
                )}
              </div>

              {/* Meta */}
              <div style={{ flexShrink: 0, textAlign: 'right', fontSize: '0.72rem', color: C.textMuted }}>
                <div style={{ fontWeight: 600, color: C.text }}>{dateLabel}</div>
                <div>{a.userName}</div>
                {a.participants > 0 && <div>{a.participants} people</div>}
                {a.durationMinutes && <div>{a.durationMinutes}m</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
