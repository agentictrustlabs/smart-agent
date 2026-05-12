/**
 * Spec 005 — Personal-treasury balance widget for hub dashboards.
 *
 * Server component: reads MockUSDC balance via `readUsdcBalance` (server-side,
 * needs DEPLOYER key access). Embeds the client-side `FundTreasuryButton`
 * for the dev-only top-up flow.
 *
 * Renders nothing when MOCK_USDC_ADDRESS is unset (e.g., production deploy
 * or a stale .env). The widget is purely informational + funding; honor
 * flows happen on pledge detail pages.
 */

import { readUsdcBalance } from '@/lib/treasury/provision'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { FundTreasuryButton } from './FundTreasuryButton'

const C = {
  text: '#1e293b',
  textMuted: '#64748b',
  border: '#e2e8f0',
  card: '#ffffff',
  accent: '#8b5e3c',
  accentLight: '#fdf6ec',
  accentBorder: 'rgba(139, 94, 60, 0.20)',
}

export async function TreasuryWidget() {
  const user = await getCurrentUser()
  const smartAccountAddress = user?.smartAccountAddress as `0x${string}` | undefined
  if (!smartAccountAddress) return null
  const { balance, tokenAddress } = await readUsdcBalance(smartAccountAddress)
  if (!tokenAddress) {
    // MockUSDC isn't deployed (production or stale fresh-start) — hide.
    return null
  }
  const usd = Number(balance) / 1_000_000

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.9rem 1.1rem',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.6rem',
      }}
    >
      <div>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Personal treasury
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.2rem' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 700, color: C.text }}>
            ${usd.toLocaleString()}
          </span>
          <span style={{ fontSize: '0.78rem', color: C.textMuted }}>USDC</span>
        </div>
        <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.15rem' }}>
          {smartAccountAddress.slice(0, 8)}…{smartAccountAddress.slice(-6)}
          <span style={{ marginLeft: '0.5rem', color: C.accent }}>
            sa:hasPersonalTreasury → self
          </span>
        </div>
      </div>
      <FundTreasuryButton smartAccountAddress={smartAccountAddress} />
    </div>
  )
}
