import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { toDidEthr } from '@smart-agent/sdk'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function AgentsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // Load all agents the user has access to
  const personAgents = await db.select().from(schema.personAgents)
    .where(eq(schema.personAgents.userId, currentUser.id))
  const orgAgents = await db.select().from(schema.orgAgents)
    .where(eq(schema.orgAgents.createdBy, currentUser.id))
  const aiAgents = await db.select().from(schema.aiAgents)
    .where(eq(schema.aiAgents.createdBy, currentUser.id))

  // Load resolver metadata for all
  const allAddrs = [
    ...personAgents.map(a => a.smartAccountAddress),
    ...orgAgents.map(a => a.smartAccountAddress),
    ...aiAgents.map(a => a.smartAccountAddress),
  ]

  const metaEntries = await Promise.all(
    allAddrs.map(async (addr) => {
      try { return await getAgentMetadata(addr) } catch { return null }
    })
  )
  const metaMap = new Map(metaEntries.filter(Boolean).map(m => [m!.address.toLowerCase(), m!]))

  const agents = allAddrs.map((addr) => {
    const m = metaMap.get(addr.toLowerCase())
    return {
      address: addr,
      name: m?.displayName ?? addr.slice(0, 10),
      type: m?.agentType ?? 'unknown',
      typeLabel: m?.agentTypeLabel ?? 'Unknown',
      aiClass: m?.aiAgentClass ?? '',
      description: m?.description ?? '',
      capabilities: m?.capabilities ?? [],
      trustModels: m?.trustModels ?? [],
      isResolverRegistered: m?.isResolverRegistered ?? false,
      a2aEndpoint: m?.a2aEndpoint ?? '',
    }
  })

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
        <p>All agents you own or operate. Click an agent to view its trust profile, metadata, and relationships.</p>
      </div>

      {agents.length === 0 ? (
        <div data-component="empty-state">
          <p>No agents deployed yet.</p>
          <Link href="/setup">Create Organization</Link> or <Link href="/deploy/person">Deploy Person Agent</Link>
        </div>
      ) : (
        <div data-component="agent-grid">
          {agents.map((agent) => (
            <div key={agent.address} data-component="agent-card" data-status="deployed">
              <div data-component="agent-card-header">
                <h3>{agent.name}</h3>
                <span data-component="role-badge" data-status="active">{agent.typeLabel}</span>
                {agent.aiClass && <span data-component="role-badge">{agent.aiClass}</span>}
                {agent.isResolverRegistered && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>on-chain</span>}
              </div>

              {agent.description && (
                <p data-component="card-description">{agent.description}</p>
              )}

              <dl>
                <dt>Address</dt>
                <dd data-component="address">{agent.address}</dd>
                <dt>DID</dt>
                <dd style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>{toDidEthr(CHAIN_ID, agent.address as `0x${string}`)}</dd>
              </dl>

              {agent.capabilities.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  {agent.capabilities.map(c => <span key={c} data-component="role-badge" style={{ fontSize: '0.6rem', marginRight: 2 }}>{c}</span>)}
                </div>
              )}

              {agent.trustModels.length > 0 && (
                <div style={{ marginTop: '0.25rem' }}>
                  {agent.trustModels.map(t => <span key={t} data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem', marginRight: 2 }}>{t}</span>)}
                </div>
              )}

              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Link href={`/agents/${agent.address}`} style={{ color: '#2563eb' }}>Trust Profile</Link>
                <Link href={`/agents/${agent.address}/metadata`} style={{ color: '#2563eb' }}>Metadata</Link>
                {agent.a2aEndpoint && <Link href={`/agents/${agent.address}/communicate`} style={{ color: '#2563eb' }}>Communicate</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
