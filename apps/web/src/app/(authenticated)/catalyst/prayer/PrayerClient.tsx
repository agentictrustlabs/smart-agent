'use client'

import { useState, useEffect, useCallback } from 'react'
import { addPrayer, markPrayed, markAnswered, deletePrayer } from '@/lib/actions/prayer.action'

/* ── Types ──────────────────────────────────────────────────────────── */

interface Prayer {
  id: string
  userId: string
  title: string
  notes: string | null
  schedule: string
  lastPrayed: string | null
  answered: number
  answeredAt: string | null
  createdAt: string
}

interface Props {
  dueToday: Prayer[]
  notToday: Prayer[]
  answered: Prayer[]
  allActive: Prayer[]
  todayDay: string
  oikosPeople?: Array<{id: string, personName: string}>
  oikosNeedPrayer?: Array<{id: string, personName: string}>
}

/* ── Palette ────────────────────────────────────────────────────────── */

const CREAM = '#faf8f3'
const BROWN = '#8b5e3c'
const BROWN_LIGHT = '#c9a882'
const BROWN_BG = '#f5efe6'
const CARD_BORDER = '#e8dfd4'
const TEXT_MUTED = '#8a7e72'
const GREEN = '#3a7d44'
const GREEN_BG = '#eaf5ec'
const TEAL = '#0d9488'
const TEAL_BG = '#e6f7f5'
const TEAL_BORDER = '#99e6df'

/* ── Helpers ────────────────────────────────────────────────────────── */

const DAY_CHIPS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
] as const

function daysAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never prayed'
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Prayed today'
  if (diff === 1) return 'Last prayed 1 day ago'
  return `Last prayed ${diff} days ago`
}

function formatSchedule(schedule: string): string {
  if (schedule === 'daily') return 'Daily'
  return schedule.split(',').map(d => {
    const t = d.trim().toLowerCase()
    return t.charAt(0).toUpperCase() + t.slice(1)
  }).join(', ')
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

/* ── Toast ──────────────────────────────────────────────────────────── */

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 2500)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: '#1e293b', color: '#fff', padding: '0.6rem 1.2rem',
      borderRadius: 8, fontSize: '0.85rem', fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)', zIndex: 9999,
    }}>
      <span>{message}</span>
    </div>
  )
}

/* ── Modal Overlay ──────────────────────────────────────────────────── */

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, padding: '1.5rem',
        width: '100%', maxWidth: 440, boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
      }}>
        {children}
      </div>
    </div>
  )
}

/* ── Prayer Card ────────────────────────────────────────────────────── */

function PrayerCard({ prayer, muted, onPrayed, onAnswered, onDelete }: {
  prayer: Prayer
  muted?: boolean
  onPrayed: (id: string) => void
  onAnswered: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [justPrayed, setJustPrayed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const handlePrayed = () => {
    setJustPrayed(true)
    onPrayed(prayer.id)
    setTimeout(() => setJustPrayed(false), 1500)
  }

  return (
    <div style={{
      background: muted ? '#fdfcfa' : '#fff',
      border: `1px solid ${CARD_BORDER}`,
      borderRadius: 10,
      padding: '1rem 1.1rem',
      opacity: muted ? 0.7 : 1,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#2d2418', marginBottom: 4 }}>
            {prayer.title}
          </div>
          {prayer.notes && (
            <div style={{ fontSize: '0.82rem', color: TEXT_MUTED, marginBottom: 6 }}>
              {prayer.notes}
            </div>
          )}
          <div style={{ fontSize: '0.78rem', color: TEXT_MUTED, display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>{formatSchedule(prayer.schedule)}</span>
            <span>{daysAgo(prayer.lastPrayed)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 12, flexShrink: 0 }}>
          <button
            onClick={handlePrayed}
            style={{
              background: justPrayed ? GREEN : BROWN,
              color: '#fff',
              border: 'none',
              borderRadius: 20,
              padding: '0.4rem 1rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.3s',
              whiteSpace: 'nowrap',
            }}
          >
            {justPrayed ? 'Prayed!' : 'Mark Prayed'}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '1.1rem', color: TEXT_MUTED, padding: '0.2rem 0.4rem',
              }}
            >
              ...
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '100%',
                background: '#fff', border: `1px solid ${CARD_BORDER}`,
                borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                zIndex: 100, minWidth: 140, overflow: 'hidden',
              }}>
                <button
                  onClick={() => { onAnswered(prayer.id); setMenuOpen(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: 'none', border: 'none', padding: '0.5rem 0.75rem',
                    fontSize: '0.82rem', cursor: 'pointer', color: GREEN,
                  }}
                >
                  Mark Answered
                </button>
                <button
                  onClick={() => { onDelete(prayer.id); setMenuOpen(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: 'none', border: 'none', padding: '0.5rem 0.75rem',
                    fontSize: '0.82rem', cursor: 'pointer', color: '#c0392b',
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Main Component ─────────────────────────────────────────────────── */

export function PrayerClient({ dueToday, notToday, answered, allActive, todayDay: _todayDay, oikosPeople = [], oikosNeedPrayer = [] }: Props) {
  type View = 'main' | 'history' | 'answered'
  const [view, setView] = useState<View>('main')
  const [addOpen, setAddOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set())
  const [isDaily, setIsDaily] = useState(true)
  const [linkedOikosId, setLinkedOikosId] = useState<string>('')

  const showToast = useCallback((msg: string) => setToast(msg), [])

  const handleToggleDay = (day: string) => {
    setIsDaily(false)
    setSelectedDays(prev => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  const handleDailyToggle = () => {
    if (isDaily) {
      setIsDaily(false)
      setSelectedDays(new Set())
    } else {
      setIsDaily(true)
      setSelectedDays(new Set(DAY_CHIPS.map(d => d.key)))
    }
  }

  const handleAdd = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      const schedule = isDaily
        ? 'daily'
        : Array.from(selectedDays).join(',')
      await addPrayer({
        title: title.trim(),
        notes: notes.trim() || undefined,
        schedule: schedule || 'daily',
        linkedOikosId: linkedOikosId || undefined,
      })
      setTitle('')
      setNotes('')
      setSelectedDays(new Set())
      setIsDaily(true)
      setLinkedOikosId('')
      setAddOpen(false)
      showToast('Prayer focus added')
    } catch (err) {
      console.error(err)
      showToast('Failed to add prayer')
    } finally {
      setSaving(false)
    }
  }

  const handlePrayed = async (id: string) => {
    try {
      await markPrayed(id)
      showToast('Marked as prayed')
    } catch (err) {
      console.error(err)
    }
  }

  const handleAnswered = async (id: string) => {
    try {
      await markAnswered(id)
      showToast('Praise! Prayer marked answered')
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deletePrayer(id)
      showToast('Prayer removed')
    } catch (err) {
      console.error(err)
    }
  }

  // Build history from all active prayers sorted by lastPrayed
  const historyItems = allActive
    .filter(p => p.lastPrayed)
    .sort((a, b) => new Date(b.lastPrayed!).getTime() - new Date(a.lastPrayed!).getTime())

  /* ── Pill Button ──────────────────────────────────────────────────── */
  const Pill = ({ label, active, color, onClick }: {
    label: string; active: boolean; color?: string; onClick: () => void
  }) => (
    <button onClick={onClick} style={{
      background: active ? (color === 'green' ? GREEN_BG : BROWN_BG) : 'transparent',
      color: active ? (color === 'green' ? GREEN : BROWN) : TEXT_MUTED,
      border: `1px solid ${active ? (color === 'green' ? GREEN : BROWN) : CARD_BORDER}`,
      borderRadius: 20,
      padding: '0.3rem 0.85rem',
      fontSize: '0.82rem',
      fontWeight: 600,
      cursor: 'pointer',
    }}>
      {label}
    </button>
  )

  return (
    <div style={{ background: CREAM, minHeight: '100vh', padding: '0' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '1.25rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1 style={{ fontSize: '1.25rem', margin: 0, color: '#2d2418' }}>Prayer</h1>
          <Pill label="History" active={view === 'history'} onClick={() => setView(view === 'history' ? 'main' : 'history')} />
          <Pill label="Answered" active={view === 'answered'} color="green" onClick={() => setView(view === 'answered' ? 'main' : 'answered')} />
        </div>
        <button
          onClick={() => setAddOpen(true)}
          style={{
            background: BROWN,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '0.45rem 1rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Add
        </button>
      </div>

      {/* ── Main View ──────────────────────────────────────────────── */}
      {view === 'main' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Pray for Oikos */}
          {oikosNeedPrayer.length > 0 && (
            <div>
              <div style={{
                fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
                color: TEAL, textTransform: 'uppercase', marginBottom: '0.5rem',
              }}>
                Pray for Oikos &middot; {oikosNeedPrayer.length}
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: '0.4rem',
              }}>
                {oikosNeedPrayer.map(person => (
                  <div key={person.id} style={{
                    background: TEAL_BG,
                    border: `1px solid ${TEAL_BORDER}`,
                    borderRadius: 10,
                    padding: '0.75rem 1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem', color: '#2d2418' }}>
                        {person.personName}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: TEAL, fontWeight: 500 }}>
                        Needs prayer
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setTitle(`Pray for ${person.personName}`)
                        setLinkedOikosId(person.id)
                        setNotes('')
                        setSelectedDays(new Set())
                        setIsDaily(true)
                        setAddOpen(true)
                      }}
                      style={{
                        background: TEAL,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 20,
                        padding: '0.35rem 0.85rem',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      + Add Prayer
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Due Today */}
          <div>
            <div style={{
              fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
              color: BROWN, textTransform: 'uppercase', marginBottom: '0.5rem',
            }}>
              Pray Today &middot; {dueToday.length}
            </div>
            {dueToday.length === 0 && (
              <div style={{ fontSize: '0.85rem', color: TEXT_MUTED, padding: '0.75rem 0' }}>
                No prayers scheduled for today. Add one to get started.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {dueToday.map(p => (
                <PrayerCard
                  key={p.id}
                  prayer={p}
                  onPrayed={handlePrayed}
                  onAnswered={handleAnswered}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>

          {/* Not Scheduled Today */}
          {notToday.length > 0 && (
            <div>
              <div style={{
                fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
                color: TEXT_MUTED, textTransform: 'uppercase', marginBottom: '0.5rem',
              }}>
                Not Scheduled Today &middot; {notToday.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {notToday.map(p => (
                  <PrayerCard
                    key={p.id}
                    prayer={p}
                    muted
                    onPrayed={handlePrayed}
                    onAnswered={handleAnswered}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── History View ───────────────────────────────────────────── */}
      {view === 'history' && (
        <div>
          <div style={{
            fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
            color: BROWN, textTransform: 'uppercase', marginBottom: '0.75rem',
          }}>
            Prayer History
          </div>
          {historyItems.length === 0 && (
            <div style={{ fontSize: '0.85rem', color: TEXT_MUTED, padding: '0.75rem 0' }}>
              No prayer activity yet. Mark a prayer as prayed to see history here.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {historyItems.map(p => (
              <div key={p.id} style={{
                background: '#fff', border: `1px solid ${CARD_BORDER}`,
                borderRadius: 8, padding: '0.75rem 1rem',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#2d2418' }}>{p.title}</div>
                  <div style={{ fontSize: '0.78rem', color: TEXT_MUTED }}>
                    {formatSchedule(p.schedule)}
                  </div>
                </div>
                <div style={{ fontSize: '0.78rem', color: BROWN, fontWeight: 500 }}>
                  {daysAgo(p.lastPrayed)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Answered View ──────────────────────────────────────────── */}
      {view === 'answered' && (
        <div>
          <div style={{
            fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
            color: GREEN, textTransform: 'uppercase', marginBottom: '0.75rem',
          }}>
            Answered Prayers &middot; {answered.length}
          </div>
          {answered.length === 0 && (
            <div style={{ fontSize: '0.85rem', color: TEXT_MUTED, padding: '0.75rem 0' }}>
              No answered prayers yet. When God answers, mark it here to celebrate!
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {answered.map(p => (
              <div key={p.id} style={{
                background: GREEN_BG, border: `1px solid ${GREEN}33`,
                borderRadius: 10, padding: '1rem 1.1rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#2d2418', marginBottom: 2 }}>
                      {p.title}
                    </div>
                    {p.notes && (
                      <div style={{ fontSize: '0.82rem', color: TEXT_MUTED, marginBottom: 4 }}>
                        {p.notes}
                      </div>
                    )}
                    <div style={{ fontSize: '0.78rem', color: GREEN, fontWeight: 500 }}>
                      Answered {formatDate(p.answeredAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(p.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: '0.78rem', color: TEXT_MUTED, padding: '0.2rem 0.4rem',
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add Prayer Modal ───────────────────────────────────────── */}
      {addOpen && (
        <ModalOverlay onClose={() => setAddOpen(false)}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 1rem', color: '#2d2418' }}>
            Add Prayer Focus
          </h2>

          {/* Title */}
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#2d2418', display: 'block', marginBottom: 4 }}>
            Title
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What are you praying for?"
            style={{
              width: '100%', padding: '0.5rem 0.6rem',
              border: `1px solid ${CARD_BORDER}`, borderRadius: 8,
              fontSize: '0.9rem', marginBottom: '0.75rem',
              boxSizing: 'border-box',
            }}
          />

          {/* Link to Oikos person */}
          {oikosPeople.length > 0 && (
            <>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#2d2418', display: 'block', marginBottom: 4 }}>
                Link to Oikos Person
              </label>
              <select
                value={linkedOikosId}
                onChange={e => setLinkedOikosId(e.target.value)}
                style={{
                  width: '100%', padding: '0.5rem 0.6rem',
                  border: `1px solid ${CARD_BORDER}`, borderRadius: 8,
                  fontSize: '0.9rem', marginBottom: '0.75rem',
                  boxSizing: 'border-box', background: '#fff',
                  color: linkedOikosId ? '#2d2418' : TEXT_MUTED,
                }}
              >
                <option value="">-- None --</option>
                {oikosPeople.map(p => (
                  <option key={p.id} value={p.id}>{p.personName}</option>
                ))}
              </select>
            </>
          )}

          {/* Notes */}
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#2d2418', display: 'block', marginBottom: 4 }}>
            Notes
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Additional details, scripture references..."
            rows={3}
            style={{
              width: '100%', padding: '0.5rem 0.6rem',
              border: `1px solid ${CARD_BORDER}`, borderRadius: 8,
              fontSize: '0.9rem', marginBottom: '0.75rem',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />

          {/* Schedule */}
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#2d2418', display: 'block', marginBottom: 8 }}>
            Schedule
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '1rem' }}>
            <button
              onClick={handleDailyToggle}
              style={{
                background: isDaily ? BROWN : 'transparent',
                color: isDaily ? '#fff' : TEXT_MUTED,
                border: `1px solid ${isDaily ? BROWN : CARD_BORDER}`,
                borderRadius: 16,
                padding: '0.3rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Daily
            </button>
            {DAY_CHIPS.map(d => {
              const active = isDaily || selectedDays.has(d.key)
              return (
                <button
                  key={d.key}
                  onClick={() => handleToggleDay(d.key)}
                  style={{
                    background: active ? BROWN_BG : 'transparent',
                    color: active ? BROWN : TEXT_MUTED,
                    border: `1px solid ${active ? BROWN_LIGHT : CARD_BORDER}`,
                    borderRadius: 16,
                    padding: '0.3rem 0.7rem',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {d.label}
                </button>
              )
            })}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setAddOpen(false)}
              style={{
                background: 'transparent', border: `1px solid ${CARD_BORDER}`,
                borderRadius: 8, padding: '0.45rem 1rem',
                fontSize: '0.85rem', cursor: 'pointer', color: TEXT_MUTED,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={saving || !title.trim()}
              style={{
                background: BROWN, color: '#fff',
                border: 'none', borderRadius: 8,
                padding: '0.45rem 1rem', fontSize: '0.85rem',
                fontWeight: 600, cursor: saving ? 'default' : 'pointer',
                opacity: saving || !title.trim() ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
