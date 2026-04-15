'use client'

import Link from 'next/link'

export interface PortfolioBusiness {
  address: string
  name: string
  ownerName: string
  healthStatus: 'green' | 'yellow' | 'red' | 'unknown'
  latestRevenue: number | null
  totalSharePayments: number
  lastReportDate: string | null
  waveCohort: string
}

const HEALTH_ICONS: Record<string, string> = {
  green: '\uD83D\uDFE2',
  yellow: '\uD83D\uDFE1',
  red: '\uD83D\uDD34',
  unknown: '\u26AA',
}

const HEALTH_LABELS: Record<string, string> = {
  green: 'Healthy',
  yellow: 'Declining',
  red: 'At Risk',
  unknown: 'No Data',
}

function formatXOF(value: number): string {
  return value.toLocaleString('fr-FR') + ' XOF'
}

export function BusinessCard({
  biz,
  capitalDeployed,
}: {
  biz: PortfolioBusiness
  capitalDeployed: number
}) {
  const recoveryPct = capitalDeployed > 0
    ? Math.min(100, Math.round((biz.totalSharePayments / capitalDeployed) * 100))
    : 0

  return (
    <Link href={`/groups/${biz.address}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: '1rem',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '0.5rem',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>
              {biz.name}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              {biz.ownerName}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span>{HEALTH_ICONS[biz.healthStatus]}</span>
            <span style={{
              fontSize: '0.7rem',
              color: biz.healthStatus === 'green' ? '#10B981'
                : biz.healthStatus === 'yellow' ? '#f59e0b'
                : biz.healthStatus === 'red' ? '#ef4444'
                : '#94a3b8',
              fontWeight: 600,
            }}>
              {HEALTH_LABELS[biz.healthStatus]}
            </span>
          </div>
        </div>

        {/* Revenue */}
        <div style={{ marginBottom: '0.6rem' }}>
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.15rem' }}>
            Latest Monthly Revenue
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#2563EB' }}>
            {biz.latestRevenue != null ? formatXOF(biz.latestRevenue) : '--'}
          </div>
        </div>

        {/* Recovery progress */}
        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.7rem',
            color: '#64748b',
            marginBottom: '0.2rem',
          }}>
            <span>Recovery Progress</span>
            <span>{recoveryPct}%</span>
          </div>
          <div style={{
            height: 6,
            background: '#e2e8f0',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${recoveryPct}%`,
              background: recoveryPct >= 50 ? '#10B981' : '#2563EB',
              borderRadius: 3,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        {/* Last report */}
        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
          {biz.lastReportDate ? `Last report: ${biz.lastReportDate}` : 'No reports yet'}
        </div>
      </div>
    </Link>
  )
}
