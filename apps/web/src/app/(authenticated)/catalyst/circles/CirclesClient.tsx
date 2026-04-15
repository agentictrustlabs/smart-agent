'use client'

import { useState, useCallback, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  addOikosPerson as addCirclePerson,
  updateOikosPerson as updateCirclePerson,
  deleteOikosPerson as deleteCirclePerson,
  togglePlannedConversation,
} from '@/lib/actions/oikos.action'
import QuickActivityModal from '@/components/catalyst/QuickActivityModal'

// ─── Types ──────────────────────────────────────────────────────────

type Response = 'not-interested' | 'curious' | 'interested' | 'seeking' | 'decided' | 'baptized'

interface CirclePerson {
  id: string
  userId: string
  personName: string
  proximity: number
  response: Response
  plannedConversation: number
  tags: string | null
  notes: string | null
  createdAt: string
}

interface FormData {
  name: string
  proximity: number
  response: Response
  notes: string
  plannedConversation: boolean
  tags: string[]
  customTag: string
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

const TAGS = ['ESL Student', 'Farm Worker', 'Family Referral', 'Youth', 'New Believer', 'Leader Potential'] as const

const TAG_COLORS: Record<string, string> = {
  'ESL Student': '#6366f1',
  'Farm Worker': '#16a34a',
  'Family Referral': '#d97706',
  'Youth': '#0d9488',
  'New Believer': '#2563eb',
  'Leader Potential': '#7c3aed',
}

const EMPTY_FORM: FormData = {
  name: '',
  proximity: 3,
  response: 'curious',
  notes: '',
  plannedConversation: false,
  tags: [],
  customTag: '',
}

// ─── Component ──────────────────────────────────────────────────────

export function CirclesClient({
  circles,
  lastContactMap = {},
  orgAddress = '',
}: {
  circles: CirclePerson[]
  lastContactMap?: Record<string, string>
  orgAddress?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editPerson, setEditPerson] = useState<CirclePerson | null>(null)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [selectedPerson, setSelectedPerson] = useState<CirclePerson | null>(null)
  const [quickLogPerson, setQuickLogPerson] = useState<CirclePerson | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const popupRef = useRef<HTMLDivElement>(null)

  // ── Close popup on outside click ──────────────────────────────────

  useEffect(() => {
    if (!selectedPerson) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setSelectedPerson(null)
      }
    }
    // Delay adding so the current click doesn't immediately close it
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', handler)
    }
  }, [selectedPerson])

  // ── Response summary counts ─────────────────────────────────────

  const responseCounts = circles.reduce<Partial<Record<Response, number>>>((acc, c) => {
    acc[c.response] = (acc[c.response] ?? 0) + 1
    return acc
  }, {})

  const summaryResponses: Response[] = ['decided', 'seeking', 'interested', 'curious']

  // ── Tag filter helper ───────────────────────────────────────────

  const toggleTagFilter = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const filteredCircles = selectedTags.length === 0
    ? circles
    : circles.filter(p => {
        if (!p.tags) return false
        const personTags = p.tags.split(',').map(t => t.trim())
        return selectedTags.some(st => personTags.includes(st))
      })

  // ── Group people by proximity for list ──────────────────────────

  const groupedByProximity: Record<number, CirclePerson[]> = { 1: [], 2: [], 3: [], 4: [] }
  for (const p of filteredCircles) {
    const ring = Math.max(1, Math.min(4, p.proximity))
    groupedByProximity[ring].push(p)
  }

  // ── Handlers ────────────────────────────────────────────────────

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setEditPerson(null)
    setShowAddDialog(true)
    setSelectedPerson(null)
  }

  const openEdit = (person: CirclePerson) => {
    const existingTags = person.tags ? person.tags.split(',').map(t => t.trim()).filter(Boolean) : []
    const predefined = existingTags.filter(t => (TAGS as readonly string[]).includes(t))
    const custom = existingTags.filter(t => !(TAGS as readonly string[]).includes(t))
    setForm({
      name: person.personName,
      proximity: person.proximity,
      response: person.response,
      notes: person.notes ?? '',
      plannedConversation: Boolean(person.plannedConversation),
      tags: predefined,
      customTag: custom.join(', '),
    })
    setEditPerson(person)
    setShowAddDialog(true)
    setSelectedPerson(null)
  }

  const closeDialog = () => {
    setShowAddDialog(false)
    setEditPerson(null)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    const allTags = [
      ...form.tags,
      ...form.customTag.split(',').map(t => t.trim()).filter(Boolean),
    ]
    const tagsStr = allTags.length > 0 ? allTags.join(',') : undefined
    startTransition(async () => {
      if (editPerson) {
        await updateCirclePerson(editPerson.id, {
          name: form.name.trim(),
          proximity: form.proximity,
          response: form.response,
          notes: form.notes || undefined,
          plannedConversation: form.plannedConversation,
          tags: tagsStr ?? '',
        })
      } else {
        await addCirclePerson({
          name: form.name.trim(),
          proximity: form.proximity,
          response: form.response,
          notes: form.notes || undefined,
          plannedConversation: form.plannedConversation,
          tags: tagsStr,
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

  const selectPerson = (person: CirclePerson) => {
    setSelectedPerson((prev) => (prev?.id === person.id ? null : person))
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

  const positioned = positionPeople(filteredCircles)

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

      {/* Tag Filter Bar */}
      {circles.length > 0 && (
        <div style={{
          display: 'flex', gap: '0.35rem', flexWrap: 'wrap',
          marginBottom: '0.75rem',
        }}>
          {TAGS.map(tag => {
            const isActive = selectedTags.includes(tag)
            const tagColor = TAG_COLORS[tag] ?? '#78716c'
            return (
              <button
                key={tag}
                onClick={() => toggleTagFilter(tag)}
                style={{
                  padding: '0.25rem 0.6rem',
                  borderRadius: 999,
                  border: `1.5px solid ${isActive ? tagColor : '#d6d3d1'}`,
                  background: isActive ? `${tagColor}18` : '#fff',
                  color: isActive ? tagColor : '#78716c',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {tag}
              </button>
            )
          })}
          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              style={{
                padding: '0.25rem 0.6rem',
                borderRadius: 999,
                border: '1px solid #d6d3d1',
                background: '#f5f5f4',
                color: '#78716c',
                fontSize: '0.72rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Side-by-side: SVG left, People list right */}
      <div
        style={{
          display: 'flex',
          gap: '1.25rem',
          position: 'relative',
        }}
        className="circles-layout"
      >
        {/* Left: Concentric Circles Visualization */}
        <div
          style={{
            flex: '0 0 55%',
            background: '#fff',
            border: '1px solid #e7e5e4',
            borderRadius: '12px',
            padding: '1rem',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            minWidth: 0,
          }}
          className="circles-svg-panel"
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
            {positioned.map(({ person, x, y }) => {
              const isSelected = selectedPerson?.id === person.id
              return (
                <g
                  key={person.id}
                  onClick={() => selectPerson(person)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Highlight ring for selected person */}
                  {isSelected && (
                    <circle
                      cx={x}
                      cy={y}
                      r="17"
                      fill="none"
                      stroke="#8b5e3c"
                      strokeWidth="2.5"
                      opacity={0.8}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r="12"
                    fill={RESPONSE_COLORS[person.response]}
                    opacity={0.9}
                  />
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
              )
            })}

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

        {/* Right: People List grouped by proximity */}
        <div
          style={{
            flex: '0 0 calc(45% - 1.25rem)',
            background: '#fff',
            border: '1px solid #e7e5e4',
            borderRadius: '12px',
            padding: '0.75rem 1rem',
            maxHeight: 460,
            overflowY: 'auto',
            minWidth: 0,
          }}
          className="circles-list-panel"
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#78716c', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            PEOPLE ({circles.length})
          </div>

          {circles.length === 0 && (
            <div style={{
              padding: '1.25rem',
              background: '#faf8f3',
              borderRadius: '12px',
              border: '1px solid #e7e5e4',
              textAlign: 'center',
              margin: '1rem 0',
            }}>
              <p style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: '#292524',
                margin: '0 0 0.5rem',
                fontFamily: 'Georgia, serif',
              }}>
                Your oikos is waiting to be discovered.
              </p>
              <p style={{
                fontSize: '0.85rem',
                color: '#78716c',
                margin: '0 0 1rem',
                lineHeight: 1.55,
              }}>
                Think about the people God has placed around you &mdash; neighbors,
                coworkers, family. Add them here to begin praying for and
                sharing with them.
              </p>
              <button
                onClick={openAdd}
                style={{
                  background: '#8b5e3c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.5rem 1.25rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Add your first person
              </button>
            </div>
          )}

          {([1, 2, 3, 4] as const).map((ring) => {
            const people = groupedByProximity[ring]
            if (people.length === 0) return null
            return (
              <div key={ring} style={{ marginBottom: '0.5rem' }}>
                {/* Section header */}
                <div
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: '#a8a29e',
                    letterSpacing: '0.04em',
                    padding: '0.4rem 0 0.2rem',
                    borderBottom: '1px solid #f5f5f4',
                  }}
                >
                  {PROXIMITY_LABELS[ring]}
                </div>

                {people.map((person) => {
                  const isSelected = selectedPerson?.id === person.id
                  const lastDate = lastContactMap[person.id]
                  const daysAgo = lastDate
                    ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)
                    : null
                  return (
                    <div
                      key={person.id}
                      onClick={() => selectPerson(person)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.45rem 0.4rem',
                        borderBottom: '1px solid #f5f5f4',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        background: isSelected ? '#8b5e3c12' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
                        <span style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: RESPONSE_COLORS[person.response], flexShrink: 0,
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{
                              fontSize: '0.85rem', color: '#292524', fontWeight: 500,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {person.personName}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#a8a29e', flexShrink: 0 }}>
                              {PROXIMITY_LABELS[person.proximity]}
                            </span>
                            {person.tags && person.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                              <span key={tag} style={{
                                padding: '0.05rem 0.35rem', borderRadius: 999,
                                fontSize: '0.6rem', fontWeight: 600, flexShrink: 0,
                                background: `${TAG_COLORS[tag] ?? '#78716c'}18`,
                                color: TAG_COLORS[tag] ?? '#78716c',
                              }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                          {daysAgo !== null && (
                            <span style={{ fontSize: '0.65rem', color: '#a8a29e', lineHeight: 1.2 }}>
                              Last contact: {daysAgo === 0 ? 'today' : `${daysAgo}d ago`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                        {Boolean(person.plannedConversation) && (
                          <span style={{ fontSize: '0.85rem' }}>
                            💬
                          </span>
                        )}
                        {orgAddress && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setQuickLogPerson(person)
                            }}
                            title="Log contact"
                            style={{
                              background: 'none',
                              border: '1px solid #e7e5e4',
                              borderRadius: '5px',
                              padding: '0.15rem 0.35rem',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              color: '#78716c',
                              lineHeight: 1,
                            }}
                          >
                            📝
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Person Detail Popup */}
        {selectedPerson && (
          <div
            ref={popupRef}
            style={{
              position: 'absolute',
              top: '2rem',
              right: '1rem',
              width: 300,
              background: '#fff',
              border: '1px solid #d6d3d1',
              borderRadius: '12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              padding: '1.25rem',
              zIndex: 50,
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setSelectedPerson(null)}
              style={{
                position: 'absolute',
                top: '0.75rem',
                right: '0.75rem',
                background: 'none',
                border: 'none',
                fontSize: '1.1rem',
                color: '#a8a29e',
                cursor: 'pointer',
                padding: '0.15rem 0.35rem',
                lineHeight: 1,
              }}
              aria-label="Close"
            >
              ✕
            </button>

            {/* Name */}
            <h3 style={{
              margin: '0 0 0.85rem',
              fontSize: '1.1rem',
              fontWeight: 700,
              color: '#292524',
              fontFamily: 'Georgia, serif',
              paddingRight: '1.5rem',
            }}>
              {selectedPerson.personName}
            </h3>

            {/* Response */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: RESPONSE_COLORS[selectedPerson.response], display: 'inline-block',
              }} />
              <span style={{ fontSize: '0.85rem', color: '#44403c', fontWeight: 500 }}>
                {RESPONSE_LABELS[selectedPerson.response]}
              </span>
            </div>

            {/* Proximity ring */}
            <div style={{ fontSize: '0.85rem', color: '#78716c', marginBottom: '0.4rem' }}>
              Ring: {PROXIMITY_LABELS[selectedPerson.proximity]}
            </div>

            {/* Planned conversation status */}
            <div style={{ fontSize: '0.85rem', color: '#78716c', marginBottom: '0.4rem' }}>
              {selectedPerson.plannedConversation
                ? '💬 Planned conversation'
                : 'No conversation planned'}
            </div>

            {/* Tags */}
            {selectedPerson.tags && (
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                {selectedPerson.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                  <span key={tag} style={{
                    padding: '0.12rem 0.45rem', borderRadius: 999,
                    fontSize: '0.7rem', fontWeight: 600,
                    background: `${TAG_COLORS[tag] ?? '#78716c'}18`,
                    color: TAG_COLORS[tag] ?? '#78716c',
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Last contact */}
            {(() => {
              const lcd = lastContactMap[selectedPerson.id]
              if (!lcd) return (
                <div style={{ fontSize: '0.82rem', color: '#a8a29e', marginBottom: '0.75rem' }}>
                  No contact logged yet
                </div>
              )
              const d = Math.floor((Date.now() - new Date(lcd).getTime()) / 86400000)
              return (
                <div style={{ fontSize: '0.82rem', color: '#78716c', marginBottom: '0.75rem' }}>
                  Last contact: {d === 0 ? 'today' : `${d} day${d !== 1 ? 's' : ''} ago`}
                </div>
              )
            })()}

            {/* Notes */}
            {selectedPerson.notes && (
              <div style={{ marginBottom: '0.85rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a8a29e', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>
                  Notes
                </div>
                <div style={{
                  fontSize: '0.82rem',
                  color: '#57534e',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}>
                  {selectedPerson.notes}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => openEdit(selectedPerson)}
                style={{
                  flex: 1,
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #d6d3d1',
                  background: '#fff',
                  color: '#57534e',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Edit
              </button>
              {orgAddress && (
                <button
                  onClick={() => {
                    setQuickLogPerson(selectedPerson)
                    setSelectedPerson(null)
                  }}
                  style={{
                    flex: 1,
                    padding: '0.45rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #d6d3d1',
                    background: '#fff',
                    color: '#57534e',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  📝 Log Activity
                </button>
              )}
              <button
                onClick={() => handleTogglePlanned(selectedPerson.id)}
                disabled={isPending}
                style={{
                  flex: 1,
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: selectedPerson.plannedConversation ? '#78716c' : '#8b5e3c',
                  color: '#fff',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: isPending ? 0.5 : 1,
                }}
              >
                {selectedPerson.plannedConversation ? 'Unplan' : 'Plan Conversation'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Responsive style: stack on narrow screens */}
      <style>{`
        @media (max-width: 768px) {
          .circles-layout {
            flex-direction: column !important;
          }
          .circles-svg-panel,
          .circles-list-panel {
            flex: 1 1 auto !important;
          }
        }
      `}</style>

      {/* Quick Activity Log Modal */}
      {quickLogPerson && orgAddress && (
        <QuickActivityModal
          orgAddress={orgAddress}
          defaultType="follow-up"
          defaultTitle={`Connected with ${quickLogPerson.personName}`}
          isOpen={true}
          onClose={() => setQuickLogPerson(null)}
        />
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

            {/* Tags */}
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#57534e', display: 'block', marginBottom: '0.35rem' }}>
                Tags
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.4rem' }}>
                {TAGS.map(tag => {
                  const isChecked = form.tags.includes(tag)
                  const tagColor = TAG_COLORS[tag] ?? '#78716c'
                  return (
                    <label key={tag} style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      padding: '0.25rem 0.55rem', borderRadius: 999, cursor: 'pointer',
                      border: `1.5px solid ${isChecked ? tagColor : '#d6d3d1'}`,
                      background: isChecked ? `${tagColor}18` : '#fff',
                      color: isChecked ? tagColor : '#78716c',
                      fontSize: '0.75rem', fontWeight: 600,
                      transition: 'all 0.15s',
                    }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setForm(prev => ({
                            ...prev,
                            tags: isChecked
                              ? prev.tags.filter(t => t !== tag)
                              : [...prev.tags, tag],
                          }))
                        }}
                        style={{ display: 'none' }}
                      />
                      {tag}
                    </label>
                  )
                })}
              </div>
              <input
                type="text"
                value={form.customTag}
                onChange={(e) => setForm({ ...form, customTag: e.target.value })}
                placeholder="Custom tags (comma separated)"
                style={{
                  display: 'block', width: '100%',
                  padding: '0.4rem 0.75rem', border: '1px solid #d6d3d1',
                  borderRadius: '8px', fontSize: '0.82rem', boxSizing: 'border-box',
                  color: '#57534e',
                }}
              />
            </div>

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
