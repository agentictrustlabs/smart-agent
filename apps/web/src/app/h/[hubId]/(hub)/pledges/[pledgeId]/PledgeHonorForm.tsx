'use client'

/**
 * Spec 005 — Honor pledge form (Rail A — donor treasury → pool USDC transfer).
 *
 * Client component. Wraps the `honorPledge` server action with an inline
 * amount input + confirmation modal. v1 supports USD-denominated pledges only;
 * the parent page hides this form for non-USD units.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { honorPledge } from '@/lib/actions/pledgeHonor.action'
import { ConfirmActionModal } from '@/components/ui/ConfirmActionModal'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  danger: '#dc2626',
}

interface Props {
  pledgeId: `0x${string}`
  poolAgentId: `0x${string}`
  remainingUsd: number
  /** Human-readable pool name — shown in the confirmation modal. */
  poolName?: string
}

export function PledgeHonorForm({ pledgeId, poolAgentId, remainingUsd, poolName }: Props) {
  const router = useRouter()
  const [amount, setAmount] = useState<string>(String(remainingUsd))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [modalOpen, setModalOpen] = useState(false)

  function validateAmount(): string | null {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return 'Enter a positive amount'
    if (n > remainingUsd) return `Amount exceeds remaining ($${remainingUsd})`
    return null
  }

  function openModal() {
    setError(null)
    const validationError = validateAmount()
    if (validationError) { setError(validationError); return }
    setModalOpen(true)
  }

  function doHonor() {
    setError(null)
    setSuccess(null)
    const n = Number(amount)
    // Two scales:
    //   tokenAmount      — USDC transfer (6 decimals): $40 → 40_000_000n
    //   pledgeUnitAmount — recordHonor ledger (whole dollars in v1): $40 → 40n
    // Mismatched scales revert with PledgeAmountExceedsCommitted (0x02197aa9).
    const tokenAmount = BigInt(Math.round(n * 1_000_000))
    const pledgeUnitAmount = BigInt(Math.round(n))
    startTransition(async () => {
      const r = await honorPledge({
        pledgeSubject: pledgeId,
        poolAgent: poolAgentId,
        tokenAmount,
        pledgeUnitAmount,
      })
      if (!r.ok) {
        setError(r.error ?? 'honor failed')
        return
      }
      setSuccess(`Payment recorded. tx: ${r.txHash}`)
      router.refresh()
    })
  }

  const n = Number(amount)
  const amountDisplay = Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : '—'

  return (
    <div>
      <p style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.65rem' }}>
        Transfer USDC from your personal treasury to the pool and record the
        honored amount on chain. The transfer and record run atomically — if
        your treasury is short on USDC, the entire call reverts.
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.6rem' }}>
        <label htmlFor="honor-amount" style={{ fontSize: '0.78rem', color: C.textMuted, fontWeight: 600 }}>
          Amount (USD)
        </label>
        <input
          id="honor-amount"
          type="number"
          min={0}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={pending}
          style={{
            padding: '0.4rem 0.6rem',
            fontSize: '0.85rem',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            width: 120,
          }}
        />
        <button
          type="button"
          onClick={openModal}
          disabled={pending}
          style={{
            padding: '0.45rem 1.1rem',
            background: pending ? '#ccc' : C.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: pending ? 'wait' : 'pointer',
          }}
        >
          {pending ? 'Processing…' : 'Release payment'}
        </button>
      </div>
      {error && <div style={{ fontSize: '0.78rem', color: C.danger }}>{error}</div>}
      {success && <div style={{ fontSize: '0.78rem', color: '#198754' }}>{success}</div>}

      <ConfirmActionModal
        open={modalOpen}
        title="Release this payment?"
        summary="Funds will move from your treasury to the giving pool."
        details={[
          `Amount: ${amountDisplay}`,
          poolName ? `Recipient pool: ${poolName}` : `Pool: ${poolAgentId.slice(0, 8)}…`,
          `Remaining after this payment: $${Math.max(0, remainingUsd - n).toFixed(2)}`,
        ]}
        consequence="This transfers USDC from your personal treasury and records the payment on chain. The transfer cannot be reversed."
        confirmLabel="Confirm payment"
        skipKey={`honor-pledge-${pledgeId}`}
        onConfirm={() => { setModalOpen(false); doHonor() }}
        onCancel={() => setModalOpen(false)}
      />
    </div>
  )
}
