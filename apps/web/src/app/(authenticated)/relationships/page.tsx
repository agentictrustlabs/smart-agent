import { redirect } from 'next/navigation'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, toDidEthr } from '@smart-agent/sdk'
import { RelationshipsClient } from './RelationshipsClient'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const STATUS_LABELS = ['none', 'proposed', 'active', 'suspended', 'revoked']

export default async function RelationshipsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const personAgents = await db
    .select()
    .from(schema.personAgents)
    .where(eq(schema.personAgents.userId, currentUser.id))
    .limit(1)

  const orgAgents = await db
    .select()
    .from(schema.orgAgents)
    .where(eq(schema.orgAgents.createdBy, currentUser.id))
    .orderBy(schema.orgAgents.createdAt)

  const personAgent = personAgents[0]

  if (!personAgent) {
    return (
      <div data-page="relationships">
        <div data-component="page-header">
          <h1>Trust Graph</h1>
          <p>Create on-chain relationships between agents</p>
        </div>
        <div data-component="empty-state">
          <p>Deploy a Person Agent first to create relationships.</p>
          <a href="/deploy/person">Deploy Person Agent</a>
        </div>
      </div>
    )
  }

  if (orgAgents.length === 0) {
    return (
      <div data-page="relationships">
        <div data-component="page-header">
          <h1>Trust Graph</h1>
          <p>Create on-chain relationships between agents</p>
        </div>
        <div data-component="empty-state">
          <p>Deploy an Organization Agent to create relationships.</p>
          <a href="/deploy/org">Deploy Org Agent</a>
        </div>
      </div>
    )
  }

  // Fetch all existing edges from on-chain for each org
  type EdgeView = {
    edgeId: string
    subject: string
    subjectDid: string
    roles: string[]
    status: string
    orgName: string
  }

  const existingEdges: EdgeView[] = []

  for (const org of orgAgents) {
    try {
      const edgeIds = await getEdgesByObject(org.smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const e = await getEdge(edgeId)
        const roleHashes = await getEdgeRoles(edgeId)
        existingEdges.push({
          edgeId: edgeId.slice(0, 18) + '...',
          subject: e.subject,
          subjectDid: toDidEthr(CHAIN_ID, e.subject),
          roles: roleHashes.map((r) => roleName(r)),
          status: STATUS_LABELS[e.status] ?? 'unknown',
          orgName: org.name,
        })
      }
    } catch {
      // contracts may not be accessible
    }
  }

  return (
    <div data-page="relationships">
      <div data-component="page-header">
        <h1>Trust Graph</h1>
        <p>On-chain relationships between agent accounts (did:ethr)</p>
      </div>

      {/* Protocol info */}
      <div data-component="protocol-info">
        <h3>Protocol Contracts</h3>
        <dl>
          <dt>AgentRelationship</dt>
          <dd data-component="address">{process.env.AGENT_RELATIONSHIP_ADDRESS}</dd>
          <dt>AgentAssertion</dt>
          <dd data-component="address">{process.env.AGENT_ASSERTION_ADDRESS}</dd>
          <dt>AgentRelationshipResolver</dt>
          <dd data-component="address">{process.env.AGENT_RESOLVER_ADDRESS}</dd>
        </dl>
      </div>

      {/* Existing edges */}
      {existingEdges.length > 0 && (
        <section data-component="graph-section">
          <h2>Active Relationships ({existingEdges.length})</h2>
          <table data-component="graph-table">
            <thead>
              <tr>
                <th>Subject (Agent)</th>
                <th>Roles</th>
                <th>Object (Org)</th>
                <th>Edge Status</th>
                <th>Edge ID</th>
              </tr>
            </thead>
            <tbody>
              {existingEdges.map((e, i) => (
                <tr key={i}>
                  <td>
                    <code data-component="address">{e.subject.slice(0, 8)}...{e.subject.slice(-4)}</code>
                  </td>
                  <td data-component="role-list">
                    {e.roles.map((r, j) => (
                      <span key={j} data-component="role-badge">{r}</span>
                    ))}
                  </td>
                  <td>{e.orgName}</td>
                  <td><span data-component="role-badge" data-status={e.status}>{e.status}</span></td>
                  <td><code data-component="edge-id">{e.edgeId}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Create new relationship */}
      <RelationshipsClient
        personAgent={{
          address: personAgent.smartAccountAddress,
          did: toDidEthr(CHAIN_ID, personAgent.smartAccountAddress as `0x${string}`),
          label: 'Person Agent',
        }}
        orgAgents={orgAgents.map((o) => ({
          address: o.smartAccountAddress,
          did: toDidEthr(CHAIN_ID, o.smartAccountAddress as `0x${string}`),
          label: o.name,
        }))}
      />
    </div>
  )
}
