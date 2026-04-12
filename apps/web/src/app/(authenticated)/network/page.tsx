import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { getEdgesBySubject, getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, relationshipTypeName } from '@smart-agent/sdk'
import { buildAgentNameMap, getNameFromMap } from '@/lib/agent-metadata'
import { TrustGraphView } from '@/components/graph/TrustGraphView'
import { NetworkTabs } from './NetworkTabs'
import { buildDefaultAgentContexts, getHubIdForTemplate, getHubProfile } from '@/lib/hub-profiles'

const STATUS_NAMES = ['None', 'Proposed', 'Confirmed', 'Active', 'Suspended', 'Revoked', 'Rejected']

export default async function NetworkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(nameMap, a)

  type RelView = { edgeId: string; direction: string; counterparty: string; counterpartyAddr: string; type: string; roles: string[]; status: string }
  const relationships: RelView[] = []

  if (selectedOrg) {
    try {
      for (const edgeId of await getEdgesBySubject(selectedOrg.smartAccountAddress as `0x${string}`)) {
        const edge = await getEdge(edgeId)
        const roles = await getEdgeRoles(edgeId)
        relationships.push({
          edgeId, direction: 'outgoing', counterparty: getName(edge.object_),
          counterpartyAddr: edge.object_, type: relationshipTypeName(edge.relationshipType),
          roles: roles.map(r => roleName(r)), status: STATUS_NAMES[edge.status] ?? 'Unknown',
        })
      }
      for (const edgeId of await getEdgesByObject(selectedOrg.smartAccountAddress as `0x${string}`)) {
        const edge = await getEdge(edgeId)
        const roles = await getEdgeRoles(edgeId)
        relationships.push({
          edgeId, direction: 'incoming', counterparty: getName(edge.subject),
          counterpartyAddr: edge.subject, type: relationshipTypeName(edge.relationshipType),
          roles: roles.map(r => roleName(r)), status: STATUS_NAMES[edge.status] ?? 'Unknown',
        })
      }
    } catch { /* ignored */ }
  }

  const outgoing = relationships.filter(r => r.direction === 'outgoing')
  const incoming = relationships.filter(r => r.direction === 'incoming')
  const hubId = getHubIdForTemplate(selectedOrg?.templateId)
  const hubProfile = getHubProfile(hubId)

  // Gen Map content — import dynamically to avoid circular deps
  let genMapContent: React.ReactNode = <p data-component="text-muted">Select an organization to view the generational map.</p>
  let activeContextName = selectedOrg?.name ?? hubProfile.networkLabel
  let activeContextDescription = selectedOrg
    ? `${hubProfile.name} portal onto ${selectedOrg.name}.`
    : 'Select an organization to view network context.'
  if (selectedOrg) {
    const { getConnectedOrgs } = await import('@/lib/get-org-members')
    const connectedOrgs = await getConnectedOrgs(selectedOrg.smartAccountAddress)
    const contexts = buildDefaultAgentContexts({
      orgAddress: selectedOrg.smartAccountAddress,
      orgName: selectedOrg.name,
      orgDescription: selectedOrg.description,
      hubId,
      capabilities: ['network', 'agents', 'reviews', ...(connectedOrgs.length > 0 ? ['genmap', 'activities', 'members'] : [])],
      aiAgentCount: 0,
    })
    const requestedContextId = typeof params.context === 'string' ? params.context : undefined
    const activeContext = contexts.find(context => context.id === requestedContextId)
      ?? contexts.find(context => context.isDefault)
      ?? contexts[0]
      ?? null
    if (activeContext) {
      activeContextName = activeContext.name
      activeContextDescription = activeContext.description
    }
    if (connectedOrgs.length > 0) {
      const { GeoMapView } = await import('@/components/graph/GeoMapView')
      const { getAgentMetadata } = await import('@/lib/agent-metadata')

      // Build geo agents for map
      const geoAgents = await Promise.all(connectedOrgs.map(async org => {
        const meta = await getAgentMetadata(org.address)
        return {
          address: org.address,
          name: meta.displayName,
          latitude: parseFloat(meta.latitude) || 0,
          longitude: parseFloat(meta.longitude) || 0,
          generation: 0,
          isEstablished: false,
          healthScore: 0,
          status: 'active',
        }
      }))
      const validGeo = geoAgents.filter(a => a.latitude !== 0 && a.longitude !== 0)

      genMapContent = (
        <div>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: '#616161' }}>{connectedOrgs.length} connected organizations</span>
            {validGeo.length > 0 && <span style={{ fontSize: '0.85rem', color: '#616161' }}>{validGeo.length} with coordinates</span>}
          </div>
          {validGeo.length > 0 ? (
            <GeoMapView agents={validGeo} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
              {connectedOrgs.map(org => (
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

  return (
    <div data-page="network">
      <div data-component="page-header">
        <h1>{activeContextName}</h1>
        <p>{activeContextDescription}</p>
      </div>
      <Suspense fallback={<p>Loading...</p>}>
        <NetworkTabs
          stats={{ total: relationships.length, outgoing: outgoing.length, incoming: incoming.length }}
          labels={{ network: hubProfile.networkLabel, lineage: hubProfile.lineageLabel }}
        >
          {{
            graph: <TrustGraphView />,

            genmap: genMapContent,

            relationships: (
              <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                {!selectedOrg ? (
                  <p data-component="text-muted">Select an organization to see relationships.</p>
                ) : relationships.length === 0 ? (
                  <p data-component="text-muted">No relationships yet.</p>
                ) : (
                  <>
                    {outgoing.length > 0 && (
                      <section data-component="graph-section">
                        <h2>{selectedOrg.name} → Others ({outgoing.length})</h2>
                        <div data-component="network-card-grid">
                          {outgoing.map(r => (
                            <div key={r.edgeId} data-component="network-rel-card">
                              <div data-component="network-rel-head">
                                <div>
                                  <Link href={`/agents/${r.counterpartyAddr}`} data-component="network-rel-title">{r.counterparty}</Link>
                                  <div data-component="network-rel-meta">
                                    <span data-component="role-badge">{r.type}</span>
                                    <span data-component="role-badge" data-status={r.status === 'Active' ? 'active' : r.status === 'Proposed' ? 'proposed' : 'revoked'}>{r.status}</span>
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
                        <h2>Others → {selectedOrg.name} ({incoming.length})</h2>
                        <div data-component="network-card-grid">
                          {incoming.map(r => (
                            <div key={r.edgeId} data-component="network-rel-card">
                              <div data-component="network-rel-head">
                                <div>
                                  <Link href={`/agents/${r.counterpartyAddr}`} data-component="network-rel-title">{r.counterparty}</Link>
                                  <div data-component="network-rel-meta">
                                    <span data-component="role-badge">{r.type}</span>
                                    <span data-component="role-badge" data-status={r.status === 'Active' ? 'active' : r.status === 'Proposed' ? 'proposed' : 'revoked'}>{r.status}</span>
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
                {!selectedOrg ? (
                  <p data-component="text-muted">Select an organization to see endorsements.</p>
                ) : (() => {
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
