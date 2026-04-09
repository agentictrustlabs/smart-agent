import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, toDidEthr } from '@smart-agent/sdk'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function DashboardPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const personAgents = await db
    .select()
    .from(schema.personAgents)
    .where(eq(schema.personAgents.userId, currentUser.id))
    .limit(1)

  const personAgent = personAgents[0]

  const orgAgents = await db
    .select()
    .from(schema.orgAgents)
    .where(eq(schema.orgAgents.createdBy, currentUser.id))
    .orderBy(schema.orgAgents.createdAt)

  // Fetch relationship edges for each org
  type EdgeView = { subject: string; roles: string[]; status: string }
  type OrgWithEdges = (typeof orgAgents)[number] & { edges: EdgeView[] }

  const orgsWithEdges: OrgWithEdges[] = []

  for (const org of orgAgents) {
    const edges: EdgeView[] = []
    try {
      const edgeIds = await getEdgesByObject(org.smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const e = await getEdge(edgeId)
        const roleHashes = await getEdgeRoles(edgeId)
        const statusLabels = ['none', 'proposed', 'active', 'suspended', 'revoked']
        edges.push({
          subject: e.subject,
          roles: roleHashes.map((r) => roleName(r)),
          status: statusLabels[e.status] ?? 'unknown',
        })
      }
    } catch {
      // Contracts may not be deployed
    }
    orgsWithEdges.push({ ...org, edges })
  }

  return (
    <div data-page="dashboard">
      <div data-component="page-header">
        <h1>Agent Dashboard</h1>
        <p>Welcome, {currentUser.name}</p>
        <p data-component="wallet-address">
          EOA: {currentUser.walletAddress.slice(0, 6)}...{currentUser.walletAddress.slice(-4)}
        </p>
      </div>

      <section data-component="agent-section">
        <h2>Person Agent (Your 4337 Account)</h2>
        {personAgent ? (
          <div data-component="agent-card" data-status={personAgent.status}>
            <dl>
              <dt>Smart Account</dt>
              <dd data-component="address">{personAgent.smartAccountAddress}</dd>
              <dt>DID</dt>
              <dd data-component="did">{toDidEthr(CHAIN_ID, personAgent.smartAccountAddress as `0x${string}`)}</dd>
              <dt>Chain</dt>
              <dd>{personAgent.chainId === 11155111 ? 'Sepolia' : personAgent.chainId === 31337 ? 'Anvil (Local)' : `Chain ${personAgent.chainId}`}</dd>
              <dt>Status</dt>
              <dd data-status={personAgent.status}>{personAgent.status}</dd>
            </dl>
          </div>
        ) : (
          <div data-component="empty-state">
            <p>No person agent deployed yet.</p>
            <a href="/deploy/person">Deploy Person Agent</a>
          </div>
        )}
      </section>

      <section data-component="agent-section">
        <div data-component="section-header">
          <h2>Organization Agents</h2>
          <Link href="/deploy/org" data-component="section-action">+ New Org</Link>
        </div>
        {orgsWithEdges.length > 0 ? (
          <div data-component="agent-grid">
            {orgsWithEdges.map((org) => (
              <div key={org.id} data-component="agent-card" data-status={org.status}>
                <h3>{org.name}</h3>
                {org.description && <p data-component="card-description">{org.description}</p>}
                <dl>
                  <dt>Smart Account</dt>
                  <dd data-component="address">{org.smartAccountAddress}</dd>
                  <dt>DID</dt>
                  <dd data-component="did">{toDidEthr(CHAIN_ID, org.smartAccountAddress as `0x${string}`)}</dd>
                  <dt>Status</dt>
                  <dd data-status={org.status}>{org.status}</dd>
                </dl>

                {org.edges.length > 0 ? (
                  <div data-component="assertions-section">
                    <h4>Relationships</h4>
                    <table data-component="assertions-table">
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Roles</th>
                          <th>Edge Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {org.edges.map((e, i) => (
                          <tr key={i}>
                            <td data-component="address">
                              {e.subject.slice(0, 6)}...{e.subject.slice(-4)}
                            </td>
                            <td data-component="role-list">
                              {e.roles.map((r, j) => (
                                <span key={j} data-component="role-badge">{r}</span>
                              ))}
                            </td>
                            <td>
                              <span data-component="role-badge" data-status={e.status}>{e.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div data-component="no-assertions">
                    <p>No relationships yet</p>
                    <Link href="/relationships">Add Relationship</Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div data-component="empty-state">
            <p>No organization agents deployed yet.</p>
            <a href="/deploy/org">Deploy Org Agent</a>
          </div>
        )}
      </section>
    </div>
  )
}
