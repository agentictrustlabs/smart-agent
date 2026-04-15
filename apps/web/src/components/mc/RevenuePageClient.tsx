'use client'

import { useState, useTransition } from 'react'
import { submitRevenueReport, approveRevenueReport, rejectRevenueReport } from '@/lib/actions/revenue.action'
import { canSubmitReports, canApproveReports } from '@/lib/mc-roles'
import type { MCRole } from '@/lib/mc-roles'

interface RevenueReport {
  id: string
  orgAddress: string
  businessName: string
  period: string
  grossRevenue: number
  expenses: number
  netRevenue: number
  sharePayment: number
  currency: string
  status: string
  submittedBy: string
  submitterName: string
  notes: string | null
}

interface Props {
  reports: RevenueReport[]
  stats: { total: number; pending: number; totalRevenue: number; totalSharePayments: number }
  role: string
  userOrgAddress: string
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#f1f5f9', text: '#94a3b8' },
  submitted: { bg: '#fef3c7', text: '#f59e0b' },
  verified: { bg: '#d1fae5', text: '#10B981' },
  disputed: { bg: '#fee2e2', text: '#ef4444' },
}

function formatXOF(value: number): string {
  return value.toLocaleString('fr-FR') + ' XOF'
}

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.draft
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.5rem',
      borderRadius: 12,
      fontSize: '0.7rem',
      fontWeight: 600,
      background: colors.bg,
      color: colors.text,
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  )
}

function StatusPipeline({ reports }: { reports: RevenueReport[] }) {
  const counts: Record<string, number> = { draft: 0, submitted: 0, verified: 0, disputed: 0 }
  for (const r of reports) {
    counts[r.status] = (counts[r.status] ?? 0) + 1
  }
  const total = reports.length || 1

  const segments: Array<{ key: string; count: number; color: string; label: string }> = [
    { key: 'draft', count: counts.draft, color: '#94a3b8', label: 'Draft' },
    { key: 'submitted', count: counts.submitted, color: '#f59e0b', label: 'Submitted' },
    { key: 'verified', count: counts.verified, color: '#10B981', label: 'Verified' },
    { key: 'disputed', count: counts.disputed, color: '#ef4444', label: 'Disputed' },
  ]

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.3rem', fontWeight: 600 }}>
        Report Pipeline
      </div>
      <div style={{
        display: 'flex',
        height: 20,
        borderRadius: 6,
        overflow: 'hidden',
        background: '#e2e8f0',
      }}>
        {segments.filter(s => s.count > 0).map(s => (
          <div key={s.key} style={{
            width: `${(s.count / total) * 100}%`,
            background: s.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.65rem',
            fontWeight: 700,
            color: '#fff',
            minWidth: s.count > 0 ? 24 : 0,
          }}>
            {s.count}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.3rem' }}>
        {segments.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.65rem', color: '#64748b' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
            {s.label} ({s.count})
          </div>
        ))}
      </div>
    </div>
  )
}

function RevenueTrend({ reports }: { reports: RevenueReport[] }) {
  // Group last 3 months per business
  const bizMap = new Map<string, RevenueReport[]>()
  for (const r of reports) {
    if (!bizMap.has(r.businessName)) bizMap.set(r.businessName, [])
    bizMap.get(r.businessName)!.push(r)
  }

  const maxRevenue = Math.max(...reports.map(r => r.grossRevenue), 1)

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <h2 style={{
        fontSize: '0.75rem',
        fontWeight: 700,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: '0.5rem',
      }}>
        Revenue Trend (Last 3 Months)
      </h2>
      {[...bizMap.entries()].map(([name, reps]) => {
        const sorted = reps.sort((a, b) => a.period.localeCompare(b.period)).slice(-3)
        return (
          <div key={name} style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.25rem' }}>
              {name}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {sorted.map(r => (
                <div key={r.period} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.65rem', color: '#94a3b8', width: 52, flexShrink: 0 }}>{r.period}</span>
                  <div style={{ flex: 1, height: 12, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(r.grossRevenue / maxRevenue) * 100}%`,
                      background: r.netRevenue >= 0 ? '#2563EB' : '#ef4444',
                      borderRadius: 3,
                    }} />
                  </div>
                  <span style={{ fontSize: '0.65rem', color: '#64748b', width: 80, textAlign: 'right', flexShrink: 0 }}>
                    {formatXOF(r.grossRevenue)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SubmitReportForm({ orgAddress }: { orgAddress: string }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [period, setPeriod] = useState('')
  const [gross, setGross] = useState('')
  const [expenses, setExpenses] = useState('')
  const [challenges, setChallenges] = useState('')

  const netIncome = (parseInt(gross) || 0) - (parseInt(expenses) || 0)

  function handleSubmit() {
    if (!period || !gross || !expenses) return
    startTransition(async () => {
      await submitRevenueReport({
        orgAddress,
        period,
        grossRevenue: parseInt(gross),
        expenses: parseInt(expenses),
        netRevenue: netIncome,
        notes: challenges || undefined,
      })
      setOpen(false)
      setPeriod('')
      setGross('')
      setExpenses('')
      setChallenges('')
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '0.5rem 1rem',
          background: '#2563EB',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: '0.85rem',
          cursor: 'pointer',
          marginBottom: '1rem',
        }}
      >
        Submit Report
      </button>
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.4rem 0.6rem',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    fontSize: '0.85rem',
    color: '#1e293b',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#64748b',
    marginBottom: '0.2rem',
    display: 'block',
  }

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      padding: '1rem',
      marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Submit Revenue Report
        </h3>
        <button onClick={() => setOpen(false)} style={{
          background: 'none', border: 'none', fontSize: '1rem', cursor: 'pointer', color: '#94a3b8',
        }}>
          X
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
        <div>
          <label style={labelStyle}>Period (YYYY-MM)</label>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Net Income (XOF)</label>
          <input type="text" readOnly value={netIncome.toLocaleString('fr-FR')} style={{ ...inputStyle, background: '#f8fafc', color: '#64748b' }} />
        </div>
        <div>
          <label style={labelStyle}>Gross Revenue (XOF)</label>
          <input type="number" value={gross} onChange={e => setGross(e.target.value)} placeholder="0" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Expenses (XOF)</label>
          <input type="number" value={expenses} onChange={e => setExpenses(e.target.value)} placeholder="0" style={inputStyle} />
        </div>
      </div>

      <div style={{ marginBottom: '0.6rem' }}>
        <label style={labelStyle}>Challenges / Notes</label>
        <textarea
          value={challenges}
          onChange={e => setChallenges(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={isPending || !period || !gross || !expenses}
        style={{
          padding: '0.45rem 1rem',
          background: isPending ? '#94a3b8' : '#2563EB',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: '0.82rem',
          cursor: isPending ? 'default' : 'pointer',
        }}
      >
        {isPending ? 'Submitting...' : 'Submit'}
      </button>
    </div>
  )
}

function ReportActionButtons({ reportId }: { reportId: string }) {
  const [isPending, startTransition] = useTransition()

  return (
    <div style={{ display: 'flex', gap: '0.3rem' }}>
      <button
        disabled={isPending}
        onClick={() => startTransition(() => approveRevenueReport(reportId))}
        style={{
          padding: '0.2rem 0.5rem',
          background: '#d1fae5',
          color: '#10B981',
          border: '1px solid #a7f3d0',
          borderRadius: 4,
          fontSize: '0.68rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Approve
      </button>
      <button
        disabled={isPending}
        onClick={() => startTransition(() => rejectRevenueReport(reportId))}
        style={{
          padding: '0.2rem 0.5rem',
          background: '#fee2e2',
          color: '#ef4444',
          border: '1px solid #fecaca',
          borderRadius: 4,
          fontSize: '0.68rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Reject
      </button>
    </div>
  )
}

export function RevenuePageClient({ reports, stats, role, userOrgAddress }: Props) {
  const mcRole = role as MCRole
  const showSubmitForm = canSubmitReports(mcRole)
  const showApproveButtons = canApproveReports(mcRole)

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: '#1e293b' }}>
          Revenue
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
          Monthly revenue reports from portfolio businesses.
        </p>
      </div>

      {/* Stats grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '0.6rem',
        marginBottom: '1.25rem',
      }}>
        {[
          { label: 'Reports This Month', value: String(stats.total), color: '#2563EB' },
          { label: 'Pending Approval', value: String(stats.pending), color: '#f59e0b' },
          { label: 'Total Revenue (XOF)', value: stats.totalRevenue.toLocaleString('fr-FR'), color: '#10B981' },
          { label: 'Share Payments (XOF)', value: stats.totalSharePayments.toLocaleString('fr-FR'), color: '#2563EB' },
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

      {/* Status pipeline */}
      <StatusPipeline reports={reports} />

      {/* Submit report form (business owners only) */}
      {showSubmitForm && <SubmitReportForm orgAddress={userOrgAddress} />}

      {/* Report table */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.8rem',
        }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['Period', 'Business', 'Gross Revenue', 'Net Revenue', 'Share Payment', 'Status', ...(showApproveButtons ? ['Actions'] : [])].map(h => (
                <th key={h} style={{
                  padding: '0.5rem 0.6rem',
                  textAlign: 'left',
                  fontWeight: 700,
                  color: '#64748b',
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reports.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.5rem 0.6rem', color: '#1e293b', fontWeight: 500 }}>{r.period}</td>
                <td style={{ padding: '0.5rem 0.6rem', color: '#1e293b' }}>{r.businessName}</td>
                <td style={{ padding: '0.5rem 0.6rem', color: '#1e293b' }}>{formatXOF(r.grossRevenue)}</td>
                <td style={{
                  padding: '0.5rem 0.6rem',
                  color: r.netRevenue >= 0 ? '#10B981' : '#ef4444',
                  fontWeight: 600,
                }}>
                  {formatXOF(r.netRevenue)}
                </td>
                <td style={{ padding: '0.5rem 0.6rem', color: '#1e293b' }}>{formatXOF(r.sharePayment)}</td>
                <td style={{ padding: '0.5rem 0.6rem' }}><StatusBadge status={r.status} /></td>
                {showApproveButtons && (
                  <td style={{ padding: '0.5rem 0.6rem' }}>
                    {r.status === 'submitted' ? <ReportActionButtons reportId={r.id} /> : null}
                  </td>
                )}
              </tr>
            ))}
            {reports.length === 0 && (
              <tr>
                <td colSpan={showApproveButtons ? 7 : 6} style={{
                  padding: '2rem',
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: '0.85rem',
                }}>
                  No revenue reports found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Revenue trend */}
      {reports.length > 0 && <RevenueTrend reports={reports} />}
    </div>
  )
}
