import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { getPublicClient, getEdgesBySubject, getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
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

  return (
    <div data-page="network">
      <div data-component="page-header">
        <div data-component="section-header">
          <h1>Network{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
          <Link href="/relationships" data-component="section-action">+ Add Relationship</Link>
        </div>
        <p>Trust graph, organizational relationships, endorsements, and partnerships</p>
      </div>

      <Suspense fallback={<p>Loading...</p>}>
        <NetworkTabs>
          {{
            graph: <TrustGraphView />,

            relationships: (
              <div>
                {!selectedOrg ? (
                  <p data-component="text-muted">Select or create an organization to see relationships.</p>
                ) : relationships.length === 0 ? (
                  <p data-component="text-muted">No relationships yet. <Link href="/relationships" style={{ color: '#2563eb' }}>Create your first relationship</Link>.</p>
                ) : (
                  <>
                    {/* Outgoing: This org → others */}
                    {outgoing.length > 0 && (
                      <section data-component="graph-section">
                        <h2>{selectedOrg.name} → Others ({outgoing.length})</h2>
                        <table data-component="graph-table">
                          <thead><tr><th>To</th><th>Type</th><th>Roles</th><th>Status</th></tr></thead>
                          <tbody>
                            {outgoing.map(r => (
                              <tr key={r.edgeId}>
                                <td><Link href={`/agents/${r.counterpartyAddr}`} style={{ color: '#2563eb' }}>{r.counterparty}</Link></td>
                                <td><span data-component="role-badge">{r.type}</span></td>
                                <td>{r.roles.map(role => <span key={role} data-component="role-badge" style={{ marginRight: 4 }}>{role}</span>)}</td>
                                <td><span data-component="role-badge" data-status={r.status === 'Active' ? 'active' : r.status === 'Proposed' ? 'proposed' : 'revoked'}>{r.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    )}

                    {/* Incoming: Others → this org */}
                    {incoming.length > 0 && (
                      <section data-component="graph-section">
                        <h2>Others → {selectedOrg.name} ({incoming.length})</h2>
                        <table data-component="graph-table">
                          <thead><tr><th>From</th><th>Type</th><th>Roles</th><th>Status</th></tr></thead>
                          <tbody>
                            {incoming.map(r => (
                              <tr key={r.edgeId}>
                                <td><Link href={`/agents/${r.counterpartyAddr}`} style={{ color: '#2563eb' }}>{r.counterparty}</Link></td>
                                <td><span data-component="role-badge">{r.type}</span></td>
                                <td>{r.roles.map(role => <span key={role} data-component="role-badge" style={{ marginRight: 4 }}>{role}</span>)}</td>
                                <td><span data-component="role-badge" data-status={r.status === 'Active' ? 'active' : r.status === 'Proposed' ? 'proposed' : 'revoked'}>{r.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
                    {/* Endorsements received (validation edges where org is object) */}
                    {(() => {
                      const endorsements = incoming.filter(r => r.type === 'Validation')
                      return endorsements.length === 0 ? (
                        <p data-component="text-muted">No endorsements or accreditations received.</p>
                      ) : (
                        <section data-component="graph-section">
                          <h2>Endorsements Received ({endorsements.length})</h2>
                          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
                            Organizations that have endorsed, accredited, or validated {selectedOrg.name}.
                          </p>
                          <div style={{ display: 'grid', gap: '0.75rem' }}>
                            {endorsements.map(e => (
                              <div key={e.edgeId} data-component="protocol-info">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <Link href={`/agents/${e.counterpartyAddr}`} style={{ color: '#2563eb', fontWeight: 600 }}>{e.counterparty}</Link>
                                  <span data-component="role-badge" data-status={e.status === 'Active' ? 'active' : 'proposed'}>{e.status}</span>
                                  {e.roles.map(r => <span key={r} data-component="role-badge">{r}</span>)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )
                    })()}

                    {/* Endorsements given (validation edges where org is subject) */}
                    {(() => {
                      const given = outgoing.filter(r => r.type === 'Validation')
                      return given.length === 0 ? null : (
                        <section data-component="graph-section" style={{ marginTop: '1.5rem' }}>
                          <h2>Endorsements Given ({given.length})</h2>
                          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
                            Organizations that {selectedOrg.name} has endorsed or accredited.
                          </p>
                          <div style={{ display: 'grid', gap: '0.75rem' }}>
                            {given.map(e => (
                              <div key={e.edgeId} data-component="protocol-info">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <Link href={`/agents/${e.counterpartyAddr}`} style={{ color: '#2563eb', fontWeight: 600 }}>{e.counterparty}</Link>
                                  <span data-component="role-badge" data-status={e.status === 'Active' ? 'active' : 'proposed'}>{e.status}</span>
                                  {e.roles.map(r => <span key={r} data-component="role-badge">{r}</span>)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )
                    })()}
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
