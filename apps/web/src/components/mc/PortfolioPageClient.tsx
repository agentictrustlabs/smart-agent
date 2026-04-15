'use client'

import { BusinessCard, type PortfolioBusiness } from './BusinessCard'

interface Props {
  businesses: PortfolioBusiness[]
  totalDeployed: number
  totalRecovered: number
  role: string
}

function formatUSD(value: number): string {
  return '$' + value.toLocaleString('en-US')
}

export function PortfolioPageClient({ businesses, totalDeployed, totalRecovered, role: _role }: Props) {
  const recoveryRate = totalDeployed > 0
    ? Math.round((totalRecovered / totalDeployed) * 100)
    : 0

  // Per-business capital (evenly split for now)
  const perBusinessCapital = businesses.length > 0
    ? Math.round(totalDeployed / businesses.length)
    : 0

  // Group by wave cohort
  const waves = new Map<string, PortfolioBusiness[]>()
  for (const biz of businesses) {
    const cohort = biz.waveCohort || 'Uncategorized'
    if (!waves.has(cohort)) waves.set(cohort, [])
    waves.get(cohort)!.push(biz)
  }
  const sortedWaves = [...waves.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: '#1e293b' }}>
          Portfolio
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
          Business portfolio overview and health tracking.
        </p>
      </div>

      {/* Capital summary bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '0.6rem',
        marginBottom: '1.5rem',
      }}>
        {[
          { label: 'Total Deployed', value: formatUSD(totalDeployed), color: '#2563EB' },
          { label: 'Total Recovered', value: formatUSD(totalRecovered), color: '#10B981' },
          { label: 'Recovery Rate', value: `${recoveryRate}%`, color: recoveryRate >= 50 ? '#10B981' : '#f59e0b' },
          { label: 'Businesses', value: String(businesses.length), color: '#2563EB' },
        ].map(s => (
          <div key={s.label} style={{
            padding: '0.6rem 0.75rem',
            background: '#ffffff',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Business cards grouped by wave */}
      {sortedWaves.map(([wave, bizList]) => (
        <div key={wave} style={{ marginBottom: '1.5rem' }}>
          <h2 style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: '0.5rem',
            paddingBottom: '0.3rem',
            borderBottom: '1px solid #e2e8f0',
          }}>
            {wave}
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '0.75rem',
          }}>
            {bizList.map(biz => (
              <BusinessCard
                key={biz.address}
                biz={biz}
                capitalDeployed={perBusinessCapital}
              />
            ))}
          </div>
        </div>
      ))}

      {businesses.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '3rem 1rem',
          color: '#64748b',
        }}>
          <p style={{ fontSize: '0.9rem', fontWeight: 500 }}>No businesses in portfolio</p>
          <p style={{ fontSize: '0.8rem' }}>Revenue reports will appear here once businesses submit them.</p>
        </div>
      )}
    </div>
  )
}
