'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { logActivity } from '@/lib/actions/activity.action'

// ─── Types ──────────────────────────────────────────────────────────

interface Meeting {
  id: string
  title: string
  description: string | null
  participants: number
  activityDate: string
  location: string | null
}

interface Props {
  meetings: Meeting[]
  circleAddress: string
  orgAddress: string
}

// ─── Component ──────────────────────────────────────────────────────

export function MeetingLog({ meetings, circleAddress, orgAddress }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [attendees, setAttendees] = useState('')
  const [topics, setTopics] = useState('')
  const [actionItems, setActionItems] = useState('')

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0])
    setAttendees('')
    setTopics('')
    setActionItems('')
    setShowForm(false)
  }

  const handleSubmit = () => {
    const count = parseInt(attendees, 10) || 0
    if (!date) return

    const descParts: string[] = []
    if (topics.trim()) descParts.push(`Topics:\n${topics.trim()}`)
    if (actionItems.trim()) descParts.push(`Action Items:\n${actionItems.trim()}`)
    const description = descParts.join('\n\n') || undefined

    startTransition(async () => {
      await logActivity({
        orgAddress,
        activityType: 'meeting',
        title: `Circle Meeting - ${date}`,
        description,
        participants: count,
        relatedEntity: circleAddress,
        activityDate: date,
      })
      resetForm()
      router.refresh()
    })
  }

  const sorted = [...meetings].sort(
    (a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime()
  )

  return (
    <div style={{ marginTop: '1rem' }}>
      {/* Header + toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
          Meeting Log
        </span>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            padding: '0.35rem 0.85rem',
            borderRadius: 6,
            border: 'none',
            background: showForm ? '#78716c' : '#8b5e3c',
            color: '#fff',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showForm ? 'Cancel' : '+ Log Meeting'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{
          padding: '1rem',
          background: '#faf8f3',
          borderRadius: 10,
          border: '1px solid #ece6db',
          marginBottom: '1rem',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#616161', display: 'block', marginBottom: '0.15rem' }}>Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{
                  width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8',
                  borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box',
                }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#616161', display: 'block', marginBottom: '0.15rem' }}>Attendees</span>
              <input
                type="number"
                min="0"
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                placeholder="0"
                style={{
                  width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8',
                  borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box',
                }}
              />
            </label>
          </div>

          <label style={{ display: 'block', marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#616161', display: 'block', marginBottom: '0.15rem' }}>Topics Discussed</span>
            <textarea
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              rows={2}
              placeholder="What was discussed..."
              style={{
                width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8',
                borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box', resize: 'vertical',
              }}
            />
          </label>

          <label style={{ display: 'block', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#616161', display: 'block', marginBottom: '0.15rem' }}>Action Items</span>
            <textarea
              value={actionItems}
              onChange={(e) => setActionItems(e.target.value)}
              rows={2}
              placeholder="Follow-up actions..."
              style={{
                width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8',
                borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box', resize: 'vertical',
              }}
            />
          </label>

          <button
            onClick={handleSubmit}
            disabled={isPending || !date}
            style={{
              padding: '0.45rem 1.25rem',
              borderRadius: 6,
              border: 'none',
              background: '#8b5e3c',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: isPending || !date ? 0.5 : 1,
            }}
          >
            {isPending ? 'Saving...' : 'Save Meeting'}
          </button>
        </div>
      )}

      {/* Timeline */}
      {sorted.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: '#9a8c7e', textAlign: 'center', padding: '1rem' }}>
          No meetings logged yet. Tap &quot;+ Log Meeting&quot; to record your first one.
        </p>
      ) : (
        <div style={{ borderLeft: '3px solid #d6cfc4', paddingLeft: '1rem', marginLeft: '0.25rem' }}>
          {sorted.map((m) => (
            <div key={m.id} style={{ marginBottom: '0.85rem', position: 'relative' }}>
              {/* Timeline dot */}
              <div style={{
                position: 'absolute', left: '-1.38rem', top: '0.25rem',
                width: 10, height: 10, borderRadius: '50%',
                background: '#8b5e3c', border: '2px solid #fff',
              }} />
              <div style={{
                background: '#fff',
                border: '1px solid #ece6db',
                borderRadius: 8,
                padding: '0.65rem 0.85rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#5c4a3a' }}>
                    {m.activityDate?.split('T')[0] ?? 'Unknown date'}
                  </span>
                  <span style={{
                    fontSize: '0.72rem', color: '#8b5e3c', fontWeight: 600,
                    background: '#8b5e3c12', padding: '0.1rem 0.45rem', borderRadius: 999,
                  }}>
                    {m.participants} attendee{m.participants !== 1 ? 's' : ''}
                  </span>
                </div>
                {m.description && (
                  <div style={{ fontSize: '0.8rem', color: '#57534e', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {m.description}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
