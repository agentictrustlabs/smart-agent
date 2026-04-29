'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { logActivity } from '@/lib/actions/activity.action'
import { listOpenNeedsForActor, type PickerOption } from '@/lib/actions/discover.action'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  orgAddress: string
  defaultType?: string
  defaultTitle?: string
  defaultRelatedEntity?: string
  /** Pre-fill the "Fulfills which need?" dropdown — e.g. /needs/[id] deep-link. */
  defaultFulfillsNeedId?: string
  /** Hub scope for the open-needs dropdown. Defaults to 'catalyst'. */
  hubId?: string
  // Controlled mode
  isOpen?: boolean
  onClose?: () => void
  // FAB mode (default)
  showFab?: boolean
}

const ACTIVITY_TYPES = [
  'outreach', 'visit', 'training', 'meeting', 'coaching',
  'follow-up', 'prayer', 'service', 'other',
] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuickActivityModal({
  orgAddress,
  defaultType,
  defaultTitle,
  defaultRelatedEntity,
  defaultFulfillsNeedId,
  hubId = 'catalyst',
  isOpen: controlledOpen,
  onClose,
  showFab = false,
}: Props) {
  const router = useRouter()
  const [fabOpen, setFabOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(false)

  // Form state
  const today = new Date().toISOString().split('T')[0]
  const [activityType, setActivityType] = useState(defaultType || 'other')
  const [title, setTitle] = useState(defaultTitle || '')
  const [participants, setParticipants] = useState(1)
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today)
  const [fulfillsNeedId, setFulfillsNeedId] = useState<string>(defaultFulfillsNeedId ?? '')

  // Fetch open needs once when the modal opens.
  const [needsOptions, setNeedsOptions] = useState<PickerOption[] | null>(null)

  // Controlled vs FAB mode
  const isControlled = controlledOpen !== undefined
  const isVisible = isControlled ? controlledOpen : fabOpen

  // Lazy-load the open-needs list the first time the modal becomes
  // visible. Cached for the session — re-opens reuse the in-state copy
  // so the picker stays snappy. Re-runs when defaultFulfillsNeedId
  // changes (deep-link from /needs/[id]).
  useEffect(() => {
    if (!isVisible) return
    if (needsOptions !== null && !defaultFulfillsNeedId) return
    let cancelled = false
    listOpenNeedsForActor(hubId).then(rs => {
      if (!cancelled) setNeedsOptions(rs)
    }).catch(() => {
      if (!cancelled) setNeedsOptions([])
    })
    return () => { cancelled = true }
  }, [isVisible, hubId, needsOptions, defaultFulfillsNeedId])

  // Sync prefill when prop changes.
  useEffect(() => {
    if (defaultFulfillsNeedId) setFulfillsNeedId(defaultFulfillsNeedId)
  }, [defaultFulfillsNeedId])

  const pickedNeed = needsOptions?.find(n => n.id === fulfillsNeedId)

  const close = useCallback(() => {
    if (isControlled && onClose) {
      onClose()
    } else {
      setFabOpen(false)
    }
  }, [isControlled, onClose])

  const resetForm = useCallback(() => {
    setActivityType(defaultType || 'other')
    setTitle(defaultTitle || '')
    setParticipants(1)
    setNotes('')
    setDate(new Date().toISOString().split('T')[0])
    setFulfillsNeedId(defaultFulfillsNeedId ?? '')
  }, [defaultType, defaultTitle, defaultFulfillsNeedId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || submitting) return

    setSubmitting(true)
    try {
      await logActivity({
        orgAddress,
        activityType,
        title: title.trim(),
        description: notes.trim() || undefined,
        participants,
        activityDate: date,
        relatedEntity: defaultRelatedEntity || undefined,
        fulfillsNeedId: fulfillsNeedId || undefined,
      })

      // Show success toast briefly
      setToast(true)
      setTimeout(() => setToast(false), 2000)

      resetForm()
      close()
      router.refresh()
    } catch (err) {
      console.error('Failed to log activity:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* ── FAB button ── */}
      {showFab && !isControlled && (
        <button
          onClick={() => setFabOpen(prev => !prev)}
          aria-label="Log activity"
          style={{
            position: 'fixed',
            bottom: 52,
            right: 24,
            zIndex: 45,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: '#8b5e3c',
            color: '#fff',
            border: 'none',
            fontSize: '1.75rem',
            fontWeight: 300,
            lineHeight: 1,
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(139,94,60,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            transform: fabOpen ? 'rotate(45deg)' : 'none',
          }}
        >
          +
        </button>
      )}

      {/* ── Modal overlay ── */}
      {isVisible && (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <form
            onClick={e => e.stopPropagation()}
            onSubmit={handleSubmit}
            style={{
              background: '#fff',
              borderRadius: 16,
              maxWidth: 400,
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
            }}
          >
            <h3 style={{
              margin: 0,
              fontSize: '1.05rem',
              fontWeight: 700,
              color: '#37474f',
            }}>
              Log Activity
            </h3>

            {/* Activity type */}
            <label style={labelStyle}>
              Type
              <select
                value={activityType}
                onChange={e => setActivityType(e.target.value)}
                style={inputStyle}
              >
                {ACTIVITY_TYPES.map(t => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            {/* Title */}
            <label style={labelStyle}>
              Title
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="What happened?"
                required
                style={inputStyle}
              />
            </label>

            {/* Participants */}
            <label style={labelStyle}>
              Participants
              <input
                type="number"
                min={0}
                value={participants}
                onChange={e => setParticipants(parseInt(e.target.value, 10) || 0)}
                style={inputStyle}
              />
            </label>

            {/* Notes */}
            <label style={labelStyle}>
              Notes
              <textarea
                rows={3}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional details..."
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </label>

            {/* Fulfills which need? — closes the PROV chain.
                Empty = "(none)" so the existing "log a personal activity"
                flow stays the default. */}
            <label style={labelStyle}>
              Fulfills which need? (optional)
              <select
                value={fulfillsNeedId}
                onChange={e => setFulfillsNeedId(e.target.value)}
                style={inputStyle}
                disabled={needsOptions === null}
              >
                <option value="">— None —</option>
                {needsOptions === null && (
                  <option value="" disabled>Loading…</option>
                )}
                {needsOptions !== null && needsOptions.length === 0 && (
                  <option value="" disabled>(no open needs in this hub)</option>
                )}
                {/* Connected = needs on orgs you're a member of. */}
                {needsOptions && needsOptions.some(n => n.scope === 'connected') && (
                  <optgroup label="Your circles">
                    {needsOptions.filter(n => n.scope === 'connected').map(n => (
                      <option key={n.id} value={n.id}>
                        {n.title} · {n.needTypeLabel}
                      </option>
                    ))}
                  </optgroup>
                )}
                {needsOptions && needsOptions.some(n => n.scope === 'hub') && (
                  <optgroup label="Hub-wide">
                    {needsOptions.filter(n => n.scope === 'hub').map(n => (
                      <option key={n.id} value={n.id}>
                        {n.title} · {n.needTypeLabel}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {pickedNeed && (
              <div style={{ fontSize: '0.7rem', color: '#0f766e', background: 'rgba(13,148,136,0.06)', border: '1px solid rgba(13,148,136,0.20)', padding: '0.4rem 0.6rem', borderRadius: 6, marginTop: '-0.4rem' }}>
                {pickedNeed.remaining <= 1
                  ? <>This will close the need&apos;s fulfillment threshold and flip status → <strong>met</strong>.</>
                  : <>{pickedNeed.remaining} more activit{pickedNeed.remaining === 1 ? 'y' : 'ies'} until status flips to met.</>}
              </div>
            )}

            {/* Date */}
            <label style={labelStyle}>
              Date
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                style={inputStyle}
              />
            </label>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={() => { resetForm(); close() }}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: 8,
                  border: '1px solid #d0d0d0',
                  background: '#fff',
                  color: '#555',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: 8,
                  border: 'none',
                  background: submitting ? '#b89b7a' : '#8b5e3c',
                  color: '#fff',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s',
                }}
              >
                {submitting ? 'Saving...' : 'Log Activity'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Success toast ── */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 120,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 60,
          background: '#2e7d32',
          color: '#fff',
          padding: '0.5rem 1.25rem',
          borderRadius: 8,
          fontSize: '0.85rem',
          fontWeight: 600,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>
          Activity logged
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#546e7a',
}

const inputStyle: React.CSSProperties = {
  border: '1px solid #d0d0d0',
  borderRadius: 8,
  padding: '0.5rem 0.65rem',
  fontSize: '0.85rem',
  color: '#37474f',
  outline: 'none',
  background: '#fafafa',
  fontFamily: 'inherit',
}
