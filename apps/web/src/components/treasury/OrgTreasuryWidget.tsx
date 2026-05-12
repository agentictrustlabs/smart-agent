/**
 * Spec 005 — Reusable USDC treasury balance for any AgentAccount.
 *
 * Server component. Reads `MockUSDC.balanceOf(address)` directly from chain
 * (no SQL mirror — chain is source of truth). Renders nothing when
 * MOCK_USDC_ADDRESS isn't set (production deploys exclude it). The
 * `compact` variant fits inside row-style headers; the default is a card.
 */

import { readUsdcBalance } from '@/lib/treasury/provision'

const C = {
  text: '#1e293b',
  textMuted: '#64748b',
  border: '#e2e8f0',
  card: '#ffffff',
  accent: '#8b5e3c',
  accentLight: '#fdf6ec',
}

interface Props {
  /** AgentAccount address to read balance from (pool agent / fund agent / org agent). */
  address: `0x${string}`
  /** Display label, e.g. "Pool treasury", "Fund balance", "Org treasury". */
  label?: string
  /** Compact row variant for inline placement. Default = full card. */
  variant?: 'card' | 'compact'
}

export async function OrgTreasuryWidget({ address, label = 'Treasury balance', variant = 'card' }: Props) {
  const { balance, tokenAddress } = await readUsdcBalance(address)
  if (!tokenAddress) return null
  const usd = Number(balance) / 1_000_000

  if (variant === 'compact') {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'baseline', gap: '0.4rem',
        padding: '0.3rem 0.6rem',
        background: C.accentLight, border: `1px solid ${C.border}`, borderRadius: 8,
        fontSize: '0.78rem',
      }}>
        <span style={{ color: C.textMuted, fontWeight: 600 }}>{label}:</span>
        <span style={{ color: C.text, fontWeight: 700 }}>${usd.toLocaleString()}</span>
        <span style={{ color: C.textMuted }}>USDC</span>
      </div>
    )
  }

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.9rem 1.1rem',
        marginBottom: '0.85rem',
      }}
    >
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.2rem' }}>
        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: C.text }}>
          ${usd.toLocaleString()}
        </span>
        <span style={{ fontSize: '0.78rem', color: C.textMuted }}>USDC</span>
      </div>
      <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.15rem', fontFamily: 'ui-monospace, monospace' }}>
        {address.slice(0, 10)}…{address.slice(-8)}
      </div>
    </div>
  )
}
