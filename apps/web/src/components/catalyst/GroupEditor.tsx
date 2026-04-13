'use client'

import { useState } from 'react'
import { ChurchCircle, type HealthData, DEFAULT_HEALTH } from './ChurchCircle'

export interface GroupData {
  id?: string
  name: string
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
  onSave: (data: GroupData) => Promise<void>
  onClose: () => void
  mode: 'create' | 'edit'
}

const lbl: React.CSSProperties = { fontSize: '0.8rem', color: '#616161', display: 'block', marginBottom: '0.15rem' }
const inp: React.CSSProperties = { width: '100%', padding: '0.45rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }
const chk: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', cursor: 'pointer' }

export function GroupEditor({ initial, parentName, onSave, onClose, mode }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [leader, setLeader] = useState(initial?.leaderName ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? new Date().toISOString().split('T')[0])
  const [peoplGroup, setPeoplGroup] = useState(initial?.peoplGroup ?? '')
  const [health, setHealth] = useState<HealthData>(initial?.health ?? { ...DEFAULT_HEALTH })
  const [status] = useState(initial?.status ?? 'active')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ id: initial?.id, name, location, leaderName: leader, startDate, peoplGroup, health, status })
    } catch { /* handled by parent */ }
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 420, height: '100vh', zIndex: 1100,
      background: 'white', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', overflowY: 'auto',
      borderLeft: '3px solid #0d9488', padding: '1.25rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{mode === 'create' ? 'New Group' : 'Edit Group'}</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#616161' }}>✕</button>
      </div>

      {parentName && (
        <div style={{ fontSize: '0.8rem', color: '#0d9488', marginBottom: '0.75rem' }}>
          Under: <strong>{parentName}</strong>
        </div>
      )}

      {/* Identity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
        <label><span style={lbl}>Name *</span><input value={name} onChange={e => setName(e.target.value)} placeholder="Group name" style={inp} /></label>
        <label><span style={lbl}>Location</span><input value={location} onChange={e => setLocation(e.target.value)} placeholder="City or area" style={inp} /></label>
        <label><span style={lbl}>Leader</span><input value={leader} onChange={e => setLeader(e.target.value)} placeholder="Leader name" style={inp} /></label>
        <label><span style={lbl}>Start Date</span><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} /></label>
      </div>

      {/* Status */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
        <label><span style={lbl}>Established?</span>
          <select value={health.isChurch ? 'yes' : 'no'} onChange={e => setHealth({ ...health, isChurch: e.target.value === 'yes' })} style={inp}>
            <option value="no">No (gathering)</option>
            <option value="yes">Yes (established)</option>
          </select>
        </label>
        <label><span style={lbl}>Meeting Frequency</span>
          <select value={health.meetingFrequency ?? 'weekly'} onChange={e => setHealth({ ...health, meetingFrequency: e.target.value })} style={inp}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
            <option value="multiple">Multiple/week</option>
          </select>
        </label>
      </div>

      <label style={{ display: 'block', marginBottom: '0.75rem' }}>
        <span style={lbl}>People Group</span>
        <input value={peoplGroup} onChange={e => setPeoplGroup(e.target.value)} placeholder="e.g. Vietnamese" style={inp} />
      </label>

      {/* Health Metrics */}
      <div style={{ padding: '0.75rem', background: '#fafafa', borderRadius: 8, border: '1px solid #e2e4e8', marginBottom: '0.75rem' }}>
        <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>Health Metrics</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
          <label><span style={{ ...lbl, color: '#1565c0' }}>Attenders</span>
            <input type="number" min={0} value={health.attenders ?? health.seekers} onChange={e => setHealth({ ...health, attenders: +e.target.value || 0, seekers: +e.target.value || 0 })} style={inp} /></label>
          <label><span style={{ ...lbl, color: '#ea580c' }}>Believers</span>
            <input type="number" min={0} value={health.believers} onChange={e => setHealth({ ...health, believers: +e.target.value || 0 })} style={inp} /></label>
          <label><span style={{ ...lbl, color: '#2e7d32' }}>Baptized</span>
            <input type="number" min={0} value={health.baptized} onChange={e => setHealth({ ...health, baptized: +e.target.value || 0 })} style={inp} /></label>
          <label><span style={{ ...lbl, color: '#7c3aed' }}>Leaders</span>
            <input type="number" min={0} value={health.leaders} onChange={e => setHealth({ ...health, leaders: +e.target.value || 0 })} style={inp} /></label>
          <label><span style={lbl}>Groups Started</span>
            <input type="number" min={0} value={health.groupsStarted} onChange={e => setHealth({ ...health, groupsStarted: +e.target.value || 0 })} style={inp} /></label>
        </div>
      </div>

      {/* Practices */}
      <div style={{ padding: '0.75rem', background: '#fafafa', borderRadius: 8, border: '1px solid #e2e4e8', marginBottom: '0.75rem' }}>
        <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>Practices</strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
          <label style={chk}><input type="checkbox" checked={health.baptismSelf} onChange={e => setHealth({ ...health, baptismSelf: e.target.checked })} /> Baptism (self)</label>
          <label style={chk}><input type="checkbox" checked={health.teachingSelf} onChange={e => setHealth({ ...health, teachingSelf: e.target.checked })} /> Teaching (self)</label>
          <label style={chk}><input type="checkbox" checked={health.giving} onChange={e => setHealth({ ...health, giving: e.target.checked })} /> Practicing giving</label>
          <label style={chk}><input type="checkbox" checked={health.givingSelf} onChange={e => setHealth({ ...health, givingSelf: e.target.checked })} /> Giving (self-directed)</label>
        </div>
      </div>

      {/* Preview */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', padding: '0.75rem', background: '#f5f5f5', borderRadius: 8 }}>
        <ChurchCircle health={health} size={80} />
        <div style={{ fontSize: '0.75rem', color: '#616161' }}>
          <div>{health.isChurch ? 'Solid = Established' : 'Dashed = Gathering'}</div>
          <div style={{ marginTop: '0.2rem' }}>TL: Attenders | TR: Baptized</div>
          <div>BL: Believers | BR: Leaders</div>
          <div style={{ marginTop: '0.2rem' }}>Dots = self-functioning practices</div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={handleSave} disabled={saving || !name.trim()}
          style={{ flex: 1, padding: '0.6rem', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
          {saving ? 'Saving...' : mode === 'create' ? 'Create Group' : 'Save Changes'}
        </button>
        <button onClick={onClose}
          style={{ padding: '0.6rem 1rem', background: '#e0e0e0', color: '#1a1a2e', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
