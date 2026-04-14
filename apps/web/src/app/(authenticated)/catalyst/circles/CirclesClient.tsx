'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addCirclePerson,
  updateCirclePerson,
  deleteCirclePerson,
  togglePlannedConversation,
} from '@/lib/actions/circles.action'

// ─── Types ──────────────────────────────────────────────────────────

type Response = 'not-interested' | 'curious' | 'interested' | 'seeking' | 'decided' | 'baptized'

interface CirclePerson {
  id: string
  userId: string
  personName: string
  proximity: number
  response: Response
  plannedConversation: number
  notes: string | null
  createdAt: string
}

interface FormData {
  name: string
  proximity: number
  response: Response
  notes: string
  plannedConversation: boolean
}

// ─── Constants ──────────────────────────────────────────────────────

const RESPONSE_COLORS: Record<Response, string> = {
  'decided': '#16a34a',
  'seeking': '#0d9488',
  'interested': '#d97706',
  'curious': '#6b7280',
  'not-interested': '#dc2626',
  'baptized': '#2563eb',
}

const RESPONSE_LABELS: Record<Response, string> = {
  'decided': 'Decided to follow',
  'seeking': 'Seeking',
  'interested': 'Interested',
  'curious': 'Curious',
  'not-interested': 'Not interested',
  'baptized': 'Baptized',
}

const PROXIMITY_LABELS: Record<number, string> = {
  1: 'Closest',
  2: 'Near',
  3: 'Acquaintance',
  4: 'Outer',
}

const EMPTY_FORM: FormData = {
  name: '',
  proximity: 3,
  response: 'curious',
  notes: '',
  plannedConversation: false,
}

// ─── Component ──────────────────────────────────────────────────────

export function CirclesClient({ circles }: { circles: CirclePerson[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editPerson, setEditPerson] = useState<CirclePerson | null>(null)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)

  // ── Response summary counts ─────────────────────────────────────

  const responseCounts = circles.reduce<Partial<Record<Response, number>>>((acc, c) => {
    acc[c.response] = (acc[c.response] ?? 0) + 1
    return acc
  }, {})

  const summaryResponses: Response[] = ['decided', 'seeking', 'interested', 'curious']

  // ── Handlers ────────────────────────────────────────────────────

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setEditPerson(null)
    setShowAddDialog(true)
  }

  const openEdit = (person: CirclePerson) => {
    setForm({
      name: person.personName,
      proximity: person.proximity,
      response: person.response,
      notes: person.notes ?? '',
      plannedConversation: Boolean(person.plannedConversation),
    })
    setEditPerson(person)
    setShowAddDialog(true)
  }

  const closeDialog = () => {
    setShowAddDialog(false)
    setEditPerson(null)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    startTransition(async () => {
      if (editPerson) {
        await updateCirclePerson(editPerson.id, {
          name: form.name.trim(),
          proximity: form.proximity,
          response: form.response,
          notes: form.notes || undefined,
          plannedConversation: form.plannedConversation,
        })
      } else {
        await addCirclePerson({
          name: form.name.trim(),
          proximity: form.proximity,
          response: form.response,
          notes: form.notes || undefined,
          plannedConversation: form.plannedConversation,
        })
      }
      closeDialog()
      router.refresh()
    })
  }

  const handleDelete = async () => {
    if (!editPerson) return
    startTransition(async () => {
      await deleteCirclePerson(editPerson.id)
      closeDialog()
      router.refresh()
    })
  }

  const handleTogglePlanned = async (id: string) => {
    startTransition(async () => {
      await togglePlannedConversation(id)
      router.refresh()
    })
  }

  // ── SVG Positions ───────────────────────────────────────────────

  const positionPeople = useCallback((people: CirclePerson[]) => {
    const cx = 200
    const cy = 200
    const ringRadii: Record<number, number> = { 1: 50, 2: 95, 3: 140, 4: 180 }

    const byRing: Record<number, CirclePerson[]> = { 1: [], 2: [], 3: [], 4: [] }
    for (const p of people) {
      const ring = Math.max(1, Math.min(4, p.proximity))
      byRing[ring].push(p)
    }

    const positioned: { person: CirclePerson; x: number; y: number }[] = []
    for (const ring of [1, 2, 3, 4]) {
      const list = byRing[ring]
      const r = ringRadii[ring]
      list.forEach((person, i) => {
        const angle = (2 * Math.PI * i) / list.length - Math.PI / 2
        positioned.push({
          person,
          x: cx + r * Math.cos(angle),
          y: cy + r * Math.sin(angle),
        })
      })
    }
    return positioned
  }, [])

  const positioned = positionPeople(circles)

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div style={{ background: '#faf8f3', minHeight: '100vh', padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#292524', margin: 0, fontFamily: 'Georgia, serif' }}>
            Oikos
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#78716c', margin: '0.25rem 0 0' }}>
            Your relational world — the people God has placed around you
          </p>
        </div>
        <button
          onClick={openAdd}
          style={{
            background: '#8b5e3c',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '0.5rem 1rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Add a person
        </button>
      </div>

      {/* Response Summary Card */}
      {circles.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e7e5e4',
            borderRadius: '12px',
            padding: '1rem 1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#78716c', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            {circles.length} RESPONSES &mdash; Where each person is in their walk toward Jesus
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {summaryResponses.map((r) => {
              const count = responseCounts[r]
              if (!count) return null
              return (
                <span
                  key={r}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: `${RESPONSE_COLORS[r]}18`,
                    color: RESPONSE_COLORS[r],
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    padding: '0.25rem 0.65rem',
                    borderRadius: '999px',
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: RESPONSE_COLORS[r], display: 'inline-block',
                  }} />
                  {RESPONSE_LABELS[r]} ({count})
                </span>
              )
            })}
            {/* Show baptized and not-interested if they exist */}
            {(['baptized', 'not-interested'] as Response[]).map((r) => {
              const count = responseCounts[r]
              if (!count) return null
              return (
                <span
                  key={r}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: `${RESPONSE_COLORS[r]}18`,
                    color: RESPONSE_COLORS[r],
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    padding: '0.25rem 0.65rem',
                    borderRadius: '999px',
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: RESPONSE_COLORS[r], display: 'inline-block',
                  }} />
                  {RESPONSE_LABELS[r]} ({count})
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Concentric Circles Visualization */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e7e5e4',
          borderRadius: '12px',
          padding: '1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 400 400" width="100%" style={{ maxWidth: 420, maxHeight: 420 }}>
          {/* Ring 4 */}
          <circle cx="200" cy="200" r="180" fill="none" stroke="#e7e5e4" strokeWidth="1" />
          {/* Ring 3 */}
          <circle cx="200" cy="200" r="140" fill="none" stroke="#d6d3d1" strokeWidth="1" />
          {/* Ring 2 */}
          <circle cx="200" cy="200" r="95" fill="none" stroke="#c4b5a5" strokeWidth="1" />
          {/* Ring 1 */}
          <circle cx="200" cy="200" r="50" fill="none" stroke="#a8967a" strokeWidth="1" />

          {/* Ring labels */}
          <text x="200" y="18" textAnchor="middle" fontSize="9" fill="#a8a29e">Outer</text>
          <text x="200" y="58" textAnchor="middle" fontSize="9" fill="#a8a29e">Acquaintance</text>
          <text x="200" y="103" textAnchor="middle" fontSize="9" fill="#a8a29e">Near</text>
          <text x="200" y="148" textAnchor="middle" fontSize="9" fill="#a8a29e">Closest</text>

          {/* Center "Me" dot */}
          <circle cx="200" cy="200" r="14" fill="#8b5e3c" />
          <text x="200" y="204" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="700">Me</text>

          {/* People */}
          {positioned.map(({ person, x, y }) => (
            <g
              key={person.id}
              onClick={() => openEdit(person)}
              style={{ cursor: 'pointer' }}
            >
              <circle cx={x} cy={y} r="12" fill={RESPONSE_COLORS[person.response]} opacity={0.9} />
              <text
                x={x}
                y={y + 22}
                textAnchor="middle"
                fontSize="8"
                fill="#44403c"
                fontWeight="500"
              >
                {person.personName.length > 10
                  ? person.personName.slice(0, 9) + '\u2026'
                  : person.personName}
              </text>
              {/* Planned conversation indicator */}
              {Boolean(person.plannedConversation) && (
                <circle cx={x + 9} cy={y - 9} r="3" fill="#f59e0b" stroke="#fff" strokeWidth="1" />
              )}
            </g>
          ))}

          {/* Empty state helper text */}
          {circles.length === 0 && (
            <text x="200" y="240" textAnchor="middle" fontSize="11" fill="#a8a29e">
              Tap &quot;+ Add a person&quot; to add someone
            </text>
          )}
          {circles.length === 0 && (
            <text x="200" y="256" textAnchor="middle" fontSize="10" fill="#a8a29e">
              you want to pray for and share with
            </text>
          )}
        </svg>
      </div>

      {/* People list with planned conversation toggles */}
      {circles.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e7e5e4',
            borderRadius: '12px',
            padding: '0.75rem 1rem',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#78716c', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            PEOPLE ({circles.length})
          </div>
          {circles.map((person) => (
            <div
              key={person.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0',
                borderBottom: '1px solid #f5f5f4',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', flex: 1 }}
                onClick={() => openEdit(person)}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: RESPONSE_COLORS[person.response], flexShrink: 0,
                }} />
                <span style={{ fontSize: '0.9rem', color: '#292524', fontWeight: 500 }}>
                  {person.personName}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#a8a29e' }}>
                  {PROXIMITY_LABELS[person.proximity]}
                </span>
              </div>
              <button
                onClick={() => handleTogglePlanned(person.id)}
                disabled={isPending}
                title={person.plannedConversation ? 'Conversation planned' : 'Plan a conversation'}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  opacity: person.plannedConversation ? 1 : 0.3,
                  padding: '0.25rem',
                }}
              >
                💬
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      {showAddDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeDialog() }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '16px',
              width: '100%',
              maxWidth: 420,
              padding: '1.5rem',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.15rem', fontWeight: 700, color: '#292524', fontFamily: 'Georgia, serif' }}>
              {editPerson ? 'Edit Person' : 'Add a Person'}
            </h2>

            {/* Name */}
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#57534e' }}>Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Enter name"
                style={{
                  display: 'block', width: '100%', marginTop: '0.25rem',
                  padding: '0.5rem 0.75rem', border: '1px solid #d6d3d1',
                  borderRadius: '8px', fontSize: '0.9rem', boxSizing: 'border-box',
                }}
              />
            </label>

            {/* Proximity rings */}
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#57534e', display: 'block', marginBottom: '0.35rem' }}>
                Proximity
              </span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {([1, 2, 3, 4] as const).map((ring) => (
                  <button
                    key={ring}
                    onClick={() => setForm({ ...form, proximity: ring })}
                    style={{
                      flex: 1,
                      padding: '0.45rem 0',
                      borderRadius: '8px',
                      border: form.proximity === ring ? '2px solid #8b5e3c' : '1px solid #d6d3d1',
                      background: form.proximity === ring ? '#8b5e3c' : '#fff',
                      color: form.proximity === ring ? '#fff' : '#57534e',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {ring}. {PROXIMITY_LABELS[ring]}
                  </button>
                ))}
              </div>
            </div>

            {/* Response */}
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#57534e' }}>Response</span>
              <select
                value={form.response}
                onChange={(e) => setForm({ ...form, response: e.target.value as Response })}
                style={{
                  display: 'block', width: '100%', marginTop: '0.25rem',
                  padding: '0.5rem 0.75rem', border: '1px solid #d6d3d1',
                  borderRadius: '8px', fontSize: '0.9rem', boxSizing: 'border-box',
                  background: '#fff',
                }}
              >
                <option value="not-interested">Not interested</option>
                <option value="curious">Curious</option>
                <option value="interested">Interested</option>
                <option value="seeking">Seeking</option>
                <option value="decided">Decided to follow</option>
                <option value="baptized">Baptized</option>
              </select>
            </label>

            {/* Notes */}
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#57534e' }}>Notes</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Any notes about this person..."
                rows={3}
                style={{
                  display: 'block', width: '100%', marginTop: '0.25rem',
                  padding: '0.5rem 0.75rem', border: '1px solid #d6d3d1',
                  borderRadius: '8px', fontSize: '0.9rem', boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />
            </label>

            {/* Planned conversation checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.plannedConversation}
                onChange={(e) => setForm({ ...form, plannedConversation: e.target.checked })}
                style={{ accentColor: '#8b5e3c', width: 16, height: 16 }}
              />
              <span style={{ fontSize: '0.85rem', color: '#57534e' }}>Plan a conversation</span>
            </label>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between' }}>
              <div>
                {editPerson && (
                  <button
                    onClick={handleDelete}
                    disabled={isPending}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '8px',
                      border: '1px solid #fca5a5',
                      background: '#fff',
                      color: '#dc2626',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={closeDialog}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid #d6d3d1',
                    background: '#fff',
                    color: '#57534e',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isPending || !form.name.trim()}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#8b5e3c',
                    color: '#fff',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    opacity: isPending || !form.name.trim() ? 0.5 : 1,
                  }}
                >
                  {isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
