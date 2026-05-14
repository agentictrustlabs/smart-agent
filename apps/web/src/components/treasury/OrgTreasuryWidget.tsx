/**
 * Reusable USDC treasury balance for any AgentAccount.
 *
 * Resolves the treasury address through the resolver (sa:hasTreasury for
 * orgs/pools, sa:hasPersonalTreasury for persons; falls back to self) and
 * reads MockUSDC.balanceOf on chain. No SQL mirror — chain is the source
 * of truth. Renders nothing when MOCK_USDC_ADDRESS isn't configured.
 */

import { readUsdcBalance } from '@/lib/treasury/provision'
import type { Address } from 'viem'

const C = {
  text: '#1e293b',
  textMuted: '#64748b',
  border: '#e2e8f0',
  card: '#ffffff',
  good: '#0f766e',
  goodBg: 'rgba(15,118,110,0.06)',
  goodBorder: 'rgba(15,118,110,0.18)',
  cardHero: 'linear-gradient(135deg, #ffffff 0%, #f3faf8 100%)',
}

interface Props {
  /** AgentAccount address to read balance from (pool agent / fund agent / org agent / person). */
  address: Address
  /** Display label, e.g. "Pool treasury", "Fund balance", "Org treasury". */
  label?: string
  /** `compact` = inline pill; `card` = standard card; `hero` = prominent finale card. */
  variant?: 'card' | 'compact' | 'hero'
}

export async function OrgTreasuryWidget({ address, label = 'Treasury balance', variant = 'card' }: Props) {
  const { balance, tokenAddress, treasury } = await readUsdcBalance(address)
  if (!tokenAddress) return null
  const usd = Number(balance) / 1_000_000
  const usdLabel = usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(2)}M`
                  : usd >= 1_000 ? `$${Math.round(usd).toLocaleString()}`
                  : `$${usd.toFixed(2)}`
  const isViaTreasury = treasury.toLowerCase() !== address.toLowerCase()

  if (variant === 'compact') {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'baseline', gap: '0.4rem',
        padding: '0.3rem 0.6rem',
        background: '#fdf6ec', border: `1px solid ${C.border}`, borderRadius: 8,
        fontSize: '0.78rem',
      }}>
        <span style={{ color: C.textMuted, fontWeight: 600 }}>{label}:</span>
        <span style={{ color: C.text, fontWeight: 700 }}>{usdLabel}</span>
        <span style={{ color: C.textMuted }}>USDC</span>
      </div>
    )
  }

  if (variant === 'hero') {
    return (
      <div
        data-component="treasury-hero"
        style={{
          background: C.cardHero,
          border: `1px solid ${C.goodBorder}`,
          borderRadius: 14,
          padding: '1.3rem 1.55rem',
          marginBottom: '1rem',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: '1.5rem',
        }}
      >
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.good, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.2rem' }}>
            {label}
          </div>
          <div data-component="treasury-usdc" style={{ fontSize: '2.2rem', fontWeight: 700, color: C.good, lineHeight: 1.05 }}>
            {usdLabel}
          </div>
          <div style={{ fontSize: '0.74rem', color: C.textMuted, marginTop: '0.6rem' }}>
            {isViaTreasury ? (
              <>via Treasury Service Agent <code style={{ color: C.text, fontSize: '0.78rem' }}>{treasury}</code></>
            ) : (
              <>Smart account <code style={{ color: C.text, fontSize: '0.78rem' }}>{treasury}</code></>
            )}
          </div>
        </div>
        <div style={{
          width: 68, height: 68, borderRadius: 14, background: C.goodBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, color: C.good,
        }}>
          💰
        </div>
      </div>
    )
  }

  // Default — card
  return (
    <div
      data-component="org-treasury"
      style={{
        background: usd > 0 ? C.goodBg : C.card,
        border: `1px solid ${usd > 0 ? C.goodBorder : C.border}`,
        borderRadius: 12,
        padding: '0.95rem 1.15rem',
        marginBottom: '0.85rem',
      }}
    >
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.2rem' }}>
        <span style={{ fontSize: '1.65rem', fontWeight: 700, color: usd > 0 ? C.good : C.text }}>
          {usdLabel}
        </span>
        <span style={{ fontSize: '0.78rem', color: C.textMuted }}>USDC</span>
      </div>
      <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.25rem', fontFamily: 'ui-monospace, monospace' }}>
        {isViaTreasury && <span style={{ marginRight: '0.4rem' }}>via treasury →</span>}
        {treasury.slice(0, 10)}…{treasury.slice(-8)}
      </div>
    </div>
  )
}
