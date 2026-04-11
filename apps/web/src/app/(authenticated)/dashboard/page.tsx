import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getEdgesByObject, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, toDidEthr } from '@smart-agent/sdk'
import { getAgentMetadata, buildAgentNameMap, getNameFromMap, type AgentMetadata } from '@/lib/agent-metadata'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { getOrgTemplate } from '@/lib/org-templates.data'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  const personAgents = await db.select().from(schema.personAgents)
    .where(eq(schema.personAgents.userId, currentUser.id)).limit(1)
  const personAgent = personAgents[0]

  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(nameMap, a)

  // Load data scoped to selected org
  type MemberView = { name: string; address: string; roles: string[]; status: string }
  type PartnerView = { name: string; address: string; roles: string[]; status: string; type: string }
  const members: MemberView[] = []
  const partners: PartnerView[] = []

  const allPersonAgents = await db.select().from(schema.personAgents)
  const personAddrs = new Set(allPersonAgents.map(p => p.smartAccountAddress.toLowerCase()))

  const allAI = await db.select().from(schema.aiAgents)
  const aiAgents = selectedOrg
    ? allAI.filter(a => a.operatedBy?.toLowerCase() === selectedOrg.smartAccountAddress.toLowerCase())
    : []

  const STATUS_NAMES = ['None', 'Proposed', 'Confirmed', 'Active', 'Suspended', 'Revoked', 'Rejected']

  if (selectedOrg) {
    try {
      // Incoming edges (others → this org)
      for (const edgeId of await getEdgesByObject(selectedOrg.smartAccountAddress as `0x${string}`)) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        const roles = await getEdgeRoles(edgeId)
        const roleNames = roles.map(r => roleName(r))

        if (personAddrs.has(edge.subject.toLowerCase())) {
          const existing = members.find(m => m.address.toLowerCase() === edge.subject.toLowerCase())
          if (existing) {
            for (const r of roleNames) { if (!existing.roles.includes(r)) existing.roles.push(r) }
          } else {
            members.push({
              name: getName(edge.subject), address: edge.subject,
              roles: roleNames, status: STATUS_NAMES[edge.status] ?? 'Unknown',
            })
          }
        } else {
          const existing = partners.find(p => p.address.toLowerCase() === edge.subject.toLowerCase())
          if (existing) {
            for (const r of roleNames) { if (!existing.roles.includes(r)) existing.roles.push(r) }
          } else {
            partners.push({
              name: getName(edge.subject), address: edge.subject,
              roles: roleNames, status: STATUS_NAMES[edge.status] ?? 'Unknown', type: 'incoming',
            })
          }
        }
      }

      // Outgoing edges (this org → others)
      for (const edgeId of await getEdgesBySubject(selectedOrg.smartAccountAddress as `0x${string}`)) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        const roles = await getEdgeRoles(edgeId)
        const roleNames = roles.map(r => roleName(r))
        const existing = partners.find(p => p.address.toLowerCase() === edge.object_.toLowerCase())
        if (existing) {
          for (const r of roleNames) { if (!existing.roles.includes(r)) existing.roles.push(r) }
        } else {
          partners.push({
            name: getName(edge.object_), address: edge.object_,
            roles: roleNames, status: STATUS_NAMES[edge.status] ?? 'Unknown', type: 'outgoing',
          })
        }
      }
    } catch {}
  }

  const template = selectedOrg ? getOrgTemplate((selectedOrg as Record<string, unknown>).templateId as string ?? '') : null

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
          <p style={{ color: '#616161', marginBottom: '1.5rem' }}>
            Get started by creating your organization or joining an existing one.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <Link href="/setup"><button>New Organization</button></Link>
            <Link href="/setup/join"><button style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Join Organization</button></Link>
            <Link href="/deploy/person"><button style={{ background: 'transparent', border: '1px solid #e2e4e8', color: '#1a1a2e' }}>Create Personal Account</button></Link>
          </div>
        </div>
      )}

      {selectedOrg && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div data-component="protocol-info" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1565c0' }}>{members.length}</div>
              <div style={{ fontSize: '0.8rem', color: '#616161' }}>Members</div>
            </div>
            <div data-component="protocol-info" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0d9488' }}>{partners.length}</div>
              <div style={{ fontSize: '0.8rem', color: '#616161' }}>Relationships</div>
            </div>
            <div data-component="protocol-info" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#7c3aed' }}>{aiAgents.length}</div>
              <div style={{ fontSize: '0.8rem', color: '#616161' }}>AI Agents</div>
            </div>
            <div data-component="protocol-info" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#ea580c' }}>{template?.name ?? 'Custom'}</div>
              <div style={{ fontSize: '0.8rem', color: '#616161' }}>Template</div>
            </div>
          </div>

          {/* Quick Links */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <Link href={`/team?org=${selectedOrg.smartAccountAddress}`} style={{ color: '#1565c0', fontSize: '0.85rem' }}>Manage Team</Link>
            <Link href={`/agents?org=${selectedOrg.smartAccountAddress}`} style={{ color: '#1565c0', fontSize: '0.85rem' }}>View Agents</Link>
            <Link href={`/network?org=${selectedOrg.smartAccountAddress}`} style={{ color: '#1565c0', fontSize: '0.85rem' }}>Trust Network</Link>
            <Link href={`/treasury?org=${selectedOrg.smartAccountAddress}`} style={{ color: '#1565c0', fontSize: '0.85rem' }}>Treasury</Link>
            <Link href={`/reviews?org=${selectedOrg.smartAccountAddress}`} style={{ color: '#1565c0', fontSize: '0.85rem' }}>Reviews</Link>
          </div>

          {/* Members */}
          <section data-component="graph-section">
            <div data-component="section-header">
              <h2>Members ({members.length})</h2>
              <Link href={`/team?org=${selectedOrg.smartAccountAddress}`} data-component="section-action">Manage</Link>
            </div>
            {members.length === 0 ? (
              <p data-component="text-muted">No members yet. <Link href={`/team?org=${selectedOrg.smartAccountAddress}`} style={{ color: '#1565c0' }}>Invite people</Link>.</p>
            ) : (
              <table data-component="graph-table">
                <thead><tr><th>Name</th><th>Roles</th><th>Status</th></tr></thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.address}>
                      <td><Link href={`/agents/${m.address}`} style={{ color: '#1565c0' }}>{m.name}</Link></td>
                      <td>{m.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}</td>
                      <td><span data-component="role-badge" data-status={m.status === 'Active' ? 'active' : 'proposed'}>{m.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* AI Agents */}
          {aiAgents.length > 0 && (
            <section data-component="graph-section">
              <div data-component="section-header">
                <h2>AI Agents ({aiAgents.length})</h2>
                <Link href={`/agents?org=${selectedOrg.smartAccountAddress}`} data-component="section-action">View All</Link>
              </div>
              <div data-component="agent-grid">
                {aiAgents.map(agent => (
                  <div key={agent.id} data-component="agent-card" data-status={agent.status}>
                    <div data-component="agent-card-header">
                      <h3>{agent.name}</h3>
                      <span data-component="role-badge">{agent.agentType}</span>
                    </div>
                    {agent.description && <p data-component="card-description">{agent.description}</p>}
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                      <Link href={`/agents/${agent.smartAccountAddress}`} style={{ color: '#1565c0' }}>View</Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Partners & Relationships */}
          {partners.length > 0 && (
            <section data-component="graph-section">
              <div data-component="section-header">
                <h2>Relationships ({partners.length})</h2>
                <Link href={`/network?org=${selectedOrg.smartAccountAddress}`} data-component="section-action">Network</Link>
              </div>
              <table data-component="graph-table">
                <thead><tr><th>Entity</th><th>Roles</th><th>Status</th></tr></thead>
                <tbody>
                  {partners.map(p => (
                    <tr key={p.address}>
                      <td><Link href={`/agents/${p.address}`} style={{ color: '#1565c0' }}>{p.name}</Link></td>
                      <td>{p.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}</td>
                      <td><span data-component="role-badge" data-status={p.status === 'Active' ? 'active' : 'proposed'}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/* Person Agent (always shown) */}
      {personAgent && (
        <section data-component="graph-section">
          <h2>Your Agent</h2>
          <div data-component="protocol-info">
            <dl>
              <dt>Smart Account</dt>
              <dd data-component="address">{personAgent.smartAccountAddress}</dd>
              <dt>DID</dt>
              <dd data-component="did">{toDidEthr(CHAIN_ID, personAgent.smartAccountAddress as `0x${string}`)}</dd>
              <dt>Status</dt>
              <dd data-status={personAgent.status}>{personAgent.status}</dd>
            </dl>
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
              <Link href={`/agents/${personAgent.smartAccountAddress}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
              <Link href={`/agents/${personAgent.smartAccountAddress}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
