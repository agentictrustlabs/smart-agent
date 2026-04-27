import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getEdgesBySubject, getEdgesByObject, getEdge, getPublicClient } from '@/lib/contracts'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { type GroupNode } from '@/components/catalyst/GroupHierarchy'
import { type CircleMapNode } from '@/components/catalyst/CircleMapView'
import { GroupsPageClient } from './GroupsPageClient'
import { agentAccountResolverAbi, ATL_GENMAP_DATA, ALLIANCE, GENERATIONAL_LINEAGE } from '@smart-agent/sdk'
import { getAgentKind } from '@/lib/agent-registry'
import { getUserHubId } from '@/lib/get-user-hub'

export default async function CatalystGroupsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // ── CIL Portfolio branch ─────────────────────────────────────────────
  const isCIL = (await getUserHubId(currentUser.id)) === 'cil'
  if (isCIL) {
    const { db, schema } = await import('@/db')
    const { getMCRole, getBusinessOrgAddressesForUser } = await import('@/lib/mc-roles')
    const { PortfolioPageClient } = await import('@/components/mc/PortfolioPageClient')
    const { getConnectedOrgs } = await import('@/lib/get-org-members')

    const role = getMCRole(currentUser.id)
    const allowedAddrs = getBusinessOrgAddressesForUser(currentUser.id)

    // Get all revenue reports
    const allReports = await db.select().from(schema.revenueReports)

    // Get all users for name lookup
    const allUsers = await db.select().from(schema.users)
    const userNames: Record<string, string> = {}
    for (const u of allUsers) userNames[u.id] = u.name

    // Build business org address → name mapping from on-chain data
    const userOrgs = await getUserOrgs(currentUser.id)
    const businessAddrs = new Set<string>()
    for (const org of userOrgs) {
      try {
        const connected = await getConnectedOrgs(org.address)
        for (const c of connected) businessAddrs.add(c.address.toLowerCase())
      } catch { /* ignored */ }
    }

    // Collect all unique org addresses from revenue reports
    const reportOrgAddrs = new Set(allReports.map(r => r.orgAddress.toLowerCase()))
    for (const addr of reportOrgAddrs) businessAddrs.add(addr)

    // Build metadata for each business
    const bizMeta: Record<string, { name: string; ownerName: string }> = {}
    for (const addr of businessAddrs) {
      try {
        const meta = await getAgentMetadata(addr)
        // Find owner from reports
        const ownerReport = allReports.find(r => r.orgAddress.toLowerCase() === addr)
        const ownerName = ownerReport ? (userNames[ownerReport.submittedBy] ?? 'Unknown') : 'Unknown'
        bizMeta[addr] = { name: meta.displayName, ownerName }
      } catch {
        bizMeta[addr] = { name: addr.slice(0, 10) + '...', ownerName: 'Unknown' }
      }
    }

    // Determine wave cohorts (from seed data pattern: wave1 businesses vs wave2)
    // For demo: Afia and Kossi are Wave 1, others Wave 2
    const wave1Addrs = new Set([
      '0x00000000000000000000000000000000000c0003',
      '0x00000000000000000000000000000000000c0004',
    ])

    // Build portfolio businesses from revenue report data
    type PortfolioBusiness = {
      address: string; name: string; ownerName: string
      healthStatus: 'green' | 'yellow' | 'red' | 'unknown'
      latestRevenue: number | null; totalSharePayments: number
      lastReportDate: string | null; waveCohort: string
    }

    const bizGrouped = new Map<string, typeof allReports>()
    for (const r of allReports) {
      const key = r.orgAddress.toLowerCase()
      if (!bizGrouped.has(key)) bizGrouped.set(key, [])
      bizGrouped.get(key)!.push(r)
    }

    const businesses: PortfolioBusiness[] = []
    for (const [addr, reports] of bizGrouped) {
      // Role filter: business owners see only their own
      if (allowedAddrs && !allowedAddrs.some(a => a.toLowerCase() === addr)) continue

      const sorted = reports.sort((a, b) => b.period.localeCompare(a.period))
      const latest = sorted[0]
      const prev = sorted[1]

      let healthStatus: 'green' | 'yellow' | 'red' | 'unknown' = 'unknown'
      if (latest) {
        if (latest.netRevenue < 0) {
          healthStatus = 'red'
        } else if (prev && latest.netRevenue < prev.netRevenue) {
          healthStatus = 'yellow'
        } else if (latest.netRevenue > 0) {
          healthStatus = 'green'
        }
      }

      const totalShare = reports.reduce((s, r) => s + r.sharePayment, 0)
      const meta = bizMeta[addr] ?? { name: addr.slice(0, 10) + '...', ownerName: 'Unknown' }

      businesses.push({
        address: addr,
        name: meta.name,
        ownerName: meta.ownerName,
        healthStatus,
        latestRevenue: latest?.grossRevenue ?? null,
        totalSharePayments: totalShare,
        lastReportDate: latest?.createdAt ?? null,
        waveCohort: wave1Addrs.has(addr) ? 'Wave 1' : 'Wave 2',
      })
    }

    businesses.sort((a, b) => a.waveCohort.localeCompare(b.waveCohort) || a.name.localeCompare(b.name))

    // Capital totals (hardcoded for now)
    const totalDeployed = 12500
    const totalRecovered = businesses.reduce((s, b) => s + b.totalSharePayments, 0)

    return (
      <PortfolioPageClient
        businesses={businesses}
        totalDeployed={totalDeployed}
        totalRecovered={totalRecovered}
        role={role}
      />
    )
  }
  // ── End CIL Portfolio branch ─────────────────────────────────────────

  const userOrgs = await getUserOrgs(currentUser.id)
  if (userOrgs.length === 0) return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#9a8c7e' }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
      <p style={{ fontSize: '0.9rem', fontWeight: 500 }}>No circles yet</p>
      <p style={{ fontSize: '0.8rem' }}>Deploy an organization to get started.</p>
    </div>
  )

  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  const client = getPublicClient()

  // Read health data directly from on-chain resolver
  async function readHealthData(addr: string): Promise<Record<string, unknown>> {
    if (!resolverAddr) return {}
    try {
      const json = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [addr as `0x${string}`, ATL_GENMAP_DATA as `0x${string}`],
      }) as string
      if (json) return JSON.parse(json)
    } catch { /* no health data */ }
    return {}
  }

  // Build hierarchy from on-chain ALLIANCE edges
  const groups: GroupNode[] = []
  const seen = new Set<string>()

  async function addOrg(addr: string, depth: number, parentAddr: string | null) {
    const key = addr.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)

    const meta = await getAgentMetadata(addr)
    const health = await readHealthData(addr)

    groups.push({
      id: `org-${key.slice(2, 10)}`,
      address: addr,
      name: meta.displayName,
      primaryName: meta.primaryName,
      description: meta.description,
      parentAddress: parentAddr, depth,
      leaderName: typeof health.leaderName === 'string' ? health.leaderName : null,
      location: typeof health.location === 'string' ? health.location : null,
      isEstablished: Boolean(health.isChurch),
      healthData: Object.keys(health).length > 0 ? JSON.stringify(health) : null,
      status: typeof health.circleStatus === 'string' ? health.circleStatus : 'active',
      metadata: health,
    })

    // Walk children via outgoing edges. Only follow structural org→org
    // edges (ALLIANCE / GENERATIONAL_LINEAGE) and only land on organization-
    // typed agents — otherwise NAMESPACE_CONTAINS pulls in person agents
    // (e.g. Diego under Johnstown) and ORGANIZATION_MEMBERSHIP pulls
    // their other orgs back in (Fort Collins Network under Diego).
    try {
      const edgeIds = await getEdgesBySubject(addr as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        const t = edge.relationshipType.toLowerCase()
        if (t !== ALLIANCE_LC && t !== GENLINEAGE_LC) continue
        if (seen.has(edge.object_.toLowerCase())) continue
        const childKind = await getAgentKind(edge.object_).catch(() => 'unknown' as const)
        if (childKind !== 'org') continue
        await addOrg(edge.object_, depth + 1, key)
      }
    } catch { /* ignored */ }
  }

  const ALLIANCE_LC = (ALLIANCE as string).toLowerCase()
  const GENLINEAGE_LC = (GENERATIONAL_LINEAGE as string).toLowerCase()

  // Walk INCOMING structural edges to find each user-org's root ancestor,
  // so the rendered hierarchy starts from the top-level org instead of
  // from whatever happens to be in `userOrgs`. A circle leader who only
  // controls one local circle still sees the full tree above them.
  async function findRoot(addr: string): Promise<string> {
    const visited = new Set<string>([addr.toLowerCase()])
    let cur = addr
    // Cap the climb so a cycle can't hang the page.
    for (let i = 0; i < 8; i++) {
      let parent: string | null = null
      try {
        const inIds = await getEdgesByObject(cur as `0x${string}`)
        for (const id of inIds) {
          const e = await getEdge(id).catch(() => null)
          if (!e || e.status < 2) continue
          const t = e.relationshipType.toLowerCase()
          if (t !== ALLIANCE_LC && t !== GENLINEAGE_LC) continue
          if (visited.has(e.subject.toLowerCase())) continue
          const k = await getAgentKind(e.subject).catch(() => 'unknown' as const)
          if (k !== 'org') continue
          parent = e.subject
          break
        }
      } catch { /* ignored */ }
      if (!parent) return cur
      visited.add(parent.toLowerCase())
      cur = parent
    }
    return cur
  }

  // Collect distinct roots reachable from the user's orgs.
  const rootSet = new Set<string>()
  for (const org of userOrgs) {
    const root = await findRoot(org.address)
    rootSet.add(root.toLowerCase())
  }

  // Resolve canonical-cased addresses for sort stability.
  const roots = [...rootSet]
  for (const root of roots) {
    await addOrg(root, 0, null)
  }

  groups.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))

  // Build map nodes with geo data from health data or resolver metadata
  const mapNodes: CircleMapNode[] = groups.map((g) => {
    // Try health data first, then resolver metadata
    const healthLat = typeof g.metadata.latitude === 'number' ? g.metadata.latitude : parseFloat(String(g.metadata.latitude || ''))
    const healthLon = typeof g.metadata.longitude === 'number' ? g.metadata.longitude : parseFloat(String(g.metadata.longitude || ''))

    const lat = !isNaN(healthLat) && healthLat !== 0 ? healthLat : null
    const lon = !isNaN(healthLon) && healthLon !== 0 ? healthLon : null

    // Parse health score from health data
    let healthScore: number | undefined
    if (typeof g.metadata.healthScore === 'number') {
      healthScore = g.metadata.healthScore
    } else if (typeof g.metadata.healthScore === 'string') {
      healthScore = parseFloat(g.metadata.healthScore) || undefined
    }

    return {
      address: g.address,
      name: g.name,
      parentAddress: g.parentAddress,
      latitude: lat,
      longitude: lon,
      isEstablished: g.isEstablished,
      leaderName: g.leaderName,
      healthScore,
    }
  })

  // Also try to fill in lat/lng from resolver metadata for circles missing geo in health data
  for (const node of mapNodes) {
    if (node.latitude != null && node.longitude != null) continue
    try {
      const meta = await getAgentMetadata(node.address)
      const lat = parseFloat(meta.latitude)
      const lon = parseFloat(meta.longitude)
      if (!isNaN(lat) && lat !== 0 && !isNaN(lon) && lon !== 0) {
        node.latitude = lat
        node.longitude = lon
      }
    } catch { /* ignored */ }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Circles</h1>
        <p style={{ fontSize: '0.85rem', color: '#616161', margin: 0 }}>
          Hierarchy of circles and gatherings. Click a circle to edit health metrics and practices.
        </p>
      </div>
      <GroupsPageClient groups={groups} mapNodes={mapNodes} orgAddress={userOrgs[0].address} />
    </div>
  )
}
