'use client'

/**
 * Client form per inbox row — fires either:
 *   - POST /api/commitments/attest    (validator attests a milestone)
 *   - POST /api/commitments/release   (steward approves + releases)
 *
 * Both actions are now guarded by ConfirmActionModal so neither fires
 * on a single accidental click. Server-rendered task data flows in via
 * props; the client owns transient pending / error state for the action call.
 */

import { useState, useTransition } from 'react'
import type { InboxTask } from '@/lib/actions/commitments.action'
import { ConfirmActionModal } from '@/components/ui/ConfirmActionModal'

const C = {
  attest: '#0f766e',
  release: '#166534',
  accent: '#8b5e3c',
  errorBg: '#fef2f2',
  errorFg: '#991b1b',
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function formatUsdc(amountStr: string): string {
  try {
    const n = BigInt(amountStr)
    const dollars = Number(n) / 1_000_000
    if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
    if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`
    return `$${dollars.toLocaleString()}`
  } catch {
    return amountStr
  }
}

export function TaskRowActions({ task, hubSlug }: { task: InboxTask; hubSlug: string }) {
  const [pending, start] = useTransition()
  const [evidence, setEvidence] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [attestModalOpen, setAttestModalOpen] = useState(false)
  const [releaseModalOpen, setReleaseModalOpen] = useState(false)

  function doAttest() {
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

  function doRelease() {
    setError(null)
    start(async () => {
      try {
        // task.amount is the tranche size already in 6-decimal USDC raw
        // (the commitment stores `totalAmount` as raw 6-decimal — see
        // `scripts/seed-grant-flow-demo.ts:524` `TOTAL = 30_000n * 10n ** 6n`,
        // and `commitments.action.ts:listInboxTasks` computes
        // `trancheAmount = totalAmount * trancheBps / 10000`, preserving
        // the scale). Both the USDC.transfer and the recordRelease
        // arguments take this same scale. Multiplying by 1_000_000 again
        // here would request 1e6× the pool's balance and revert with
        // ERC20InsufficientBalance (0xe450d38c).
        const tokenAmount = task.amount
        const res = await fetch('/api/commitments/release', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commitmentSubject: task.commitmentSubject,
            milestoneId: task.milestoneId,
            tokenAmount,
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

  const recipientDisplay = task.recipientLabel ?? shortAddr(task.recipient)
  const amountDisplay = formatUsdc(task.amount)
  const evidenceSummary = evidence.trim() || `${task.milestoneLabel} delivered`

  return (
    <div>
      {task.kind === 'attestation' ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={evidence}
            placeholder="Evidence summary (optional)"
            onChange={(e) => setEvidence(e.target.value)}
            aria-label="Evidence summary"
            style={{
              flex: 1, minWidth: '14rem',
              padding: '0.35rem 0.55rem', fontSize: '0.8rem',
              border: '1px solid #ece6db', borderRadius: 6, background: '#fff',
            }}
          />
          <button
            type="button"
            onClick={() => setAttestModalOpen(true)}
            disabled={pending}
            style={{
              padding: '0.4rem 0.9rem', borderRadius: 8,
              background: pending ? '#cfc4b3' : C.attest, color: '#fff',
              border: 'none', fontSize: '0.8rem', fontWeight: 700,
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {pending ? 'Attesting…' : 'Confirm milestone'}
          </button>

          <ConfirmActionModal
            open={attestModalOpen}
            title="Confirm this milestone?"
            summary="Your attestation certifies that the milestone deliverable has been met."
            details={[
              `Milestone: ${task.milestoneLabel}`,
              `Recipient: ${recipientDisplay}`,
              `Evidence: ${evidenceSummary}`,
            ]}
            consequence="Your attestation is recorded on chain and unlocks the matching milestone payment for release by the pool steward."
            confirmLabel="Confirm milestone"
            skipKey={`attest-${task.commitmentSubject}-${task.milestoneId}`}
            onConfirm={() => { setAttestModalOpen(false); doAttest() }}
            onCancel={() => setAttestModalOpen(false)}
          />
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setReleaseModalOpen(true)}
            disabled={pending}
            style={{
              padding: '0.4rem 0.9rem', borderRadius: 8,
              background: pending ? '#cfc4b3' : C.release, color: '#fff',
              border: 'none', fontSize: '0.8rem', fontWeight: 700,
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {pending ? 'Releasing…' : 'Release payment'}
          </button>

          <ConfirmActionModal
            open={releaseModalOpen}
            title="Release this milestone payment?"
            summary="Funds will be transferred from the pool to the recipient."
            details={[
              `Milestone: ${task.milestoneLabel}`,
              `Amount: ${amountDisplay}`,
              `Recipient: ${recipientDisplay}`,
            ]}
            consequence="This transfers USDC from the pool to the recipient's treasury and records the release on chain."
            confirmLabel="Release payment"
            skipKey={`release-${task.commitmentSubject}-${task.milestoneId}`}
            onConfirm={() => { setReleaseModalOpen(false); doRelease() }}
            onCancel={() => setReleaseModalOpen(false)}
          />
        </>
      )}
      {error && (
        <div
          role="alert"
          style={{ marginTop: '0.4rem', padding: '0.35rem 0.55rem', background: C.errorBg, color: C.errorFg, fontSize: '0.74rem', borderRadius: 6 }}
        >
          {error}
        </div>
      )}
      <div style={{ marginTop: '0.4rem', fontSize: '0.72rem' }}>
        <a href={`/h/${hubSlug}/proposals/${task.proposalSubject}`} style={{ color: C.accent, textDecoration: 'none', fontWeight: 600 }}>
          View proposal + commitment
        </a>
      </div>
    </div>
  )
}
