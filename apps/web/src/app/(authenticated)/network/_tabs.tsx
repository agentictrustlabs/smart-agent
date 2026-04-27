import Link from 'next/link'
import { TrustGraphView } from '@/components/graph/TrustGraphView'
import { loadRelationships, getAgentMetadata, getAgentKind, getEdge, getEdgesBySubject, getOrgMembers, getConnectedOrgs, getUserOrgs } from './_data'

/**
 * Per-tab server components. Each one is a self-contained data fetch
 * dropped into a Suspense boundary by the page so the network shell
 * paints immediately and the active tab streams when ready.
 *
 * Shared work (relationships hydration) goes through the request-scoped
 * cached `loadRelationships` so the toolbar stats and any tab that needs
 * the relationship list hit the same in-flight promise.
 */

export async function StatsSlot({ userId }: { userId: string }) {
  const { relationships, outgoing, incoming } = await loadRelationships(userId)
  return (
    <div data-component="network-toolbar-stats">
      <span>{relationships.length} edges</span>
      <span>{outgoing.length} out</span>
      <span>{incoming.length} in</span>
    </div>
  )
}

export async function GraphTabContent({ userId }: { userId: string }) {
  const userOrgs = await getUserOrgs(userId)
  const primaryOrg = userOrgs[0]
  return <TrustGraphView orgAddress={primaryOrg?.address} />
}

export async function MapTabContent({ userId }: { userId: string }) {
  const { relationships, userOrgs } = await loadRelationships(userId)

  // Hierarchy needed for the map's full address set.
  const hierarchyAddrs = await collectHierarchyAddresses(userOrgs)

  const allAddrs = new Set<string>()
  for (const org of userOrgs) allAddrs.add(org.address.toLowerCase())
  for (const a of hierarchyAddrs) allAddrs.add(a.toLowerCase())
  for (const rel of relationships) allAddrs.add(rel.counterpartyAddr.toLowerCase())

  // Resolve metadata + kind in parallel for every address.
  const resolved = await Promise.all([...allAddrs].map(async addr => {
    try {
      const [meta, kind] = await Promise.all([getAgentMetadata(addr), getAgentKind(addr)])
      const lat = parseFloat(meta.latitude) || 0
      const lon = parseFloat(meta.longitude) || 0
      if (lat === 0 && lon === 0) return null
      if (kind === 'hub') return null
      return {
        address: addr,
        name: meta.displayName,
        type: (kind === 'org' ? 'org' : kind === 'ai' ? 'ai' : 'person') as 'person' | 'org' | 'ai',
        latitude: lat, longitude: lon,
      }
    } catch { return null }
  }))
  const mapAgents = resolved.filter((a): a is NonNullable<typeof a> => a !== null)
  const seenMap = new Set(mapAgents.map(a => a.address.toLowerCase()))

  type MapEdgeData = { sourceAddr: string; targetAddr: string; roles: string[]; relationshipType: string; status: string; edgeId: string }
  const mapEdges: MapEdgeData[] = []
  for (const rel of relationships) {
    const sourceAddr = rel.direction === 'outgoing' ? rel.orgAddr : rel.counterpartyAddr
    const targetAddr = rel.direction === 'outgoing' ? rel.counterpartyAddr : rel.orgAddr
    if (!seenMap.has(sourceAddr.toLowerCase()) || !seenMap.has(targetAddr.toLowerCase())) continue
    mapEdges.push({
      sourceAddr, targetAddr,
      roles: rel.roles, relationshipType: rel.type,
      status: rel.status, edgeId: rel.edgeId,
    })
  }

  if (mapAgents.length === 0) return <p data-component="text-muted">No agents with location data.</p>
  const { NetworkMapView } = await import('@/components/graph/NetworkMapView')
  return <NetworkMapView agents={mapAgents} edges={mapEdges} />
}

export async function HierarchyTabContent({ userId }: { userId: string }) {
  const userOrgs = await getUserOrgs(userId)

  type HierarchyNode = {
    address: string; name: string; description: string
    kind: 'person' | 'org' | 'ai' | 'hub' | 'unknown'
    parentAddress: string | null; generation: number
    latitude: number; longitude: number
    leaderName: string | null; location: string | null
    isEstablished: boolean; healthScore: number; status: string
    roles: string[]
    metadata: Record<string, unknown>
  }

  const seen = new Set<string>()
  const nodes: HierarchyNode[] = []

  async function addOrg(orgAddr: string, orgName: string, orgDesc: string, gen: number, parentAddr: string | null) {
    const key = orgAddr.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)

    const [meta, connected] = await Promise.all([
      getAgentMetadata(orgAddr).catch(() => ({ latitude: '', longitude: '' }) as Record<string, string>),
      getConnectedOrgs(orgAddr).catch(() => []),
    ])
    const orgMeta = (connected.find(c => c.address.toLowerCase() === key)?.metadata ?? {}) as Record<string, unknown>

    nodes.push({
      address: orgAddr, name: orgName, description: orgDesc,
      kind: 'org', parentAddress: parentAddr, generation: gen,
      latitude: parseFloat((meta as Record<string, string>).latitude) || 0,
      longitude: parseFloat((meta as Record<string, string>).longitude) || 0,
      leaderName: typeof orgMeta.leaderName === 'string' ? orgMeta.leaderName : null,
      location: typeof orgMeta.location === 'string' ? orgMeta.location : null,
      isEstablished: Boolean(orgMeta.isChurch),
      healthScore: 0, status: typeof orgMeta.circleStatus === 'string' ? orgMeta.circleStatus : 'active',
      roles: [], metadata: orgMeta,
    })

    // Members in parallel.
    try {
      const { members } = await getOrgMembers(orgAddr)
      const memberData = await Promise.all(members.map(async m => {
        const mKey = m.address.toLowerCase()
        if (seen.has(mKey)) return null
        const [mMeta, kind] = await Promise.all([
          getAgentMetadata(m.address).catch(() => ({ latitude: '', longitude: '' }) as Record<string, string>),
          getAgentKind(m.address),
        ])
        return { m, mKey, mMeta, kind }
      }))
      for (const item of memberData) {
        if (!item) continue
        if (seen.has(item.mKey)) continue
        seen.add(item.mKey)
        nodes.push({
          address: item.m.address, name: item.m.name, description: '',
          kind: item.kind, parentAddress: orgAddr.toLowerCase(), generation: gen,
          latitude: parseFloat((item.mMeta as Record<string, string>).latitude) || 0,
          longitude: parseFloat((item.mMeta as Record<string, string>).longitude) || 0,
          leaderName: null, location: null,
          isEstablished: false, healthScore: 0, status: item.m.status.toLowerCase(),
          roles: item.m.roles, metadata: {},
        })
      }
    } catch { /* */ }
  }

  // G0: user's orgs in parallel.
  await Promise.all(userOrgs.map(o => addOrg(o.address, o.name, o.description, 0, null)))

  // BFS by generation; each level fans out in parallel.
  let frontier: string[] = userOrgs.map(o => o.address)
  let gen = 0
  while (frontier.length > 0 && gen < 8) {
    const childResults = await Promise.all(frontier.map(async parentAddr => {
      try {
        const edgeIds = await getEdgesBySubject(parentAddr as `0x${string}`)
        const edges = await Promise.all(edgeIds.map(id => getEdge(id).catch(() => null)))
        const children: { childAddr: string; parentAddr: string; meta: Awaited<ReturnType<typeof getAgentMetadata>> }[] = []
        const childMetas = await Promise.all(edges.map(async edge => {
          if (!edge || edge.status < 2) return null
          if (seen.has(edge.object_.toLowerCase())) return null
          try {
            const meta = await getAgentMetadata(edge.object_)
            return { childAddr: edge.object_, parentAddr, meta }
          } catch { return null }
        }))
        for (const c of childMetas) if (c) children.push(c)
        return children
      } catch { return [] }
    }))
    const flat = childResults.flat()
    if (flat.length === 0) break
    await Promise.all(flat.map(c => addOrg(c.childAddr, c.meta.displayName, c.meta.description, gen + 1, c.parentAddr.toLowerCase())))
    frontier = flat.map(c => c.childAddr)
    gen++
  }

  nodes.sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation
    if (a.kind === 'org' && b.kind !== 'org') return -1
    if (a.kind !== 'org' && b.kind === 'org') return 1
    return a.name.localeCompare(b.name)
  })

  if (nodes.length === 0) return <p data-component="text-muted">No agents in hierarchy.</p>
  const { HierarchyView } = await import('@/components/graph/HierarchyView')
  const data = nodes.map(n => ({
    address: n.address, name: n.name, description: n.description,
    kind: n.kind, parentAddress: n.parentAddress, depth: n.generation,
    roles: n.roles, isEstablished: n.isEstablished,
    leaderName: n.leaderName, location: n.location, metadata: n.metadata,
  }))
  return <HierarchyView agents={data} />
}

export async function EndorsementsTabContent({ userId }: { userId: string }) {
  const { outgoing, incoming } = await loadRelationships(userId)
  const received = incoming.filter(r => r.type === 'Validation')
  const given = outgoing.filter(r => r.type === 'Validation')

  if (received.length === 0 && given.length === 0) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <p data-component="text-muted">No endorsements or accreditations.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {received.length > 0 && (
        <section data-component="graph-section">
          <h2>Endorsements Received ({received.length})</h2>
          <div data-component="network-card-grid">
            {received.map(e => (
              <div key={e.edgeId} data-component="network-rel-card">
                <Link href={`/agents/${e.counterpartyAddr}`} style={{ fontWeight: 600, color: '#1565c0' }}>{e.counterparty}</Link>
                <div data-component="network-rel-meta">
                  {e.roles.map(r => <span key={r} data-component="role-badge">{r}</span>)}
                  <span data-component="role-badge" data-status={e.status === 'Active' ? 'active' : 'proposed'}>{e.status}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {given.length > 0 && (
        <section data-component="graph-section">
          <h2>Endorsements Given ({given.length})</h2>
          <div data-component="network-card-grid">
            {given.map(e => (
              <div key={e.edgeId} data-component="network-rel-card">
                <Link href={`/agents/${e.counterpartyAddr}`} style={{ fontWeight: 600, color: '#1565c0' }}>{e.counterparty}</Link>
                <div data-component="network-rel-meta">
                  {e.roles.map(r => <span key={r} data-component="role-badge">{r}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// Walk the org+children tree just to collect addresses (no metadata).
// Used by the Map tab to know which addresses to look up.
async function collectHierarchyAddresses(userOrgs: Awaited<ReturnType<typeof getUserOrgs>>): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  const enqueueOrg = async (orgAddr: string) => {
    const key = orgAddr.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(orgAddr)
    try {
      const { members } = await getOrgMembers(orgAddr)
      for (const m of members) {
        const mKey = m.address.toLowerCase()
        if (seen.has(mKey)) continue
        seen.add(mKey)
        out.push(m.address)
      }
    } catch { /* */ }
  }
  await Promise.all(userOrgs.map(o => enqueueOrg(o.address)))

  let frontier: string[] = userOrgs.map(o => o.address)
  let depth = 0
  while (frontier.length > 0 && depth < 8) {
    const childLists = await Promise.all(frontier.map(async parentAddr => {
      try {
        const ids = await getEdgesBySubject(parentAddr as `0x${string}`)
        const edges = await Promise.all(ids.map(id => getEdge(id).catch(() => null)))
        const children: string[] = []
        for (const e of edges) {
          if (!e || e.status < 2) continue
          if (seen.has(e.object_.toLowerCase())) continue
          children.push(e.object_)
        }
        return children
      } catch { return [] }
    }))
    const next = childLists.flat()
    if (next.length === 0) break
    await Promise.all(next.map(addr => enqueueOrg(addr)))
    frontier = next
    depth++
  }

  return out
}
