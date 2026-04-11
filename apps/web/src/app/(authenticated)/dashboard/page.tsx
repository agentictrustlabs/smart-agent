import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getEdgesByObject, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, toDidEthr, ROLE_OWNER } from '@smart-agent/sdk'
import { getAgentMetadata, buildAgentNameMap, getNameFromMap, type AgentMetadata } from '@/lib/agent-metadata'
import { getSelectedOrg } from '@/lib/get-selected-org'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

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

  // Get AI agents
  const aiAgents = await db.select().from(schema.aiAgents)
    .where(eq(schema.aiAgents.createdBy, currentUser.id))
    .orderBy(schema.aiAgents.createdAt)

  // Load resolver metadata for all user agents
  const agentMeta = new Map<string, AgentMetadata>()
  const allAgentAddrs = [
    ...(personAgent ? [personAgent.smartAccountAddress] : []),
    ...orgAgents.map(o => o.smartAccountAddress),
    ...aiAgents.map(a => a.smartAccountAddress),
  ]
  for (const addr of allAgentAddrs) {
    try { agentMeta.set(addr.toLowerCase(), await getAgentMetadata(addr)) } catch {}
  }

  // Build name lookup for edges
  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(nameMap, a)

  // Fetch relationship edges for each org
  type EdgeView = { subject: string; subjectName: string; roles: string[]; status: string }
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
          subjectName: getName(e.subject),
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
        <h1>{selectedOrg ? selectedOrg.name : 'Dashboard'}</h1>
        <p>Welcome, {currentUser.name}{selectedOrg ? ` — managing ${selectedOrg.name}` : ''}</p>
      </div>

      {/* No org = show getting started */}
      {!selectedOrg && !personAgent && (
        <div data-component="empty-state" style={{ textAlign: 'center', padding: '3rem' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Welcome</h2>
          <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
            Get started by creating your organization or joining an existing one.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <Link href="/setup"><button>New Organization</button></Link>
            <Link href="/setup/join"><button style={{ background: '#e5e7eb', color: '#1a1a2e' }}>Join Organization</button></Link>
            <Link href="/deploy/person"><button style={{ background: 'transparent', border: '1px solid #e2e4e8', color: '#1a1a2e' }}>Create Personal Account</button></Link>
          </div>
        </div>
      )}

      <section data-component="agent-section">
        <h2>Person Agent (Your 4337 Account)</h2>
        {personAgent ? (
          <div data-component="agent-card" data-status={personAgent.status}>
            <div data-component="agent-card-header">
              <h3>{agentMeta.get(personAgent.smartAccountAddress.toLowerCase())?.displayName ?? personAgent.name ?? 'Person Agent'}</h3>
              {agentMeta.get(personAgent.smartAccountAddress.toLowerCase())?.isResolverRegistered && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>on-chain</span>}
              <Link href={`/agents/${personAgent.smartAccountAddress}`} data-component="settings-link">View</Link>
              <Link href={`/agents/${personAgent.smartAccountAddress}/metadata`} data-component="settings-link">Metadata</Link>
            </div>
            <dl>
              <dt>Smart Account</dt>
              <dd data-component="address">{personAgent.smartAccountAddress}</dd>
              <dt>DID</dt>
              <dd data-component="did">{toDidEthr(CHAIN_ID, personAgent.smartAccountAddress as `0x${string}`)}</dd>
              <dt>Status</dt>
              <dd data-status={personAgent.status}>{personAgent.status}</dd>
            </dl>
            {agentMeta.get(personAgent.smartAccountAddress.toLowerCase())?.capabilities?.length ? (
              <div style={{ marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Capabilities: </span>
                {agentMeta.get(personAgent.smartAccountAddress.toLowerCase())!.capabilities.map(c => <span key={c} data-component="role-badge" style={{ fontSize: '0.65rem', marginRight: 2 }}>{c}</span>)}
              </div>
            ) : null}
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
            {orgsWithEdges.map((org) => {
              const om = agentMeta.get(org.smartAccountAddress.toLowerCase())
              return (
              <div key={org.id} data-component="agent-card" data-status={org.status}>
                <div data-component="agent-card-header">
                  <h3>{om?.displayName ?? org.name}</h3>
                  {om?.isResolverRegistered && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>on-chain</span>}
                  <Link href={`/agents/${org.smartAccountAddress}`} data-component="settings-link">View</Link>
                  <Link href={`/agents/${org.smartAccountAddress}/metadata`} data-component="settings-link">Metadata</Link>
                </div>
                <p data-component="card-description">{om?.description || org.description || ''}</p>
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
                              {e.subjectName}
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
              )
            })}
          </div>
        ) : (
          <div data-component="empty-state">
            <p>No organization agents deployed yet.</p>
            <a href="/deploy/org">Deploy Org Agent</a>
          </div>
        )}
      </section>

      <section data-component="agent-section">
        <div data-component="section-header">
          <h2>AI Agents</h2>
          <Link href="/deploy/ai" data-component="section-action">+ New AI Agent</Link>
        </div>
        {aiAgents.length > 0 ? (
          <div data-component="agent-grid">
            {aiAgents.map((agent) => {
              const am = agentMeta.get(agent.smartAccountAddress.toLowerCase())
              return (
              <div key={agent.id} data-component="agent-card" data-status={agent.status}>
                <div data-component="agent-card-header">
                  <h3>{am?.displayName ?? agent.name}</h3>
                  <span data-component="role-badge">{am?.aiAgentClass || agent.agentType}</span>
                  {am?.isResolverRegistered && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>on-chain</span>}
                  <Link href={`/agents/${agent.smartAccountAddress}`} data-component="settings-link">View</Link>
                  <Link href={`/agents/${agent.smartAccountAddress}/metadata`} data-component="settings-link">Metadata</Link>
                </div>
                <p data-component="card-description">{am?.description || agent.description || ''}</p>
                <dl>
                  <dt>Smart Account</dt>
                  <dd data-component="address">{agent.smartAccountAddress}</dd>
                  <dt>DID</dt>
                  <dd data-component="did">{toDidEthr(CHAIN_ID, agent.smartAccountAddress as `0x${string}`)}</dd>
                  <dt>Status</dt>
                  <dd data-status={agent.status}>{agent.status}</dd>
                </dl>
                {am?.capabilities && am.capabilities.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Capabilities: </span>
                    {am.capabilities.map(c => <span key={c} data-component="role-badge" style={{ fontSize: '0.65rem', marginRight: 2 }}>{c}</span>)}
                  </div>
                )}
                {am?.trustModels && am.trustModels.length > 0 && (
                  <div style={{ marginTop: '0.25rem' }}>
                    <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Trust: </span>
                    {am.trustModels.map(t => <span key={t} data-component="role-badge" data-status="active" style={{ fontSize: '0.65rem', marginRight: 2 }}>{t}</span>)}
                  </div>
                )}
                {(am?.a2aEndpoint || am?.mcpServer) && (
                  <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: '#666' }}>
                    {am?.a2aEndpoint && <span>A2A: {am.a2aEndpoint} </span>}
                    {am?.mcpServer && <span>MCP: {am.mcpServer}</span>}
                  </div>
                )}
              </div>
              )
            })}
          </div>
        ) : (
          <div data-component="empty-state">
            <p>No AI agents deployed yet.</p>
            <a href="/deploy/ai">Deploy AI Agent</a>
          </div>
        )}
      </section>
    </div>
  )
}
