'use client'

/**
 * Spec 005 — Rail B: Pool admin attests an external payment for a pledge.
 *
 * Client component. Computes sha256 of the uploaded evidence file in the
 * browser (Web Crypto), then posts to the markPledgePaid server action. The
 * blob itself is NOT uploaded in v1 — only the hash is anchored on chain
 * (see evidence-storage.md). v2 adds an org-mcp /evidence/store endpoint.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markPledgePaid } from '@/lib/actions/pledgeMarkPaid.action'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  border: '#ece6db',
  danger: '#dc2626',
}

interface Props {
  pledgeId: `0x${string}`
  fundAgent: `0x${string}`
  /** Token to record against. Defaults to MockUSDC (NEXT_PUBLIC_MOCK_USDC_ADDRESS).
   *  For non-USD pledges, server still records — token bucket is informational. */
  defaultToken: `0x${string}`
  /** USDC if unit==='USD'; else pledge.unit is non-monetary. */
  isUsdPledge: boolean
}

const RAILS = [
  { value: 'bank',    label: 'Bank transfer' },
  { value: 'check',   label: 'Check' },
  { value: 'cash',    label: 'Cash' },
  { value: 'in-kind', label: 'In-kind contribution' },
  { value: 'crypto',  label: 'Crypto (off this chain)' },
  { value: 'other',   label: 'Other' },
] as const

type Rail = (typeof RAILS)[number]['value']

async function sha256Hex(file: File): Promise<`0x${string}`> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const bytes = new Uint8Array(digest)
  let hex = '0x'
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex as `0x${string}`
}

export function PledgeMarkPaidForm({ pledgeId, fundAgent, defaultToken, isUsdPledge }: Props) {
  const router = useRouter()
  const [amount, setAmount] = useState<string>('')
  const [rail, setRail] = useState<Rail>('bank')
  const [file, setFile] = useState<File | null>(null)
  const [evidenceHash, setEvidenceHash] = useState<`0x${string}` | null>(null)
  const [hashing, setHashing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onFile(f: File | null) {
    setError(null)
    setSuccess(null)
    setFile(f)
    setEvidenceHash(null)
    if (!f) return
    setHashing(true)
    try {
      const hash = await sha256Hex(f)
      setEvidenceHash(hash)
    } catch (e) {
      setError(`hash failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setHashing(false)
    }
  }

  function submit() {
    setError(null)
    setSuccess(null)
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return setError('Amount must be positive')
    if (!evidenceHash) return setError('Upload an evidence document first')
    // markPaid records in the pledge's unit (whole dollars in v1) — same
    // scale as pledgeAmount on chain. Don't scale by token decimals.
    const ledgerAmount = BigInt(Math.round(n))
    startTransition(async () => {
      const r = await markPledgePaid({
        pledgeSubject: pledgeId,
        fundAgent,
        token: defaultToken,
        amount: ledgerAmount,
        rail,
        evidenceHash,
      })
      if (!r.ok) {
        setError(r.error ?? 'mark-paid failed')
        return
      }
      setSuccess(`Recorded. tx: ${r.txHash}`)
      router.refresh()
    })
  }

  return (
    <div style={{ padding: '0.85rem 1rem', border: `1px solid ${C.border}`, borderRadius: 10, background: '#fcfaf6' }}>
      <p style={{ fontSize: '0.78rem', color: C.textMuted, margin: '0 0 0.65rem' }}>
        Attest that a payment was received for this pledge outside the on-chain
        treasury rail. Evidence hash is computed locally; the document
        itself is held by your org-mcp (v1: keep a copy yourself).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        <Row label="Amount">
          <input
            type="number" min={0} step={isUsdPledge ? 0.01 : 1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
            style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', border: `1px solid ${C.border}`, borderRadius: 6, width: 140 }}
          />
          {isUsdPledge && <span style={{ fontSize: '0.78rem', color: C.textMuted }}>USD</span>}
        </Row>
        <Row label="Rail">
          <select
            value={rail}
            onChange={(e) => setRail(e.target.value as Rail)}
            disabled={pending}
            style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', border: `1px solid ${C.border}`, borderRadius: 6 }}
          >
            {RAILS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </Row>
        <Row label="Evidence">
          <input
            type="file"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            disabled={pending || hashing}
            style={{ fontSize: '0.78rem' }}
          />
          {hashing && <span style={{ fontSize: '0.78rem', color: C.textMuted }}>computing sha256…</span>}
          {evidenceHash && (
            <code style={{ fontSize: '0.7rem', color: C.textMuted }}>
              {evidenceHash.slice(0, 22)}…
            </code>
          )}
        </Row>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !evidenceHash}
        style={{
          marginTop: '0.7rem',
          padding: '0.45rem 1.1rem',
          background: pending || !evidenceHash ? '#ccc' : C.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: pending || !evidenceHash ? 'not-allowed' : 'pointer',
        }}
      >
        {pending ? 'Recording…' : 'Record external payment'}
      </button>
      {file && <div style={{ marginTop: '0.4rem', fontSize: '0.72rem', color: C.textMuted }}>File: {file.name} ({Math.round(file.size / 1024)} KB)</div>}
      {error && <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: C.danger }}>{error}</div>}
      {success && <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#198754' }}>{success}</div>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: '0 0 80px', fontSize: '0.72rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      {children}
    </div>
  )
}
