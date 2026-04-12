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

const STATUS_NAMES = ['None', 'Proposed', 'Confirmed', 'Active', 'Suspended', 'Revoked', 'Rejected']

export default async function NetworkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(nameMap, a)

  // Load all relationships for the selected org
  type RelView = { edgeId: string; direction: string; counterparty: string; counterpartyAddr: string; type: string; roles: string[]; status: string }
  const relationships: RelView[] = []

  if (selectedOrg) {
    try {
      // Outgoing edges (org → others)
      for (const edgeId of await getEdgesBySubject(selectedOrg.smartAccountAddress as `0x${string}`)) {
        const edge = await getEdge(edgeId)
        const roles = await getEdgeRoles(edgeId)
        relationships.push({
          edgeId, direction: 'outgoing', counterparty: getName(edge.object_),
          counterpartyAddr: edge.object_, type: relationshipTypeName(edge.relationshipType),
          roles: roles.map(r => roleName(r)), status: STATUS_NAMES[edge.status] ?? 'Unknown',
        })
      }
      // Incoming edges (others → org)
      for (const edgeId of await getEdgesByObject(selectedOrg.smartAccountAddress as `0x${string}`)) {
        const edge = await getEdge(edgeId)
        const roles = await getEdgeRoles(edgeId)
        relationships.push({
          edgeId, direction: 'incoming', counterparty: getName(edge.subject),
          counterpartyAddr: edge.subject, type: relationshipTypeName(edge.relationshipType),
          roles: roles.map(r => roleName(r)), status: STATUS_NAMES[edge.status] ?? 'Unknown',
        })
      }
    } catch { /* contracts not deployed */ }

  }

  const outgoing = relationships.filter(r => r.direction === 'outgoing')
  const incoming = relationships.filter(r => r.direction === 'incoming')
  const endorsementsReceived = incoming.filter(r => r.type === 'Validation')
  const endorsementsGiven = outgoing.filter(r => r.type === 'Validation')
  const addRelationshipHref = selectedOrg
    ? `/relationships?org=${selectedOrg.smartAccountAddress}`
    : '/relationships'

  return (
    <div data-page="network">
      <div data-component="page-header">
        <div data-component="section-header">
          <h1>Network{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
          <Link href={addRelationshipHref} data-component="section-action">+ Add Relationship</Link>
        </div>
        <p>Trust graph, organizational relationships, endorsements, and partnerships</p>
      </div>

      {selectedOrg && (
        <div data-component="network-summary">
          <div data-component="network-summary-card">
            <div data-component="network-summary-value">{relationships.length}</div>
            <div data-component="network-summary-label">Total Relationships</div>
          </div>
          <div data-component="network-summary-card">
            <div data-component="network-summary-value">{outgoing.length}</div>
            <div data-component="network-summary-label">Outgoing</div>
          </div>
          <div data-component="network-summary-card">
            <div data-component="network-summary-value">{incoming.length}</div>
            <div data-component="network-summary-label">Incoming</div>
          </div>
          <div data-component="network-summary-card">
            <div data-component="network-summary-value">{endorsementsReceived.length + endorsementsGiven.length}</div>
            <div data-component="network-summary-label">Validation Edges</div>
          </div>
        </div>
      )}

      <Suspense fallback={<p>Loading...</p>}>
        <NetworkTabs>
          {{
            graph: <TrustGraphView />,

            relationships: (
              <div>
                {!selectedOrg ? (
                  <p data-component="text-muted">Select or create an organization to see relationships.</p>
                ) : relationships.length === 0 ? (
                  <p data-component="text-muted">No relationships yet. <Link href={addRelationshipHref}>Create your first relationship</Link>.</p>
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
                                <Link href={`/agents/${r.counterpartyAddr}`} data-component="section-action">Open</Link>
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
                                <Link href={`/agents/${r.counterpartyAddr}`} data-component="section-action">Open</Link>
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
              <div>
                {!selectedOrg ? (
                  <p data-component="text-muted">Select or create an organization to see endorsements.</p>
                ) : (
                  <>
                    {endorsementsReceived.length === 0 ? (
                      <p data-component="text-muted">No endorsements or accreditations received.</p>
                    ) : (
                      <section data-component="graph-section">
                        <h2>Endorsements Received ({endorsementsReceived.length})</h2>
                        <p data-component="text-muted">
                          Organizations that have endorsed, accredited, or validated {selectedOrg.name}.
                        </p>
                        <div data-component="network-card-grid">
                          {endorsementsReceived.map(e => (
                            <div key={e.edgeId} data-component="network-rel-card">
                              <div data-component="network-rel-head">
                                <div>
                                  <Link href={`/agents/${e.counterpartyAddr}`} data-component="network-rel-title">{e.counterparty}</Link>
                                  <div data-component="network-rel-meta">
                                    <span data-component="role-badge" data-status={e.status === 'Active' ? 'active' : 'proposed'}>{e.status}</span>
                                  </div>
                                </div>
                                <Link href={`/agents/${e.counterpartyAddr}`} data-component="section-action">Open</Link>
                              </div>
                              <div data-component="network-rel-meta">
                                {e.roles.map(r => <span key={r} data-component="role-badge">{r}</span>)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {endorsementsGiven.length > 0 && (
                      <section data-component="graph-section">
                        <h2>Endorsements Given ({endorsementsGiven.length})</h2>
                        <p data-component="text-muted">
                          Organizations that {selectedOrg.name} has endorsed or accredited.
                        </p>
                        <div data-component="network-card-grid">
                          {endorsementsGiven.map(e => (
                            <div key={e.edgeId} data-component="network-rel-card">
                              <div data-component="network-rel-head">
                                <div>
                                  <Link href={`/agents/${e.counterpartyAddr}`} data-component="network-rel-title">{e.counterparty}</Link>
                                  <div data-component="network-rel-meta">
                                    <span data-component="role-badge" data-status={e.status === 'Active' ? 'active' : 'proposed'}>{e.status}</span>
                                  </div>
                                </div>
                                <Link href={`/agents/${e.counterpartyAddr}`} data-component="section-action">Open</Link>
                              </div>
                              <div data-component="network-rel-meta">
                                {e.roles.map(r => <span key={r} data-component="role-badge">{r}</span>)}
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
          }}
        </NetworkTabs>
      </Suspense>
    </div>
  )
}
