'use client'

import { useState } from 'react'
import { logActivity } from '@/lib/actions/activity.action'
import { deleteActivity, updateActivity } from '@/lib/actions/genmap.action'

interface ActivityView {
  id: string; userId: string; userName: string; activityType: string; typeLabel: string
  title: string; description: string | null; participants: number; location: string | null
  durationMinutes: number | null; activityDate: string; createdAt: string
}

interface Props {
  activities: ActivityView[]
  orgAddress: string
  orgName: string
}

const ACTIVITY_TYPES = [
  // GAPP-style funnel categories
  { value: 'outreach', label: 'Entry (Outreach / Prayer Walk)' },
  { value: 'visit', label: 'Evangelism (Gospel Conversation)' },
  { value: 'training', label: 'Discipleship (Study / Baptism)' },
  { value: 'meeting', label: 'Formation (Group Meeting)' },
  { value: 'coaching', label: 'Leadership Development' },
  // General
  { value: 'follow-up', label: 'Follow-up' },
  { value: 'assessment', label: 'Assessment / Review' },
  { value: 'prayer', label: 'Prayer' },
  { value: 'service', label: 'Community Service' },
  { value: 'other', label: 'Other' },
]

const TYPE_COLORS: Record<string, string> = {
  meeting: '#1565c0', visit: '#0d9488', training: '#7c3aed', outreach: '#ea580c',
  'follow-up': '#d97706', assessment: '#b91c1c', coaching: '#059669',
  prayer: '#6366f1', service: '#ec4899', other: '#616161',
}

// Chain logic: after submit, offer to chain a follow-on activity
// GAPP-style 4-step funnel: Entry → Evangelism → Discipleship → Formation → Leadership
const CHAIN_SUGGESTIONS: Record<string, { type: string; label: string }> = {
  outreach: { type: 'visit', label: 'Chain → Evangelism (Gospel Conversation)' },
  visit: { type: 'training', label: 'Chain → Discipleship (Study / Baptism)' },
  training: { type: 'meeting', label: 'Chain → Formation (New Group)' },
  meeting: { type: 'coaching', label: 'Chain → Leadership Development' },
}

export function ActivitiesClient({ activities, orgAddress, orgName: _orgName }: Props) {
  const [view, setView] = useState<'feed' | 'calendar'>('feed')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showChainPrompt, setShowChainPrompt] = useState<string | null>(null) // type of last submitted
  const [loading, setLoading] = useState(false)
  const [activityType, setActivityType] = useState('meeting')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [participants, setParticipants] = useState('')
  const [location, setLocation] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [activityDate, setActivityDate] = useState(new Date().toISOString().split('T')[0])

  function resetForm() {
    setTitle(''); setDescription(''); setParticipants(''); setLocation(''); setDurationMinutes('')
    setActivityDate(new Date().toISOString().split('T')[0]); setActivityType('meeting')
    setEditingId(null)
  }

  function startEdit(a: ActivityView) {
    setEditingId(a.id); setShowForm(true)
    setTitle(a.title); setDescription(a.description ?? ''); setParticipants(String(a.participants))
    setLocation(a.location ?? ''); setDurationMinutes(a.durationMinutes ? String(a.durationMinutes) : '')
    setActivityDate(a.activityDate.split('T')[0]); setActivityType(a.activityType)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true)
    try {
      if (editingId) {
        await updateActivity({
          id: editingId, title, description, participants: parseInt(participants) || 0,
          location: location || undefined, durationMinutes: durationMinutes ? parseInt(durationMinutes) : undefined,
          activityType,
        })
      } else {
        await logActivity({
          orgAddress, activityType, title, description, participants: parseInt(participants) || 0,
          location: location || undefined, durationMinutes: durationMinutes ? parseInt(durationMinutes) : undefined,
          activityDate,
        })
        // Show chain prompt if there's a natural next step
        if (CHAIN_SUGGESTIONS[activityType]) {
          setShowChainPrompt(activityType)
          setShowForm(false)
          resetForm()
          // Don't reload — show the chain prompt
          setLoading(false)
          return
        }
      }
      window.location.reload()
    } catch { alert('Failed to save activity') }
    finally { setLoading(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this activity?')) return
    try { await deleteActivity(id); window.location.reload() } catch { alert('Failed to delete') }
  }

  const sorted = [...activities].sort((a, b) => b.activityDate.localeCompare(a.activityDate))

  // Calendar helpers
  const calendarMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
  const daysInMonth = new Date(parseInt(calendarMonth.split('-')[0]), parseInt(calendarMonth.split('-')[1]), 0).getDate()
  const firstDayOfWeek = new Date(parseInt(calendarMonth.split('-')[0]), parseInt(calendarMonth.split('-')[1]) - 1, 1).getDay()
  const activitiesByDate = new Map<string, ActivityView[]>()
  for (const a of activities) {
    const d = a.activityDate.split('T')[0]
    if (!activitiesByDate.has(d)) activitiesByDate.set(d, [])
    activitiesByDate.get(d)!.push(a)
  }

  return (
    <div>
      {/* View toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => setView('feed')} style={{
          padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #e2e4e8', cursor: 'pointer',
          background: view === 'feed' ? '#1565c0' : '#fff', color: view === 'feed' ? '#fff' : '#1a1a2e', fontWeight: 600, fontSize: '0.85rem',
        }}>Activity Feed</button>
        <button onClick={() => setView('calendar')} style={{
          padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #e2e4e8', cursor: 'pointer',
          background: view === 'calendar' ? '#1565c0' : '#fff', color: view === 'calendar' ? '#fff' : '#1a1a2e', fontWeight: 600, fontSize: '0.85rem',
        }}>Calendar</button>
      </div>

      {/* Log Form */}
      <section data-component="graph-section">
        <div data-component="section-header">
          <h2>{editingId ? 'Edit Activity' : 'Log Activity'}</h2>
          <button onClick={() => { setShowForm(!showForm); if (showForm) resetForm() }} data-component="section-action">
            {showForm ? 'Cancel' : '+ Log Activity'}
          </button>
        </div>
        {showForm && (
          <form onSubmit={handleSubmit} data-component="protocol-info">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <label><span style={labelStyle}>Type</span>
                <select value={activityType} onChange={e => setActivityType(e.target.value)} style={inputStyle}>
                  {ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select></label>
              <label><span style={labelStyle}>Date</span>
                <input type="date" value={activityDate} onChange={e => setActivityDate(e.target.value)} style={inputStyle} /></label>
              <label><span style={labelStyle}>Participants</span>
                <input type="number" value={participants} onChange={e => setParticipants(e.target.value)} placeholder="5" style={inputStyle} /></label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
              <label><span style={labelStyle}>Title</span>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What happened?" required style={inputStyle} /></label>
              <label><span style={labelStyle}>Location</span>
                <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Neighborhood" style={inputStyle} /></label>
              <label><span style={labelStyle}>Duration (min)</span>
                <input type="number" value={durationMinutes} onChange={e => setDurationMinutes(e.target.value)} placeholder="60" style={inputStyle} /></label>
            </div>
            <label style={{ display: 'block', marginTop: '0.75rem' }}><span style={labelStyle}>Notes</span>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Details, observations, follow-up needed..."
                style={{ ...inputStyle, resize: 'vertical' }} /></label>
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={loading}>{loading ? 'Saving...' : editingId ? 'Update Activity' : 'Log Activity'}</button>
              {editingId && <button type="button" onClick={() => { resetForm(); setShowForm(false) }} style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Cancel Edit</button>}
            </div>
          </form>
        )}
      </section>

      {/* Chain Prompt */}
      {showChainPrompt && CHAIN_SUGGESTIONS[showChainPrompt] && (
        <div style={{ padding: '1rem', background: '#f0fdf4', border: '2px solid #bbf7d0', borderRadius: 8, marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.2rem' }}>✓</span>
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#2e7d32' }}>Activity logged!</strong>
              <p style={{ fontSize: '0.85rem', color: '#424242', margin: '0.25rem 0 0' }}>
                Want to chain a follow-on activity? This links them together to track the flow.
              </p>
            </div>
            <button onClick={() => {
              const suggestion = CHAIN_SUGGESTIONS[showChainPrompt]
              setActivityType(suggestion.type)
              setShowForm(true)
              setShowChainPrompt(null)
            }} style={{ background: '#2e7d32', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              {CHAIN_SUGGESTIONS[showChainPrompt].label}
            </button>
            <button onClick={() => { setShowChainPrompt(null); window.location.reload() }}
              style={{ background: '#e0e0e0', color: '#1a1a2e', border: 'none', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Calendar View */}
      {view === 'calendar' && (
        <section data-component="graph-section">
          <h2>{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', fontSize: '0.8rem' }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontWeight: 600, color: '#616161', padding: '0.35rem' }}>{d}</div>
            ))}
            {Array.from({ length: firstDayOfWeek }, (_, i) => (
              <div key={`empty-${i}`} style={{ padding: '0.35rem' }} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const dateStr = `${calendarMonth}-${String(day).padStart(2, '0')}`
              const dayActivities = activitiesByDate.get(dateStr) ?? []
              const isToday = dateStr === new Date().toISOString().split('T')[0]
              return (
                <div key={day} style={{
                  padding: '0.35rem', minHeight: 60, borderRadius: 4,
                  background: isToday ? '#e3f2fd' : dayActivities.length > 0 ? '#fafafa' : '#fff',
                  border: `1px solid ${isToday ? '#1565c0' : '#e2e4e8'}`,
                }}>
                  <div style={{ fontWeight: isToday ? 700 : 400, fontSize: '0.75rem', color: isToday ? '#1565c0' : '#424242' }}>{day}</div>
                  {dayActivities.map(a => (
                    <div key={a.id} style={{
                      fontSize: '0.6rem', padding: '0.1rem 0.25rem', marginTop: '0.15rem', borderRadius: 3,
                      background: `${TYPE_COLORS[a.activityType] ?? '#616161'}15`,
                      color: TYPE_COLORS[a.activityType] ?? '#616161',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer',
                    }} title={a.title} onClick={() => startEdit(a)}>
                      {a.title}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Activity Feed */}
      {view === 'feed' && (
        <section data-component="graph-section">
          <h2>Activities ({activities.length})</h2>
          {sorted.length === 0 ? (
            <p data-component="text-muted">No activities logged yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {sorted.map(a => (
                <div key={a.id} data-component="protocol-info" style={{ padding: '0.75rem 1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{
                      fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: 4, fontWeight: 600,
                      background: `${TYPE_COLORS[a.activityType] ?? '#616161'}15`,
                      color: TYPE_COLORS[a.activityType] ?? '#616161',
                      border: `1px solid ${TYPE_COLORS[a.activityType] ?? '#616161'}30`,
                    }}>
                      {a.typeLabel}
                    </span>
                    <strong style={{ fontSize: '0.9rem' }}>{a.title}</strong>
                    <span style={{ fontSize: '0.75rem', color: '#9e9e9e', marginLeft: 'auto' }}>
                      {new Date(a.activityDate).toLocaleDateString()}
                    </span>
                    <button onClick={() => startEdit(a)} style={smallBtnStyle}>Edit</button>
                    <button onClick={() => handleDelete(a.id)} style={{ ...smallBtnStyle, color: '#b91c1c' }}>Del</button>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#616161', display: 'flex', gap: '1rem' }}>
                    <span>{a.userName}</span>
                    {a.participants > 0 && <span>{a.participants} participants</span>}
                    {a.location && <span>{a.location}</span>}
                    {a.durationMinutes && <span>{a.durationMinutes} min</span>}
                  </div>
                  {a.description && <p style={{ fontSize: '0.8rem', color: '#424242', margin: '0.25rem 0 0' }}>{a.description}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: '0.8rem', color: '#616161', display: 'block', marginBottom: '0.15rem' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }
const smallBtnStyle: React.CSSProperties = { fontSize: '0.65rem', padding: '0.15rem 0.35rem', background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 4, cursor: 'pointer', color: '#616161' }
