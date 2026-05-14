'use client'

/**
 * Client form per inbox row — fires either:
 *   - POST /api/commitments/attest    (validator attests a milestone)
 *   - POST /api/commitments/release   (steward approves + releases)
 *
 * Server-rendered task data flows in via props; the client owns transient
 * pending / error state for the action call.
 */

import { useState, useTransition } from 'react'
import type { InboxTask } from '@/lib/actions/commitments.action'

const C = {
  attest: '#0f766e',
  release: '#166534',
  accent: '#8b5e3c',
  errorBg: '#fef2f2',
  errorFg: '#991b1b',
}

export function TaskRowActions({ task, hubSlug }: { task: InboxTask; hubSlug: string }) {
  const [pending, start] = useTransition()
  const [evidence, setEvidence] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onAttest() {
    setError(null)
    start(async () => {
      try {
        const res = await fetch('/api/commitments/attest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commitmentSubject: task.commitmentSubject,
            milestoneId: task.milestoneId,
            evidence: evidence.trim() || `${task.milestoneLabel} delivered`,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || j.ok === false) {
          setError(j.error ?? `attest failed: ${res.status}`)
        } else {
          window.location.reload()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  function onRelease() {
    setError(null)
    start(async () => {
      try {
        const res = await fetch('/api/commitments/release', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commitmentSubject: task.commitmentSubject,
            milestoneId: task.milestoneId,
            tokenAmount: task.amount,
            commitmentScaleAmount: task.amount,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || j.ok === false) {
          setError(j.error ?? `release failed: ${res.status}`)
        } else {
          window.location.reload()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <div>
      {task.kind === 'attestation' ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={evidence}
            placeholder="Evidence summary (optional)"
            onChange={(e) => setEvidence(e.target.value)}
            style={{
              flex: 1, minWidth: '14rem',
              padding: '0.35rem 0.55rem', fontSize: '0.8rem',
              border: '1px solid #ece6db', borderRadius: 6, background: '#fff',
            }}
          />
          <button
            type="button"
            onClick={onAttest}
            disabled={pending}
            style={{
              padding: '0.4rem 0.9rem', borderRadius: 8,
              background: pending ? '#cfc4b3' : C.attest, color: '#fff',
              border: 'none', fontSize: '0.8rem', fontWeight: 700,
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {pending ? 'Attesting…' : 'Attest delivered →'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onRelease}
          disabled={pending}
          style={{
            padding: '0.4rem 0.9rem', borderRadius: 8,
            background: pending ? '#cfc4b3' : C.release, color: '#fff',
            border: 'none', fontSize: '0.8rem', fontWeight: 700,
            cursor: pending ? 'not-allowed' : 'pointer',
          }}
        >
          {pending ? 'Releasing…' : 'Approve & release →'}
        </button>
      )}
      {error && (
        <div style={{ marginTop: '0.4rem', padding: '0.35rem 0.55rem', background: C.errorBg, color: C.errorFg, fontSize: '0.74rem', borderRadius: 6 }}>
          {error}
        </div>
      )}
      <div style={{ marginTop: '0.4rem', fontSize: '0.72rem' }}>
        <a href={`/h/${hubSlug}/proposals/${task.proposalSubject}`} style={{ color: C.accent, textDecoration: 'none', fontWeight: 600 }}>
          View proposal + commitment →
        </a>
      </div>
    </div>
  )
}
