import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, toDidEthr } from '@smart-agent/sdk'
import { getConnectedOrgs } from '@/lib/get-org-members'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  // Person agent for this user (always shown)
  const personAgents = await db.select().from(schema.personAgents)
    .where(eq(schema.personAgents.userId, currentUser.id))
  const personAgent = personAgents[0]

  // AI agents operated by selected org
  const allAI = await db.select().from(schema.aiAgents)
  const orgAiAgents = selectedOrg
    ? allAI.filter(a => a.operatedBy?.toLowerCase() === selectedOrg.smartAccountAddress.toLowerCase())
    : allAI.filter(a => a.createdBy === currentUser.id)

  // Circle org agents connected to this org (via ALLIANCE edges)
  const connectedOrgs = selectedOrg ? await getConnectedOrgs(selectedOrg.smartAccountAddress) : []

  // Org members (person agents with edges to this org)
  const allPersonAgents = await db.select().from(schema.personAgents)
  const personAddrs = new Set(allPersonAgents.map(p => p.smartAccountAddress.toLowerCase()))

  type MemberAgent = { address: string; name: string; roles: string[] }
  const memberAgents: MemberAgent[] = []

  if (selectedOrg) {
    try {
      const edgeIds = await getEdgesByObject(selectedOrg.smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        if (!personAddrs.has(edge.subject.toLowerCase())) continue
        const roles = await getEdgeRoles(edgeId)
        const existing = memberAgents.find(m => m.address.toLowerCase() === edge.subject.toLowerCase())
        const newRoles = roles.map(r => roleName(r))
        if (existing) {
          for (const r of newRoles) { if (!existing.roles.includes(r)) existing.roles.push(r) }
        } else {
          const pa = allPersonAgents.find(p => p.smartAccountAddress.toLowerCase() === edge.subject.toLowerCase())
          memberAgents.push({ address: edge.subject, name: (pa as Record<string, unknown>)?.name as string || edge.subject.slice(0, 10), roles: newRoles })
        }
      }
    } catch { /* ignored */ }
  }

  // Load metadata for all displayed agents
  const allAddrs = [
    ...(personAgent ? [personAgent.smartAccountAddress] : []),
    ...(selectedOrg ? [selectedOrg.smartAccountAddress] : []),
    ...orgAiAgents.map(a => a.smartAccountAddress),
    ...memberAgents.map(m => m.address),
  ]

  const metaEntries = await Promise.all(
    allAddrs.map(async (addr) => {
      try { return await getAgentMetadata(addr) } catch { return null }
    })
  )
  const metaMap = new Map(metaEntries.filter(Boolean).map(m => [m!.address.toLowerCase(), m!]))

  return (
    <div data-page="agents">
      <div data-component="page-header">
        <div data-component="section-header">
          <h1>Agents{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link href="/deploy/ai" data-component="section-action">+ AI Agent</Link>
            <Link href="/deploy/org" data-component="section-action">+ Organization</Link>
          </div>
        </div>
        <p>All agents associated with {selectedOrg ? selectedOrg.name : 'your account'}. Click an agent to view its trust profile, metadata, and relationships.</p>
      </div>

      {/* Your Person Agent */}
      {personAgent && (
        <section data-component="graph-section">
          <h2>Your Agent</h2>
          <div data-component="agent-grid">
            {(() => {
              const m = metaMap.get(personAgent.smartAccountAddress.toLowerCase())
              return (
                <div data-component="agent-card" data-status="deployed">
                  <div data-component="agent-card-header">
                    <h3>{m?.displayName ?? personAgent.name ?? 'Person Agent'}</h3>
                    <span data-component="role-badge" data-status="active">Person</span>
                    {m?.isResolverRegistered && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>on-chain</span>}
                  </div>
                  <dl>
                    <dt>Address</dt>
                    <dd data-component="address">{personAgent.smartAccountAddress}</dd>
                  </dl>
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <Link href={`/agents/${personAgent.smartAccountAddress}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                    <Link href={`/agents/${personAgent.smartAccountAddress}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                  </div>
                </div>
              )
            })()}
          </div>
        </section>
      )}

      {/* Organization Agent */}
      {selectedOrg && (
        <section data-component="graph-section">
          <h2>Organization</h2>
          <div data-component="agent-grid">
            {(() => {
              const m = metaMap.get(selectedOrg.smartAccountAddress.toLowerCase())
              return (
                <div data-component="agent-card" data-status="deployed">
                  <div data-component="agent-card-header">
                    <h3>{m?.displayName ?? selectedOrg.name}</h3>
                    <span data-component="role-badge" data-status="active">Organization</span>
                    {m?.isResolverRegistered && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>on-chain</span>}
                  </div>
                  {(m?.description || selectedOrg.description) && (
                    <p data-component="card-description">{m?.description || selectedOrg.description}</p>
                  )}
                  <dl>
                    <dt>Address</dt>
                    <dd data-component="address">{selectedOrg.smartAccountAddress}</dd>
                    <dt>DID</dt>
                    <dd style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>{toDidEthr(CHAIN_ID, selectedOrg.smartAccountAddress as `0x${string}`)}</dd>
                  </dl>
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <Link href={`/agents/${selectedOrg.smartAccountAddress}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                    <Link href={`/agents/${selectedOrg.smartAccountAddress}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                  </div>
                </div>
              )
            })()}
          </div>
        </section>
      )}

      {/* Member Agents */}
      {memberAgents.length > 0 && (
        <section data-component="graph-section">
          <h2>Members ({memberAgents.length})</h2>
          <div data-component="agent-grid">
            {memberAgents.map((agent) => {
              const m = metaMap.get(agent.address.toLowerCase())
              return (
                <div key={agent.address} data-component="agent-card" data-status="deployed">
                  <div data-component="agent-card-header">
                    <h3>{m?.displayName ?? agent.name}</h3>
                    <span data-component="role-badge" data-status="active">Person</span>
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    {agent.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}
                  </div>
                  <dl>
                    <dt>Address</dt>
                    <dd data-component="address">{agent.address}</dd>
                  </dl>
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <Link href={`/agents/${agent.address}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                    <Link href={`/agents/${agent.address}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Connected Organizations (groups, hubs, etc. via ALLIANCE relationships) */}
      {connectedOrgs.length > 0 && (
        <section data-component="graph-section">
          <div data-component="section-header">
            <h2>Connected Organizations ({connectedOrgs.length})</h2>
          </div>
          <div data-component="agent-grid">
            {connectedOrgs.map((circle) => {
              const health = circle.metadata as Record<string, unknown> | null
              const isEstablished = health?.isChurch === true
              const gen = typeof health?.generation === 'number' ? health.generation : null
              return (
                <div key={circle.address} data-component="agent-card" data-status="deployed">
                  <div data-component="agent-card-header">
                    <Link href={`/agents/${circle.address}`} style={{ color: '#1565c0', fontWeight: 700 }}>{circle.name}</Link>
                    {gen !== null && <span data-component="role-badge" style={{ fontSize: '0.6rem' }}>G{gen}</span>}
                    <span data-component="role-badge" data-status={isEstablished ? 'active' : 'proposed'} style={{ fontSize: '0.55rem' }}>
                      {isEstablished ? 'established' : 'group'}
                    </span>
                  </div>
                  {circle.description && <p data-component="card-description">{circle.description}</p>}
                  {health && (
                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.7rem', color: '#616161', marginTop: '0.35rem' }}>
                      {typeof health.attenders === 'number' && <span><strong style={{ color: '#1565c0' }}>{health.attenders}</strong> att</span>}
                      {typeof health.believers === 'number' && <span><strong style={{ color: '#ea580c' }}>{health.believers}</strong> blvr</span>}
                      {typeof health.baptized === 'number' && <span><strong style={{ color: '#2e7d32' }}>{health.baptized}</strong> bap</span>}
                      {typeof health.leaders === 'number' && <span><strong style={{ color: '#7c3aed' }}>{health.leaders}</strong> ldr</span>}
                      {typeof health.leaderName === 'string' && <span>Led by {health.leaderName}</span>}
                    </div>
                  )}
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <Link href={`/agents/${circle.address}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                    <Link href={`/agents/${circle.address}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                    <Link href={`/network?org=${circle.address}`} style={{ color: '#1565c0' }}>Relationships</Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* AI Agents */}
      <section data-component="graph-section">
        <div data-component="section-header">
          <h2>AI Agents ({orgAiAgents.length})</h2>
          <Link href="/deploy/ai" data-component="section-action">+ Deploy Agent</Link>
        </div>
        {orgAiAgents.length === 0 ? (
          <p data-component="text-muted">No AI agents{selectedOrg ? ` for ${selectedOrg.name}` : ''}.</p>
        ) : (
          <div data-component="agent-grid">
            {orgAiAgents.map((agent) => {
              const m = metaMap.get(agent.smartAccountAddress.toLowerCase())
              return (
                <div key={agent.smartAccountAddress} data-component="agent-card" data-status="deployed">
                  <div data-component="agent-card-header">
                    <h3>{m?.displayName ?? agent.name}</h3>
                    <span data-component="role-badge">{m?.aiAgentClass || agent.agentType}</span>
                    {m?.isResolverRegistered && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>on-chain</span>}
                  </div>
                  {(m?.description || agent.description) && (
                    <p data-component="card-description">{m?.description || agent.description}</p>
                  )}
                  {m?.capabilities && m.capabilities.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      {m.capabilities.map(c => <span key={c} data-component="role-badge" style={{ fontSize: '0.6rem', marginRight: 2 }}>{c}</span>)}
                    </div>
                  )}
                  <dl>
                    <dt>Address</dt>
                    <dd data-component="address">{agent.smartAccountAddress}</dd>
                  </dl>
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <Link href={`/agents/${agent.smartAccountAddress}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                    <Link href={`/agents/${agent.smartAccountAddress}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                    {m?.a2aEndpoint && <Link href={`/agents/${agent.smartAccountAddress}/communicate`} style={{ color: '#1565c0' }}>Communicate</Link>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
