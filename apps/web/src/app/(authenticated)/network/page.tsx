import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getEdgesBySubject, getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, relationshipTypeName } from '@smart-agent/sdk'
import { buildAgentNameMap, getNameFromMap } from '@/lib/agent-metadata'
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
          counterpartyAddr: edge.object_, type: relationshipTypeName(edge.relationshipType),
          roles: roles.map(r => roleName(r)), status: STATUS_NAMES[edge.status] ?? 'Unknown',
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
          counterpartyAddr: edge.subject, type: relationshipTypeName(edge.relationshipType),
          roles: roles.map(r => roleName(r)), status: STATUS_NAMES[edge.status] ?? 'Unknown',
          orgName: org.name,
        })
      }
    } catch { /* ignored */ }
  }

  const outgoing = relationships.filter(r => r.direction === 'outgoing')
  const incoming = relationships.filter(r => r.direction === 'incoming')

  // GenMap + GeoMap content
  let genMapContent: React.ReactNode = <p data-component="text-muted">No connected organizations to map.</p>
  if (userOrgs.length > 0) {
    const { getConnectedOrgs } = await import('@/lib/get-org-members')
    const allConnected: Array<{ address: string; name: string; description: string }> = []
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

    if (allConnected.length > 0) {
      const { GeoMapView } = await import('@/components/graph/GeoMapView')
      const { getAgentMetadata } = await import('@/lib/agent-metadata')

      const geoAgents = await Promise.all(allConnected.map(async org => {
        const meta = await getAgentMetadata(org.address)
        return {
          address: org.address, name: meta.displayName,
          latitude: parseFloat(meta.latitude) || 0, longitude: parseFloat(meta.longitude) || 0,
          generation: 0, isEstablished: false, healthScore: 0, status: 'active',
        }
      }))
      const validGeo = geoAgents.filter(a => a.latitude !== 0 && a.longitude !== 0)

      genMapContent = (
        <div>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: '#616161' }}>{allConnected.length} connected organizations</span>
            {validGeo.length > 0 && <span style={{ fontSize: '0.85rem', color: '#616161' }}>{validGeo.length} with coordinates</span>}
          </div>
          {validGeo.length > 0 ? (
            <GeoMapView agents={validGeo} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
              {allConnected.map(org => (
                <div key={org.address} data-component="protocol-info" style={{ padding: '0.75rem' }}>
                  <Link href={`/agents/${org.address}`} style={{ fontWeight: 600, color: '#1565c0' }}>{org.name}</Link>
                  <p style={{ fontSize: '0.75rem', color: '#616161', margin: '0.25rem 0 0' }}>{org.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }
  }

  // Use first org for graph scoping
  const primaryOrg = userOrgs[0]

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

            genmap: genMapContent,

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
