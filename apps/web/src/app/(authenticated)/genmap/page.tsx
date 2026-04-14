import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getEdgesBySubject, getEdge } from '@/lib/contracts'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getConnectedOrgs } from '@/lib/get-org-members'
// Inline health computation (was in @/lib/cpm)
function computeGroupHealth(data: Record<string, unknown>): { total: number; status: string } {
  const s = Number(data.seekers ?? 0), b = Number(data.believers ?? 0)
  const bap = Number(data.baptized ?? 0), l = Number(data.leaders ?? 0)
  const gs = Number(data.groupsStarted ?? 0), ic = Boolean(data.isChurch)
  const score = Math.min(25, s > 0 ? 15 : 0 + b > 0 ? 10 : 0) +
    Math.min(25, bap > 0 ? 15 : 0 + b >= 3 ? 10 : 0) +
    Math.min(25, l > 0 ? 10 : 0 + (ic ? 15 : 0)) +
    Math.min(25, gs * 8)
  return { total: score, status: score >= 75 ? 'thriving' : score >= 50 ? 'growing' : score >= 25 ? 'emerging' : 'stalled' }
}

function buildGenTree(rows: Array<{ id: string; parentId: string | null; generation: number; name: string; leaderName: string | null; location: string | null; healthData: string | null; status: string; startedAt: string | null }>) {
  const nodes = rows.map(r => ({ ...r, children: [] as typeof rows }))
  const map = new Map(nodes.map(n => [n.id, n]))
  const roots: typeof nodes = []
  for (const n of nodes) {
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(n)
    else roots.push(n)
  }
  return roots
}

function computeMovementMetrics(roots: ReturnType<typeof buildGenTree>) {
  const all: Array<{ generation: number; healthData: string | null; children: unknown[] }> = []
  function collect(n: (typeof roots)[number]) { all.push(n); (n.children as typeof roots).forEach(collect) }
  roots.forEach(collect)
  const maxGen = all.reduce((m, n) => Math.max(m, n.generation), 0)
  const churchCount = all.filter(n => { try { return JSON.parse(n.healthData ?? '{}').isChurch } catch { return false } }).length
  const multiplied = all.filter(n => n.children.length > 0).length
  const genBreakdown: Record<number, number> = {}
  for (const n of all) genBreakdown[n.generation] = (genBreakdown[n.generation] ?? 0) + 1
  return {
    totalGroups: all.length, activeGroups: all.length, totalBelievers: 0, totalBaptized: 0,
    totalLeaders: 0, maxGeneration: maxGen, churchCount,
    multiplicationRate: all.length > 0 ? multiplied / all.length : 0,
    streamCount: roots.length, generationBreakdown: genBreakdown,
  }
}
import { GenMapClient } from './GenMapClient'

export default async function GenMapPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)

  if (userOrgs.length === 0) {
    return (
      <div data-page="genmap">
        <div data-component="page-header"><h1>Generational Map</h1><p>No organizations found.</p></div>
      </div>
    )
  }

  // ─── Build hierarchy from on-chain ALLIANCE edges across all user orgs ────
  const allConnected: Array<{ address: string; name: string; description: string; metadata: Record<string, unknown> | null }> = []
  const seenConnected = new Set<string>()

  for (const org of userOrgs) {
    const connected = await getConnectedOrgs(org.address)
    for (const c of connected) {
      if (!seenConnected.has(c.address.toLowerCase())) {
        seenConnected.add(c.address.toLowerCase())
        allConnected.push(c)
      }
    }
  }
  const connectedOrgs = allConnected

  // Build parent-child map from edges
  type HierarchyNode = {
    id: string; parentId: string | null; generation: number
    name: string; leaderName: string | null; location: string | null
    healthData: string | null; status: string; startedAt: string | null
    groupAddress: string | null
    healthScore: number; healthStatus: string
    latitude: string; longitude: string
  }

  const hierarchyNodes: HierarchyNode[] = []

  if (connectedOrgs.length > 0) {
    // Build parent map from edges: for each connected org, find who points to it via ALLIANCE
    const parentMap = new Map<string, string>() // child addr → parent addr

    // Check edges from selected org
    try {
      const edgeIds = await getEdgesBySubject(userOrgs[0].address as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status >= 2) {
          parentMap.set(edge.object_.toLowerCase(), userOrgs[0].address.toLowerCase())
        }
      }
    } catch { /* ignored */ }

    // Check edges from each connected org (to find deeper children)
    for (const org of connectedOrgs) {
      try {
        const edgeIds = await getEdgesBySubject(org.address as `0x${string}`)
        for (const edgeId of edgeIds) {
          const edge = await getEdge(edgeId)
          if (edge.status >= 2 && !parentMap.has(edge.object_.toLowerCase())) {
            parentMap.set(edge.object_.toLowerCase(), org.address.toLowerCase())
          }
        }
      } catch { /* ignored */ }
    }

    // Compute generation numbers from parent chain
    function getGeneration(addr: string, visited = new Set<string>()): number {
      if (visited.has(addr)) return 0
      visited.add(addr)
      const parent = parentMap.get(addr)
      if (!parent) return 0
      return 1 + getGeneration(parent, visited)
    }

    // Build nodes from connected orgs + metadata
    for (const org of connectedOrgs) {
      const addr = org.address.toLowerCase()
      const meta = org.metadata ?? {}
      const health = computeGroupHealth(meta as unknown as Parameters<typeof computeGroupHealth>[0])
      const gen = getGeneration(addr)
      const parentAddr = parentMap.get(addr)

      let agentMeta = { latitude: '', longitude: '' }
      try { agentMeta = await getAgentMetadata(org.address) } catch { /* ignored */ }

      hierarchyNodes.push({
        id: addr,
        parentId: parentAddr ?? null,
        generation: gen,
        name: org.name,
        leaderName: typeof meta.leaderName === 'string' ? meta.leaderName : null,
        location: typeof meta.location === 'string' ? meta.location : org.description,
        healthData: JSON.stringify(meta),
        status: typeof meta.circleStatus === 'string' ? meta.circleStatus : 'active',
        startedAt: typeof meta.startedAt === 'string' ? meta.startedAt : null,
        groupAddress: org.address,
        healthScore: health.total,
        healthStatus: health.status,
        latitude: agentMeta.latitude ?? '',
        longitude: agentMeta.longitude ?? '',
      })
    }
  }
  const nodes = hierarchyNodes

  // Metrics
  const tree = buildGenTree(nodes.map(n => ({
    id: n.id, parentId: n.parentId, generation: n.generation,
    name: n.name, leaderName: n.leaderName, location: n.location,
    healthData: n.healthData, status: n.status, startedAt: n.startedAt,
  })))
  const metrics = computeMovementMetrics(tree)

  // Pinned items
  let pinnedNodeIds: string[] = []
  try {
    const pins = await db.select().from(schema.pinnedItems)
      .where(eq(schema.pinnedItems.userId, currentUser.id))
    pinnedNodeIds = pins.filter(p => p.itemType === 'node').map(p => p.itemId)
  } catch { /* ignored */ }

  // Geo data for map view
  const geoAgents = nodes
    .filter(n => n.latitude && n.longitude)
    .map(n => ({
      address: n.groupAddress ?? '',
      name: n.name,
      latitude: parseFloat(n.latitude),
      longitude: parseFloat(n.longitude),
      generation: n.generation,
      isEstablished: (() => { try { return JSON.parse(n.healthData ?? '{}').isChurch === true } catch { return false } })(),
      healthScore: n.healthScore,
      status: n.status,
    }))
    .filter(a => !isNaN(a.latitude) && !isNaN(a.longitude))

  return (
    <div data-page="genmap">
      <div data-component="page-header">
        <h1>Generational Map{userOrgs.length > 0 ? ` — ${userOrgs[0].name}` : ''}</h1>
        <p>Tracks how groups multiply across generations. Hierarchy is derived from on-chain ALLIANCE relationships.</p>
      </div>

      {/* Movement Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1565c0' }}>{metrics.totalGroups}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Groups</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#7c3aed' }}>G{metrics.maxGeneration}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Deepest Gen</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#2e7d32' }}>{metrics.totalBaptized}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Certified</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0d9488' }}>{metrics.churchCount}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Established</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#ea580c' }}>{Math.round(metrics.multiplicationRate * 100)}%</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Multiplying</div>
        </div>
      </div>

      {/* Generation Breakdown */}
      {Object.keys(metrics.generationBreakdown).length > 0 && (
        <section data-component="graph-section">
          <h2>Generation Pipeline</h2>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {Object.entries(metrics.generationBreakdown).sort(([a], [b]) => Number(a) - Number(b)).map(([gen, count]) => (
              <div key={gen} style={{
                flex: 1, padding: '0.75rem', borderRadius: 8, textAlign: 'center',
                background: Number(gen) >= 3 ? '#2e7d3215' : Number(gen) >= 1 ? '#0d948815' : '#1565c015',
                border: `2px solid ${Number(gen) >= 3 ? '#2e7d3240' : Number(gen) >= 1 ? '#0d948840' : '#1565c040'}`,
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: Number(gen) >= 3 ? '#2e7d32' : Number(gen) >= 1 ? '#0d9488' : '#1565c0' }}>{count}</div>
                <div style={{ fontSize: '0.75rem', color: '#616161' }}>G{gen}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <GenMapClient
        nodes={nodes}
        orgAddress={userOrgs[0].address}
        orgName={userOrgs[0].name}
        pinnedNodeIds={pinnedNodeIds}
        geoAgents={geoAgents}
      />
    </div>
  )
}
