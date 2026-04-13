import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, toDidEthr } from '@smart-agent/sdk'
import { getConnectedOrgs } from '@/lib/get-org-members'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function AgentsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const { getPersonAgentForUser, getAiAgentsForOrg } = await import('@/lib/agent-registry')

  // Person agent
  const personAgentAddr = await getPersonAgentForUser(currentUser.id)
  let personAgent: { address: string; name: string } | null = null
  if (personAgentAddr) {
    const meta = await getAgentMetadata(personAgentAddr)
    personAgent = { address: personAgentAddr, name: meta.displayName }
  }

  // All user orgs
  const userOrgs = await getUserOrgs(currentUser.id)

  // Aggregate members, connected orgs, AI agents across all orgs
  type MemberAgent = { address: string; name: string; roles: string[]; orgName: string }
  const memberAgents: MemberAgent[] = []
  const seenMembers = new Set<string>()

  type ConnectedOrg = { address: string; name: string; description: string }
  const allConnected: ConnectedOrg[] = []
  const seenConnected = new Set<string>()
  const userOrgAddrs = new Set(userOrgs.map(o => o.address.toLowerCase()))

  type AiAgent = { address: string; name: string; description: string; agentType: string; orgName: string }
  const allAiAgents: AiAgent[] = []

  for (const org of userOrgs) {
    // Members (person agents with edges to this org)
    try {
      const edgeIds = await getEdgesByObject(org.address as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        const key = edge.subject.toLowerCase()
        if (seenMembers.has(key) || key === personAgentAddr?.toLowerCase()) continue
        // Check if it's a person agent (not org)
        const { getAgentKind } = await import('@/lib/agent-registry')
        const kind = await getAgentKind(edge.subject)
        if (kind !== 'person') continue
        seenMembers.add(key)
        const roles = (await getEdgeRoles(edgeId)).map(r => roleName(r))
        const meta = await getAgentMetadata(edge.subject)
        memberAgents.push({ address: edge.subject, name: meta.displayName, roles, orgName: org.name })
      }
    } catch { /* ignored */ }

    // Connected orgs (ALLIANCE edges)
    try {
      const connected = await getConnectedOrgs(org.address)
      for (const c of connected) {
        const key = c.address.toLowerCase()
        if (seenConnected.has(key) || userOrgAddrs.has(key)) continue
        seenConnected.add(key)
        allConnected.push({ address: c.address, name: c.name, description: c.description })
      }
    } catch { /* ignored */ }

    // AI agents
    const aiAddrs = await getAiAgentsForOrg(org.address)
    for (const addr of aiAddrs) {
      const meta = await getAgentMetadata(addr)
      allAiAgents.push({ address: addr, name: meta.displayName, description: meta.description, agentType: meta.aiAgentClass || 'custom', orgName: org.name })
    }
  }

  return (
    <div data-page="agents">
      <div data-component="page-header">
        <div data-component="section-header">
          <h1>Agents</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link href="/deploy/ai" data-component="section-action">+ AI Agent</Link>
            <Link href="/deploy/org" data-component="section-action">+ Organization</Link>
          </div>
        </div>
        <p>All agents you are associated with. Click an agent to view its trust profile, metadata, and relationships.</p>
      </div>

      {/* Your Person Agent */}
      {personAgent && (
        <section data-component="graph-section">
          <h2>Your Agent</h2>
          <div data-component="agent-grid">
            <div data-component="agent-card" data-status="deployed">
              <div data-component="agent-card-header">
                <h3>{personAgent.name}</h3>
                <span data-component="role-badge" data-status="active">Person</span>
              </div>
              <dl>
                <dt>Address</dt>
                <dd data-component="address">{personAgent.address}</dd>
                <dt>DID</dt>
                <dd style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>{toDidEthr(CHAIN_ID, personAgent.address as `0x${string}`)}</dd>
              </dl>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Link href={`/agents/${personAgent.address}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                <Link href={`/agents/${personAgent.address}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Your Organizations */}
      {userOrgs.length > 0 && (
        <section data-component="graph-section">
          <h2>Your Organizations ({userOrgs.length})</h2>
          <div data-component="agent-grid">
            {userOrgs.map(org => (
              <div key={org.address} data-component="agent-card" data-status="deployed">
                <div data-component="agent-card-header">
                  <h3>{org.name}</h3>
                  <span data-component="role-badge" data-status="active">Organization</span>
                </div>
                {org.description && <p data-component="card-description">{org.description}</p>}
                <div style={{ marginBottom: '0.5rem' }}>
                  {org.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}
                </div>
                <dl>
                  <dt>Address</dt>
                  <dd data-component="address">{org.address}</dd>
                </dl>
                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <Link href={`/agents/${org.address}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                  <Link href={`/agents/${org.address}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Members across all orgs */}
      {memberAgents.length > 0 && (
        <section data-component="graph-section">
          <h2>Members ({memberAgents.length})</h2>
          <div data-component="agent-grid">
            {memberAgents.map(agent => (
              <div key={agent.address} data-component="agent-card" data-status="deployed">
                <div data-component="agent-card-header">
                  <h3>{agent.name}</h3>
                  <span data-component="role-badge" data-status="active">Person</span>
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  {agent.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}
                  <span style={{ fontSize: '0.7rem', color: '#616161' }}>{agent.orgName}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <Link href={`/agents/${agent.address}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Connected Organizations */}
      {allConnected.length > 0 && (
        <section data-component="graph-section">
          <h2>Connected Organizations ({allConnected.length})</h2>
          <div data-component="agent-grid">
            {allConnected.map(org => (
              <div key={org.address} data-component="agent-card" data-status="deployed">
                <div data-component="agent-card-header">
                  <Link href={`/agents/${org.address}`} style={{ color: '#1565c0', fontWeight: 700 }}>{org.name}</Link>
                </div>
                {org.description && <p data-component="card-description">{org.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* AI Agents */}
      <section data-component="graph-section">
        <div data-component="section-header">
          <h2>AI Agents ({allAiAgents.length})</h2>
          <Link href="/deploy/ai" data-component="section-action">+ Deploy Agent</Link>
        </div>
        {allAiAgents.length === 0 ? (
          <p data-component="text-muted">No AI agents.</p>
        ) : (
          <div data-component="agent-grid">
            {allAiAgents.map(agent => (
              <div key={agent.address} data-component="agent-card" data-status="deployed">
                <div data-component="agent-card-header">
                  <h3>{agent.name}</h3>
                  <span data-component="role-badge">{agent.agentType}</span>
                </div>
                {agent.description && <p data-component="card-description">{agent.description}</p>}
                <span style={{ fontSize: '0.7rem', color: '#616161' }}>{agent.orgName}</span>
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <Link href={`/agents/${agent.address}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                  <Link href={`/agents/${agent.address}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
