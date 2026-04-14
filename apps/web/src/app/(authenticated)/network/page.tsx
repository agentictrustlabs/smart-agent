import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getEdgesBySubject, getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, relationshipTypeName } from '@smart-agent/sdk'
import { buildAgentNameMap, getNameFromMap, getAgentMetadata } from '@/lib/agent-metadata'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { TrustGraphView } from '@/components/graph/TrustGraphView'
import { NetworkTabs } from './NetworkTabs'

const STATUS_NAMES = ['None', 'Proposed', 'Confirmed', 'Active', 'Suspended', 'Revoked', 'Rejected']

export default async function NetworkPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)
  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(nameMap, a)

  type RelView = { edgeId: string; direction: string; counterparty: string; counterpartyAddr: string; type: string; roles: string[]; status: string; orgName: string }
  const relationships: RelView[] = []
  const seenEdges = new Set<string>()

  // Aggregate relationships across all user orgs
  for (const org of userOrgs) {
    try {
      for (const edgeId of await getEdgesBySubject(org.address as `0x${string}`)) {
        if (seenEdges.has(edgeId)) continue
        seenEdges.add(edgeId)
        const edge = await getEdge(edgeId)
        const roles = await getEdgeRoles(edgeId)
        relationships.push({
          edgeId, direction: 'outgoing', counterparty: getName(edge.object_),
          counterpartyAddr: edge.object_, type: relationshipTypeName(edge.relationshipType, undefined, 'catalyst'),
          roles: roles.map(r => roleName(r, undefined, 'catalyst')), status: STATUS_NAMES[edge.status] ?? 'Unknown',
          orgName: org.name,
        })
      }
      for (const edgeId of await getEdgesByObject(org.address as `0x${string}`)) {
        if (seenEdges.has(edgeId)) continue
        seenEdges.add(edgeId)
        const edge = await getEdge(edgeId)
        const roles = await getEdgeRoles(edgeId)
        relationships.push({
          edgeId, direction: 'incoming', counterparty: getName(edge.subject),
          counterpartyAddr: edge.subject, type: relationshipTypeName(edge.relationshipType, undefined, 'catalyst'),
          roles: roles.map(r => roleName(r, undefined, 'catalyst')), status: STATUS_NAMES[edge.status] ?? 'Unknown',
          orgName: org.name,
        })
      }
    } catch { /* ignored */ }
  }

  const outgoing = relationships.filter(r => r.direction === 'outgoing')
  const incoming = relationships.filter(r => r.direction === 'incoming')

  // ─── Build generational hierarchy using on-chain query contract ─────
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
  const hierarchyNodes: HierarchyNode[] = []
  const seenHierarchy = new Set<string>()

  const { getAgentKind } = await import('@/lib/agent-registry')
  const { getOrgMembers } = await import('@/lib/get-org-members')

  // Helper: add an org + its members to the hierarchy at a given generation
  async function addOrgToHierarchy(orgAddr: string, orgName: string, orgDesc: string, gen: number, parentAddr: string | null) {
    const key = orgAddr.toLowerCase()
    if (seenHierarchy.has(key)) return
    seenHierarchy.add(key)

    const meta = await getAgentMetadata(orgAddr).catch(() => ({ latitude: '', longitude: '' })) as Record<string, string>
    const orgMeta = (await getConnectedOrgs(orgAddr).catch(() => [])).find(c => c.address.toLowerCase() === key)?.metadata ?? {}

    hierarchyNodes.push({
      address: orgAddr, name: orgName, description: orgDesc,
      kind: 'org', parentAddress: parentAddr, generation: gen,
      latitude: parseFloat(meta.latitude) || 0,
      longitude: parseFloat(meta.longitude) || 0,
      leaderName: typeof orgMeta.leaderName === 'string' ? orgMeta.leaderName : null,
      location: typeof orgMeta.location === 'string' ? orgMeta.location : null,
      isEstablished: Boolean(orgMeta.isChurch),
      healthScore: 0, status: typeof orgMeta.circleStatus === 'string' ? orgMeta.circleStatus : 'active',
      roles: [], metadata: orgMeta,
    })

    // Add member agents (persons, AI) associated with this org
    try {
      const { members } = await getOrgMembers(orgAddr)
      for (const m of members) {
        const mKey = m.address.toLowerCase()
        if (seenHierarchy.has(mKey)) continue
        seenHierarchy.add(mKey)
        const mMeta = await getAgentMetadata(m.address).catch(() => ({ latitude: '', longitude: '' })) as Record<string, string>
        const kind = await getAgentKind(m.address)
        hierarchyNodes.push({
          address: m.address, name: m.name, description: '',
          kind, parentAddress: orgAddr.toLowerCase(), generation: gen,
          latitude: parseFloat(mMeta.latitude) || 0,
          longitude: parseFloat(mMeta.longitude) || 0,
          leaderName: null, location: null,
          isEstablished: false, healthScore: 0, status: m.status.toLowerCase(),
          roles: m.roles, metadata: {},
        })
      }
    } catch { /* ignored */ }
  }

  // G0: User's own orgs + their members
  for (const org of userOrgs) {
    await addOrgToHierarchy(org.address, org.name, org.description, 0, null)
  }

  // G1+: Walk ALLIANCE edges from user orgs to find child orgs
  const parentMap = new Map<string, string>() // child → parent
  async function walkChildren(orgAddr: string, gen: number) {
    try {
      const edgeIds = await getEdgesBySubject(orgAddr as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        const childAddr = edge.object_.toLowerCase()
        if (seenHierarchy.has(childAddr)) continue
        parentMap.set(childAddr, orgAddr.toLowerCase())
        const childMeta = await getAgentMetadata(edge.object_)
        await addOrgToHierarchy(edge.object_, childMeta.displayName, childMeta.description, gen + 1, orgAddr.toLowerCase())
        // Recurse into children
        await walkChildren(edge.object_, gen + 1)
      }
    } catch { /* ignored */ }
  }

  for (const org of userOrgs) {
    await walkChildren(org.address, 0)
  }

  // Sort by generation, then by kind (orgs first within each gen)
  hierarchyNodes.sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation
    if (a.kind === 'org' && b.kind !== 'org') return -1
    if (a.kind !== 'org' && b.kind === 'org') return 1
    return a.name.localeCompare(b.name)
  })

  // Use first org for graph scoping
  const primaryOrg = userOrgs[0]

  // ─── Map tab: ALL agents with geo + relationship edges ─────────────
  type MapAgentData = { address: string; name: string; type: 'person' | 'org' | 'ai'; latitude: number; longitude: number; generation?: number; isEstablished?: boolean }
  const mapAgents: MapAgentData[] = []
  const seenMapAddrs = new Set<string>()

  // Collect ALL unique addresses involved in relationships + hierarchy
  const allMapAddresses = new Set<string>()
  for (const org of userOrgs) allMapAddresses.add(org.address.toLowerCase())
  for (const n of hierarchyNodes) allMapAddresses.add(n.address.toLowerCase())
  for (const rel of relationships) allMapAddresses.add(rel.counterpartyAddr.toLowerCase())

  // Check each address for geo data via resolver metadata
  for (const addr of allMapAddresses) {
    if (seenMapAddrs.has(addr)) continue
    try {
      const meta = await getAgentMetadata(addr)
      const lat = parseFloat(meta.latitude) || 0
      const lon = parseFloat(meta.longitude) || 0
      if (lat === 0 && lon === 0) continue
      seenMapAddrs.add(addr)
      const kind = await getAgentKind(addr)
      if (kind === 'hub') continue // skip hub agents from map
      mapAgents.push({
        address: addr, name: meta.displayName,
        type: kind === 'org' ? 'org' : kind === 'ai' ? 'ai' : 'person',
        latitude: lat, longitude: lon,
      })
    } catch { /* ignored */ }
  }

  // Build map edges from on-chain relationships where both endpoints have geo
  type MapEdgeData = { sourceAddr: string; targetAddr: string; roles: string[]; relationshipType: string; status: string; edgeId: string }
  const mapEdges: MapEdgeData[] = []
  for (const rel of relationships) {
    // Determine actual source/target addresses from the edge
    let sourceAddr: string
    let targetAddr: string
    if (rel.direction === 'outgoing') {
      const org = userOrgs.find(o => o.name === rel.orgName)
      sourceAddr = org?.address ?? ''
      targetAddr = rel.counterpartyAddr
    } else {
      sourceAddr = rel.counterpartyAddr
      const org = userOrgs.find(o => o.name === rel.orgName)
      targetAddr = org?.address ?? ''
    }
    if (!seenMapAddrs.has(sourceAddr.toLowerCase()) || !seenMapAddrs.has(targetAddr.toLowerCase())) continue
    mapEdges.push({
      sourceAddr, targetAddr,
      roles: rel.roles, relationshipType: rel.type,
      status: rel.status, edgeId: rel.edgeId,
    })
  }

  // Build map content
  let mapContent: React.ReactNode
  if (mapAgents.length === 0) {
    mapContent = <p data-component="text-muted">No agents with location data.</p>
  } else {
    const { NetworkMapView } = await import('@/components/graph/NetworkMapView')
    mapContent = <NetworkMapView agents={mapAgents} edges={mapEdges} />
  }

  // ─── Hierarchy tab content ───────────────────────────────────────────
  let hierarchyContent: React.ReactNode
  if (hierarchyNodes.length === 0) {
    hierarchyContent = <p data-component="text-muted">No agents in hierarchy.</p>
  } else {
    const { HierarchyView } = await import('@/components/graph/HierarchyView')
    const hierarchyData = hierarchyNodes.map(n => ({
      address: n.address, name: n.name, description: n.description,
      kind: n.kind, parentAddress: n.parentAddress, depth: n.generation,
      roles: n.roles, isEstablished: n.isEstablished,
      leaderName: n.leaderName, location: n.location, metadata: n.metadata,
    }))
    hierarchyContent = <HierarchyView agents={hierarchyData} />
  }

  return (
    <div data-page="network">
      <div data-component="page-header">
        <h1>Network</h1>
        <p>Trust graph, relationships, and connected organizations.</p>
      </div>
      <Suspense fallback={<p>Loading...</p>}>
        <NetworkTabs
          stats={{ total: relationships.length, outgoing: outgoing.length, incoming: incoming.length }}
          labels={{ network: 'Network', lineage: 'Lineage' }}
        >
          {{
            graph: <TrustGraphView orgAddress={primaryOrg?.address} />,

            map: mapContent,

            hierarchy: hierarchyContent,

            relationships: (
              <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                {relationships.length === 0 ? (
                  <p data-component="text-muted">No relationships yet.</p>
                ) : (
                  <>
                    {outgoing.length > 0 && (
                      <section data-component="graph-section">
                        <h2>Outgoing ({outgoing.length})</h2>
                        <div data-component="network-card-grid">
                          {outgoing.map(r => (
                            <div key={r.edgeId} data-component="network-rel-card">
                              <div data-component="network-rel-head">
                                <div>
                                  <Link href={`/agents/${r.counterpartyAddr}`} data-component="network-rel-title">{r.counterparty}</Link>
                                  <div data-component="network-rel-meta">
                                    <span data-component="role-badge">{r.type}</span>
                                    <span data-component="role-badge" data-status={r.status === 'Active' ? 'active' : r.status === 'Proposed' ? 'proposed' : 'revoked'}>{r.status}</span>
                                    <span style={{ fontSize: '0.65rem', color: '#616161' }}>{r.orgName}</span>
                                  </div>
                                </div>
                              </div>
                              <div data-component="network-rel-meta">
                                {r.roles.map(role => <span key={role} data-component="role-badge">{role}</span>)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    {incoming.length > 0 && (
                      <section data-component="graph-section">
                        <h2>Incoming ({incoming.length})</h2>
                        <div data-component="network-card-grid">
                          {incoming.map(r => (
                            <div key={r.edgeId} data-component="network-rel-card">
                              <div data-component="network-rel-head">
                                <div>
                                  <Link href={`/agents/${r.counterpartyAddr}`} data-component="network-rel-title">{r.counterparty}</Link>
                                  <div data-component="network-rel-meta">
                                    <span data-component="role-badge">{r.type}</span>
                                    <span data-component="role-badge" data-status={r.status === 'Active' ? 'active' : r.status === 'Proposed' ? 'proposed' : 'revoked'}>{r.status}</span>
                                    <span style={{ fontSize: '0.65rem', color: '#616161' }}>{r.orgName}</span>
                                  </div>
                                </div>
                              </div>
                              <div data-component="network-rel-meta">
                                {r.roles.map(role => <span key={role} data-component="role-badge">{role}</span>)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}
              </div>
            ),

            endorsements: (
              <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                {(() => {
                  const received = incoming.filter(r => r.type === 'Validation')
                  const given = outgoing.filter(r => r.type === 'Validation')
                  return received.length === 0 && given.length === 0 ? (
                    <p data-component="text-muted">No endorsements or accreditations.</p>
                  ) : (
                    <>
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
                    </>
                  )
                })()}
              </div>
            ),
          }}
        </NetworkTabs>
      </Suspense>
    </div>
  )
}
