'use client'

/**
 * Reusable confirmation modal for irreversible or financially significant
 * actions. Replaces browser confirm() calls throughout the funding and
 * delegation flows.
 *
 * Design constraints:
 *   - Light corporate palette only (no dark mode).
 *   - Backdrop click + ESC dismiss (unless submitting).
 *   - Focus trap: tab cycles between Cancel, "Don't ask again" checkbox,
 *     and the primary CTA. Initial focus lands on Cancel so the default
 *     keyboard path is safe.
 *   - Primary button colour: accent (#8b5e3c) by default, danger (#b91c1c)
 *     when dangerous=true.
 *   - "Don't ask again for this session" checkbox writes a boolean flag to
 *     sessionStorage under `key` when checked on confirm. Callers must
 *     check `ConfirmActionModal.isSkippedForSession(key)` before opening
 *     and skip straight to onConfirm when true.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

const C = {
  backdrop: 'rgba(92,74,58,0.40)',
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  danger: '#b91c1c',
  bullet: 'rgba(139,94,60,0.10)',
  consequenceBg: '#fff8f4',
  consequenceBorder: 'rgba(139,94,60,0.20)',
}

export interface ConfirmActionModalProps {
  /** Whether the modal is visible. */
  open: boolean
  /** Short heading, e.g. "Finalize this round?" */
  title: string
  /** One-line context sentence. */
  summary: string
  /** Bullet points listing key details (recipient, amount, milestones…). */
  details?: string[]
  /**
   * Plain-language description of the irreversible consequence.
   * Rendered in an amber-tinted callout.
   */
  consequence: string
  /** Label for the primary action button. Keep to 3 words or fewer. */
  confirmLabel: string
  /**
   * When true, primary button renders in red (#b91c1c) to signal a
   * destructive action (cancel round, delete, revoke).
   */
  dangerous?: boolean
  /**
   * sessionStorage key for the "Don't ask again this session" checkbox.
   * When omitted, the checkbox is not rendered.
   */
  skipKey?: string
  /** Called after optional skip-flag write. May be async. */
  onConfirm: () => Promise<void> | void
  /** Called on Cancel button, backdrop click, or ESC. */
  onCancel: () => void
}

/**
 * Call this before opening the modal. Returns true when the user has
 * previously checked "Don't ask again" for this key in the current session.
 */
export function isSkippedForSession(key: string): boolean {
  try {
    return window.sessionStorage.getItem(`confirm-skip:${key}`) === '1'
  } catch {
    return false
  }
}

export function ConfirmActionModal({
  open,
  title,
  summary,
  details,
  consequence,
  confirmLabel,
  dangerous = false,
  skipKey,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  const [submitting, setSubmitting] = useState(false)
  const [skipChecked, setSkipChecked] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const checkboxRef = useRef<HTMLInputElement>(null)
  // Capture the element that triggered the modal so we can restore focus on close.
  const triggerRef = useRef<Element | null>(null)

  // Reset transient state each time the modal opens.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement
      setSubmitting(false)
      setSkipChecked(false)
      // Defer focus so the portal has painted.
      const id = setTimeout(() => cancelRef.current?.focus(), 16)
      return () => clearTimeout(id)
    } else {
      // Restore focus to the element that triggered the modal.
      const t = triggerRef.current
      if (t && 'focus' in t) {
        requestAnimationFrame(() => (t as HTMLElement).focus())
      }
    }
  }, [open])

  // ESC to dismiss (only when not submitting).
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || submitting) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    },
    [open, submitting, onCancel],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Focus trap: cycle Tab/Shift-Tab among the interactive elements.
  function trapFocus(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return
    const focusable = [
      cancelRef.current,
      skipKey ? checkboxRef.current : null,
      confirmRef.current,
    ].filter(Boolean) as HTMLElement[]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  async function handleConfirm() {
    if (submitting) return
    if (skipKey && skipChecked) {
      try {
        window.sessionStorage.setItem(`confirm-skip:${skipKey}`, '1')
      } catch { /* ignore */ }
    }
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const primaryColor = dangerous ? C.danger : C.accent

  return (
    // Backdrop
    <div
      role="presentation"
      onClick={(e) => {
        if (!submitting && e.target === e.currentTarget) onCancel()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: C.backdrop,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cam-title"
        aria-describedby="cam-summary"
        onKeyDown={trapFocus}
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: '1.5rem',
          width: '100%',
          maxWidth: '26rem',
          boxShadow: '0 8px 32px rgba(92,74,58,0.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {/* Title */}
        <h2
          id="cam-title"
          style={{
            fontSize: '1.05rem',
            fontWeight: 700,
            color: C.text,
            margin: 0,
          }}
        >
          {title}
        </h2>

        {/* Summary */}
        <p
          id="cam-summary"
          style={{
            fontSize: '0.85rem',
            color: C.textMuted,
            margin: 0,
            lineHeight: 1.55,
          }}
        >
          {summary}
        </p>

        {/* Detail bullets */}
        {details && details.length > 0 && (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            {details.map((d, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.55rem',
                  fontSize: '0.83rem',
                  color: C.text,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: primaryColor,
                    marginTop: 2,
                    display: 'inline-block',
                  }}
                />
                {d}
              </li>
            ))}
          </ul>
        )}

        {/* Consequence callout */}
        <div
          role="note"
          style={{
            background: C.consequenceBg,
            border: `1px solid ${C.consequenceBorder}`,
            borderRadius: 8,
            padding: '0.6rem 0.8rem',
            fontSize: '0.8rem',
            color: C.text,
            lineHeight: 1.55,
          }}
        >
          {consequence}
        </div>

        {/* "Don't ask again" checkbox */}
        {skipKey && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.75rem',
              color: C.textMuted,
              cursor: 'pointer',
            }}
          >
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={skipChecked}
              onChange={(e) => setSkipChecked(e.target.checked)}
              style={{ accentColor: C.accent, width: 14, height: 14, cursor: 'pointer' }}
            />
            Don&apos;t ask again for this session
          </label>
        )}

        {/* Action row */}
        <div
          style={{
            display: 'flex',
            gap: '0.6rem',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: '0.5rem 1rem',
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              background: '#fff',
              color: C.text,
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            aria-busy={submitting}
            style={{
              padding: '0.5rem 1.1rem',
              border: 'none',
              borderRadius: 8,
              background: submitting ? '#cfc4b3' : primaryColor,
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer',
              minWidth: '8rem',
            }}
          >
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
