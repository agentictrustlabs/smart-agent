import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { buildAgentNameMap, getNameFromMap } from '@/lib/agent-metadata'
import { getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName } from '@smart-agent/sdk'
import { RevenueClient } from './RevenueClient'

export default async function RevenuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  if (!selectedOrg) {
    return (
      <div data-page="revenue">
        <div data-component="page-header">
          <h1>Revenue Reports</h1>
          <p>Select an organization to view revenue reports.</p>
        </div>
      </div>
    )
  }

  const templateId = (selectedOrg as Record<string, unknown>).templateId as string | null

  // Load reports for this org (if portfolio-business) or all portfolio businesses (if impact-investor/field-agency)
  const allReports = await db.select().from(schema.revenueReports)
  const allOrgs = await db.select().from(schema.orgAgents)
  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(nameMap, a)

  let reports: typeof allReports
  let businessNames: Record<string, string> = {}

  if (templateId === 'portfolio-business') {
    // Business owner sees their own reports
    reports = allReports.filter(r => r.orgAddress === selectedOrg.smartAccountAddress.toLowerCase())
    businessNames[selectedOrg.smartAccountAddress.toLowerCase()] = selectedOrg.name
  } else {
    // CIL / ILAD / OOC sees all portfolio business reports
    const portfolioOrgs = allOrgs.filter(o => (o as Record<string, unknown>).templateId === 'portfolio-business')
    const portfolioAddrs = new Set(portfolioOrgs.map(o => o.smartAccountAddress.toLowerCase()))
    reports = allReports.filter(r => portfolioAddrs.has(r.orgAddress))
    for (const o of portfolioOrgs) {
      businessNames[o.smartAccountAddress.toLowerCase()] = o.name
    }
  }

  // Get user names for submitted-by
  const allUsers = await db.select().from(schema.users)
  const userNames: Record<string, string> = {}
  for (const u of allUsers) userNames[u.id] = u.name

  // Detect user roles on this org
  const personAgents = await db.select().from(schema.personAgents).where(eq(schema.personAgents.userId, currentUser.id)).limit(1)
  let userRolesOnOrg: string[] = []
  if (personAgents[0] && selectedOrg) {
    try {
      const edgeIds = await getEdgesByObject(selectedOrg.smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.subject.toLowerCase() !== personAgents[0].smartAccountAddress.toLowerCase()) continue
        if (edge.status < 2) continue
        const roles = await getEdgeRoles(edgeId)
        userRolesOnOrg.push(...roles.map(r => roleName(r)))
      }
    } catch {}
  }

  const canSubmit = templateId === 'portfolio-business' && userRolesOnOrg.includes('owner')
  const canVerify = ['impact-investor', 'field-agency'].includes(templateId ?? '') || userRolesOnOrg.some(r => ['advisor', 'operator'].includes(r))

  return (
    <div data-page="revenue">
      <div data-component="page-header">
        <h1>Revenue Reports{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
        <p>
          {templateId === 'portfolio-business'
            ? 'Submit monthly revenue reports to track your business performance.'
            : 'Monitor revenue reports from portfolio businesses.'}
        </p>
      </div>

      <RevenueClient
        reports={reports.map(r => ({
          ...r,
          businessName: businessNames[r.orgAddress] ?? getName(r.orgAddress),
          submitterName: userNames[r.submittedBy] ?? 'Unknown',
          verifierName: r.verifiedBy ? (userNames[r.verifiedBy] ?? 'Unknown') : null,
        }))}
        orgAddress={selectedOrg.smartAccountAddress}
        orgName={selectedOrg.name}
        canSubmit={canSubmit}
        canVerify={canVerify}
        templateId={templateId}
      />
    </div>
  )
}
