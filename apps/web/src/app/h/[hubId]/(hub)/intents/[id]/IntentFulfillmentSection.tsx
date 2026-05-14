/**
 * Spec 006 — intent → fulfillment forward walk.
 *
 * Renders below the intent identity panel. Shows every commitment whose
 * `sa:commitmentNeedIntent` matches this intent's URN — i.e., everyone
 * who awarded a grant against this need. The originator can finally see
 * the full chain: "my intent → this proposal won → this commitment paid
 * out → this org received the money."
 *
 * Server component. Pulls commitments from GraphDB via the new
 * `listFulfillmentsForIntent` action; the panel renders the rows.
 */

import Link from 'next/link'
import { listFulfillmentsForIntent } from '@/lib/actions/commitments.action'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  pending: '#92400e',
  inFlight: '#0f766e',
  completed: '#166534',
  canceled: '#6b7280',
  blocked: '#991b1b',
}

function statusColor(s: string): string {
  const lower = s.toLowerCase()
  if (lower.includes('completed') || lower === 'completed') return C.completed
  if (lower.includes('inflight') || lower.includes('in-flight')) return C.inFlight
  if (lower.includes('canceled')) return C.canceled
  if (lower.includes('releasesblocked') || lower.includes('blocked')) return C.blocked
  return C.pending
}

function statusLabel(s: string): string {
  const lower = s.toLowerCase()
  if (lower.includes('completed')) return 'completed'
  if (lower.includes('inflight') || lower.includes('in-flight')) return 'in-flight'
  if (lower.includes('canceled')) return 'canceled'
  if (lower.includes('releasesblocked') || lower.includes('blocked')) return 'releases-blocked'
  if (lower.includes('pending')) return 'pending'
  return s
}

function formatUsdc(amountStr: string): string {
  try {
    const n = BigInt(amountStr)
    const dollars = Number(n) / 1_000_000
    if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
    if (dollars >= 1_000)     return `$${(dollars / 1_000).toFixed(1)}k`
    return `$${dollars.toLocaleString()}`
  } catch {
    return amountStr
  }
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

interface Props {
  /** URN form: `urn:smart-agent:intent:<uuid>` — what's stored on chain. */
  intentUrn: string
  hubSlug: string
}

export async function IntentFulfillmentSection({ intentUrn, hubSlug }: Props) {
  const rows = await listFulfillmentsForIntent(intentUrn)
  if (rows.length === 0) return null // hide entirely when there's no fulfillment yet

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '1rem 1.25rem', marginBottom: '1rem',
    }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
        Fulfillment ({rows.length} commitment{rows.length === 1 ? '' : 's'})
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((r) => {
          let milestones: Array<{ id?: string; label?: string; trancheBps?: number }> = []
          try { milestones = JSON.parse(r.milestonesJson || '[]') } catch { /* skip */ }
          const proposalSlug = r.proposalSubject
          return (
            <li key={r.commitmentSubject} style={{
              border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '0.7rem 0.85rem', marginBottom: '0.55rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                <span style={{
                  fontSize: '0.6rem', fontWeight: 700,
                  padding: '0.18rem 0.55rem', borderRadius: 999,
                  background: `${statusColor(r.status)}15`,
                  color: statusColor(r.status),
                  border: `1px solid ${statusColor(r.status)}40`,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {statusLabel(r.status)}
                </span>
                <span style={{ fontSize: '0.78rem', color: C.textMuted }}>
                  Donor <strong style={{ color: C.text }}>{r.donorLabel ?? shortAddr(r.donor)}</strong>
                  {' → '}
                  Recipient <strong style={{ color: C.text }}>{r.recipientLabel ?? shortAddr(r.recipient)}</strong>
                </span>
              </div>
              <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                <span><span style={{ color: C.textMuted }}>Total:</span> <strong style={{ color: C.text }}>{formatUsdc(r.totalAmount)}</strong></span>
                <span><span style={{ color: C.textMuted }}>Released:</span> <strong style={{ color: C.completed }}>{formatUsdc(r.releasedAmount)}</strong></span>
                {milestones.length > 0 && (
                  <span><span style={{ color: C.textMuted }}>Milestones:</span> <strong style={{ color: C.text }}>{milestones.length}</strong></span>
                )}
              </div>
              <div style={{ marginTop: '0.55rem' }}>
                <Link
                  href={`/h/${hubSlug}/proposals/${proposalSlug}`}
                  style={{ color: C.accent, fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}
                >
                  View proposal + funding timeline →
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
