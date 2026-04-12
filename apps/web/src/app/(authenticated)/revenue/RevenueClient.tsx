'use client'

import { useState } from 'react'
import { submitRevenueReport, verifyRevenueReport } from '@/lib/actions/revenue.action'

interface ReportView {
  id: string
  orgAddress: string
  businessName: string
  submitterName: string
  verifierName: string | null
  period: string
  grossRevenue: number
  expenses: number
  netRevenue: number
  sharePayment: number
  currency: string
  notes: string | null
  status: string
  verifiedAt: string | null
  createdAt: string
}

interface Props {
  reports: ReportView[]
  orgAddress: string
  orgName: string
  canSubmit: boolean
  canVerify: boolean
  templateId: string | null
}

export function RevenueClient({ reports, orgAddress, orgName: _orgName, canSubmit, canVerify, templateId }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [grossRevenue, setGrossRevenue] = useState('')
  const [expenses, setExpenses] = useState('')
  const [sharePayment, setSharePayment] = useState('')
  const [notes, setNotes] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const gross = parseInt(grossRevenue) || 0
      const exp = parseInt(expenses) || 0
      await submitRevenueReport({
        orgAddress, period,
        grossRevenue: gross, expenses: exp,
        netRevenue: gross - exp,
        sharePayment: parseInt(sharePayment) || 0,
        currency: 'XOF', notes,
      })
      window.location.reload()
    } catch {
      alert('Failed to submit report')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(id: string) {
    try {
      await verifyRevenueReport(id)
      window.location.reload()
    } catch {
      alert('Failed to verify report')
    }
  }

  // Summary stats
  const totalRevenue = reports.reduce((sum, r) => sum + r.grossRevenue, 0)
  const totalSharePaid = reports.reduce((sum, r) => sum + r.sharePayment, 0)
  const verifiedCount = reports.filter(r => r.status === 'verified').length

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1565c0' }}>{reports.length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Reports</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#2e7d32' }}>{(totalRevenue / 1000).toFixed(0)}K</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Total Revenue (XOF)</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0d9488' }}>{(totalSharePaid / 1000).toFixed(0)}K</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Share Paid (XOF)</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#7c3aed' }}>{verifiedCount}/{reports.length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Verified</div>
        </div>
      </div>

      {/* Submit Form (business owners only) */}
      {canSubmit && (
        <section data-component="graph-section">
          <div data-component="section-header">
            <h2>Submit Report</h2>
            <button onClick={() => setShowForm(!showForm)} data-component="section-action">
              {showForm ? 'Cancel' : '+ New Report'}
            </button>
          </div>
          {showForm && (
            <form onSubmit={handleSubmit} data-component="protocol-info">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label>
                  <span style={{ fontSize: '0.8rem', color: '#616161' }}>Period (YYYY-MM)</span>
                  <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
                </label>
                <label>
                  <span style={{ fontSize: '0.8rem', color: '#616161' }}>Gross Revenue (XOF)</span>
                  <input type="number" value={grossRevenue} onChange={e => setGrossRevenue(e.target.value)} placeholder="500000"
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} required />
                </label>
                <label>
                  <span style={{ fontSize: '0.8rem', color: '#616161' }}>Expenses (XOF)</span>
                  <input type="number" value={expenses} onChange={e => setExpenses(e.target.value)} placeholder="200000"
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} required />
                </label>
                <label>
                  <span style={{ fontSize: '0.8rem', color: '#616161' }}>Revenue-Share Payment (XOF)</span>
                  <input type="number" value={sharePayment} onChange={e => setSharePayment(e.target.value)} placeholder="30000"
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
                </label>
              </div>
              <label style={{ display: 'block', marginTop: '0.75rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#616161' }}>Notes</span>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional notes about this period..."
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
              </label>
              <button type="submit" disabled={loading} style={{ marginTop: '0.75rem' }}>
                {loading ? 'Submitting...' : 'Submit Report'}
              </button>
            </form>
          )}
        </section>
      )}

      {/* Reports Table */}
      <section data-component="graph-section">
        <h2>Report History</h2>
        {reports.length === 0 ? (
          <p data-component="text-muted">No revenue reports submitted yet.</p>
        ) : (
          <table data-component="graph-table">
            <thead>
              <tr>
                {templateId !== 'portfolio-business' && <th>Business</th>}
                <th>Period</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Share Paid</th><th>Status</th>
                {canVerify && <th></th>}
              </tr>
            </thead>
            <tbody>
              {reports.sort((a, b) => b.period.localeCompare(a.period)).map(r => (
                <tr key={r.id}>
                  {templateId !== 'portfolio-business' && <td style={{ fontWeight: 600 }}>{r.businessName}</td>}
                  <td>{r.period}</td>
                  <td>{r.grossRevenue.toLocaleString()}</td>
                  <td>{r.expenses.toLocaleString()}</td>
                  <td style={{ fontWeight: 600 }}>{r.netRevenue.toLocaleString()}</td>
                  <td>{r.sharePayment.toLocaleString()}</td>
                  <td>
                    <span data-component="role-badge" data-status={r.status === 'verified' ? 'active' : r.status === 'submitted' ? 'proposed' : 'revoked'}>
                      {r.status}
                    </span>
                    {r.verifierName && <span style={{ fontSize: '0.7rem', color: '#616161', marginLeft: 4 }}>by {r.verifierName}</span>}
                  </td>
                  {canVerify && (
                    <td>
                      {r.status === 'submitted' && (
                        <button onClick={() => handleVerify(r.id)}
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: 4, color: '#2e7d32', cursor: 'pointer' }}>
                          Verify
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
