import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { db, schema } from '@/db'

import { getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName } from '@smart-agent/sdk'
import { WAVE_COLORS, WAVE_LABELS, getWaveStatus, computeHealthScore, HEALTH_COLORS } from '@/lib/togo'
import type { WaveStatus } from '@/lib/togo'

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  if (!selectedOrg) {
    return (
      <div data-page="portfolio">
        <div data-component="page-header"><h1>Portfolio</h1><p>Select an organization to view the portfolio.</p></div>
      </div>
    )
  }

  const templateId = (selectedOrg as Record<string, unknown>).templateId as string | null

  // Load portfolio businesses
  const allOrgs = await db.select().from(schema.orgAgents)
  const portfolioBiz = allOrgs.filter(o => (o as Record<string, unknown>).templateId === 'portfolio-business')
  const allReports = await db.select().from(schema.revenueReports)
  const allCompletions = await db.select().from(schema.trainingCompletions)
  const allPersonAgents = await db.select().from(schema.personAgents)
  const allUsers = await db.select().from(schema.users)
  const modules = await db.select().from(schema.trainingModules)
  const requiredModuleCount = modules.length || 8 // fallback to BDC count

  type BizView = {
    name: string; address: string; description: string
    ownerName: string; ownerUserId: string
    wave: WaveStatus; healthScore: number; healthStatus: string
    reportsCount: number; totalRevenue: number; totalSharePaid: number
    trainingCompletion: number; monthsActive: number
  }
  const businesses: BizView[] = []

  for (const biz of portfolioBiz) {
    // Find owner
    let ownerName = 'Unknown'; let ownerUserId = ''
    try {
      const edgeIds = await getEdgesByObject(biz.smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        const roles = await getEdgeRoles(edgeId)
        if (roles.map(r => roleName(r)).includes('owner')) {
          const pa = allPersonAgents.find(p => p.smartAccountAddress.toLowerCase() === edge.subject.toLowerCase())
          if (pa) {
            const user = allUsers.find(u => u.id === pa.userId)
            if (user) { ownerName = user.name; ownerUserId = user.id }
          }
        }
      }
    } catch { /* ignored */ }

    const reports = allReports.filter(r => r.orgAddress === biz.smartAccountAddress.toLowerCase())
    const totalRevenue = reports.reduce((s, r) => s + r.grossRevenue, 0)
    const totalSharePaid = reports.reduce((s, r) => s + r.sharePayment, 0)
    const monthsActive = reports.length > 0
      ? Math.max(1, Math.ceil((Date.now() - new Date(reports[0].createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000)))
      : 0

    const ownerCompletions = allCompletions.filter(c => c.userId === ownerUserId)
    const trainingCompletion = requiredModuleCount > 0 ? ownerCompletions.length / requiredModuleCount : 0

    const wave = getWaveStatus({
      totalDeployed: totalSharePaid > 0 ? totalSharePaid * 10 : 500_000, // estimate from share payments
      totalCollected: totalSharePaid,
      monthsActive,
      trainingCompletion,
      isPaused: false,
    })

    const health = computeHealthScore({
      reportsSubmitted: reports.length,
      monthsActive,
      revenueGrowthPercent: reports.length >= 2
        ? ((reports[reports.length - 1].grossRevenue - reports[0].grossRevenue) / Math.max(reports[0].grossRevenue, 1)) * 100
        : 0,
      repaymentRate: totalRevenue > 0 ? totalSharePaid / totalRevenue : 0,
      trainingCompletion,
    })

    businesses.push({
      name: biz.name, address: biz.smartAccountAddress,
      description: biz.description ?? '',
      ownerName, ownerUserId,
      wave, healthScore: health.total, healthStatus: health.status,
      reportsCount: reports.length, totalRevenue, totalSharePaid,
      trainingCompletion: Math.round(trainingCompletion * 100), monthsActive,
    })
  }

  // Aggregate stats
  const totalDeployed = businesses.reduce((s, b) => s + b.totalRevenue, 0)
  const totalCollected = businesses.reduce((s, b) => s + b.totalSharePaid, 0)
  const avgHealth = businesses.length > 0 ? Math.round(businesses.reduce((s, b) => s + b.healthScore, 0) / businesses.length) : 0

  // Wave pipeline counts
  const waveCounts: Record<string, number> = {}
  for (const b of businesses) waveCounts[b.wave] = (waveCounts[b.wave] || 0) + 1

  return (
    <div data-page="portfolio">
      <div data-component="page-header">
        <h1>Portfolio{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
        <p>
          {templateId === 'portfolio-business'
            ? 'Your business performance in the revenue-sharing portfolio.'
            : 'Portfolio health, wave progression, and business performance metrics.'}
        </p>
      </div>

      {/* Aggregate Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1565c0' }}>{businesses.length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Businesses</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#2e7d32' }}>{(totalDeployed / 1_000_000).toFixed(1)}M</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Total Revenue (XOF)</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0d9488' }}>{(totalCollected / 1_000_000).toFixed(1)}M</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Share Collected (XOF)</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: avgHealth >= 65 ? '#2e7d32' : avgHealth >= 40 ? '#d97706' : '#b91c1c' }}>{avgHealth}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Avg Health Score</div>
        </div>
      </div>

      {/* Wave Pipeline */}
      <section data-component="graph-section">
        <h2>Wave Pipeline</h2>
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
          {(['underwriting', 'wave-1', 'wave-2', 'wave-3', 'graduated'] as const).map(w => (
            <div key={w} style={{
              flex: 1, padding: '0.75rem', borderRadius: 8, textAlign: 'center',
              background: `${WAVE_COLORS[w]}15`, border: `2px solid ${WAVE_COLORS[w]}40`,
            }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: WAVE_COLORS[w] }}>{waveCounts[w] || 0}</div>
              <div style={{ fontSize: '0.75rem', color: '#616161' }}>{WAVE_LABELS[w]}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Business Cards */}
      <section data-component="graph-section">
        <h2>Businesses ({businesses.length})</h2>
        <div data-component="agent-grid">
          {businesses.map(biz => (
            <div key={biz.address} data-component="agent-card" data-status="deployed">
              <div data-component="agent-card-header">
                <h3>{biz.name}</h3>
                <span data-component="role-badge" style={{ background: `${WAVE_COLORS[biz.wave]}20`, color: WAVE_COLORS[biz.wave], border: `1px solid ${WAVE_COLORS[biz.wave]}40` }}>
                  {WAVE_LABELS[biz.wave]}
                </span>
              </div>
              <p data-component="card-description">{biz.description}</p>
              <div style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '0.5rem' }}>
                Owner: <strong>{biz.ownerName}</strong>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem' }}>
                <div>
                  <div style={{ color: '#616161' }}>Health</div>
                  <div style={{ fontWeight: 700, color: HEALTH_COLORS[biz.healthStatus as keyof typeof HEALTH_COLORS] }}>{biz.healthScore}/100</div>
                </div>
                <div>
                  <div style={{ color: '#616161' }}>Reports</div>
                  <div style={{ fontWeight: 700 }}>{biz.reportsCount} months</div>
                </div>
                <div>
                  <div style={{ color: '#616161' }}>Training</div>
                  <div style={{ fontWeight: 700 }}>{biz.trainingCompletion}%</div>
                </div>
                <div>
                  <div style={{ color: '#616161' }}>Revenue (XOF)</div>
                  <div style={{ fontWeight: 700 }}>{(biz.totalRevenue / 1000).toFixed(0)}K</div>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Link href={`/agents/${biz.address}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                <Link href={`/revenue?org=${biz.address}`} style={{ color: '#1565c0' }}>Revenue</Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
