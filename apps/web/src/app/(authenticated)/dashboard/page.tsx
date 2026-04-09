import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db, schema } from '@/db'
import { eq, inArray } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getEdgesByObject, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, toDidEthr, ORGANIZATION_GOVERNANCE, ROLE_OWNER } from '@smart-agent/sdk'

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

  // Get orgs created by user
  const createdOrgs = await db
    .select()
    .from(schema.orgAgents)
    .where(eq(schema.orgAgents.createdBy, currentUser.id))
    .orderBy(schema.orgAgents.createdAt)

  // Also find orgs where user has an ownership relationship via trust graph
  const additionalOrgAddresses: string[] = []
  if (personAgent) {
    try {
      const edgeIds = await getEdgesBySubject(personAgent.smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const e = await getEdge(edgeId)
        const roles = await getEdgeRoles(edgeId)
        // Check if this is an ownership edge to an org
        if (roles.some((r) => r === ROLE_OWNER) && e.status >= 2) { // CONFIRMED or ACTIVE
          const addr = e.object_.toLowerCase()
          if (!createdOrgs.some((o) => o.smartAccountAddress.toLowerCase() === addr)) {
            additionalOrgAddresses.push(e.object_)
          }
        }
      }
    } catch { /* contracts may not be deployed */ }
  }

  // Fetch additional orgs from DB
  let additionalOrgs: typeof createdOrgs = []
  if (additionalOrgAddresses.length > 0) {
    const allOrgs = await db.select().from(schema.orgAgents)
    additionalOrgs = allOrgs.filter((o) =>
      additionalOrgAddresses.some((a) => a.toLowerCase() === o.smartAccountAddress.toLowerCase())
    )
  }

  const orgAgents = [...createdOrgs, ...additionalOrgs]

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
        const statusLabels = ['none', 'proposed', 'confirmed', 'active', 'suspended', 'revoked', 'rejected']
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
            <div data-component="agent-card-header">
              <h3>{(personAgent as Record<string, unknown>).name as string || 'Person Agent'}</h3>
              <Link href={`/agents/${personAgent.smartAccountAddress}`} data-component="settings-link">Settings</Link>
            </div>
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
                <div data-component="agent-card-header">
                  <h3>{org.name}</h3>
                  <Link href={`/agents/${org.smartAccountAddress}`} data-component="settings-link">Settings</Link>
                </div>
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
