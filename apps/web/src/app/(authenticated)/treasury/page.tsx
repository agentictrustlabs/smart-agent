import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { db, schema } from '@/db'

import { getPublicClient, getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { formatEther } from 'viem'
import { getAgentMetadata, buildAgentNameMap, getNameFromMap } from '@/lib/agent-metadata'
import { roleName } from '@smart-agent/sdk'
import { TreasuryClient } from './TreasuryClient'

export default async function TreasuryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  const client = getPublicClient()
  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(nameMap, a)

  // Find treasury agents for the selected org
  const allAI = await db.select().from(schema.aiAgents)
  const treasuryAgents = selectedOrg
    ? allAI.filter(a =>
        a.agentType === 'executor' &&
        a.name.toLowerCase().includes('treasury') &&
        a.operatedBy?.toLowerCase() === selectedOrg.smartAccountAddress.toLowerCase()
      )
    : []

  // Load balance and metadata
  type TreasuryView = {
    name: string; address: string; description: string
    balance: string; capabilities: string[]; trustModels: string[]
    orgName: string; orgAddress: string
  }
  const treasuryData: TreasuryView[] = []

  for (const agent of treasuryAgents) {
    const balance = await client.getBalance({ address: agent.smartAccountAddress as `0x${string}` }).catch(() => 0n)
    const meta = await getAgentMetadata(agent.smartAccountAddress)
    treasuryData.push({
      name: meta.displayName, address: agent.smartAccountAddress,
      description: meta.description || agent.description || '',
      balance: formatEther(balance),
      capabilities: meta.capabilities, trustModels: meta.trustModels,
      orgName: selectedOrg?.name ?? '', orgAddress: selectedOrg?.smartAccountAddress ?? '',
    })
  }

  // Org account balance
  let orgBalance = '0'
  if (selectedOrg) {
    const bal = await client.getBalance({ address: selectedOrg.smartAccountAddress as `0x${string}` }).catch(() => 0n)
    orgBalance = formatEther(bal)
  }

  // Find people with treasurer/signer roles
  const treasurers: Array<{ name: string; address: string; roles: string[] }> = []
  if (selectedOrg) {
    try {
      const personAddrs = new Set((await db.select().from(schema.personAgents)).map(p => p.smartAccountAddress.toLowerCase()))
      const edgeIds = await getEdgesByObject(selectedOrg.smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 3) continue
        if (!personAddrs.has(edge.subject.toLowerCase())) continue
        const roles = await getEdgeRoles(edgeId)
        const roleNames = roles.map(r => roleName(r))
        if (roleNames.includes('treasurer') || roleNames.includes('authorized-signer') || roleNames.includes('owner')) {
          const existing = treasurers.find(t => t.address.toLowerCase() === edge.subject.toLowerCase())
          if (existing) {
            for (const r of roleNames) { if (!existing.roles.includes(r)) existing.roles.push(r) }
          } else {
            treasurers.push({ name: getName(edge.subject), address: edge.subject, roles: roleNames })
          }
        }
      }
    } catch { /* ignored */ }
  }

  return (
    <div data-page="treasury">
      <div data-component="page-header">
        <h1>Treasury{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
        <p>Treasury Agents are autonomous smart accounts that hold and manage funds within delegation bounds.</p>
      </div>

      {!selectedOrg ? (
        <div data-component="empty-state">
          <p>Select or create an organization to manage treasury.</p>
          <Link href="/setup"><button>New Organization</button></Link>
        </div>
      ) : treasuryData.length === 0 ? (
        <div data-component="empty-state">
          <h3>No Treasury Agent</h3>
          <p>{selectedOrg.name} doesn&apos;t have a Treasury Agent.</p>
          <p style={{ fontSize: '0.85rem', color: '#616161', marginTop: '0.5rem' }}>
            Treasury Agents are included in Church, Grant Organization, Giving Intermediary, and Investment Club templates.
          </p>
          <div style={{ marginTop: '1rem' }}>
            <Link href="/deploy/ai"><button style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Deploy AI Agent</button></Link>
          </div>
        </div>
      ) : (
        <>
          {/* Summary Bar */}
          <div data-component="protocol-info" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: '#616161' }}>Treasury Balance</div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#2e7d32' }}>
                  {treasuryData.reduce((sum, t) => sum + parseFloat(t.balance), 0).toFixed(4)} <span style={{ fontSize: '1rem', color: '#616161' }}>ETH</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: '#616161' }}>Organization Account</div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1a1a2e' }}>
                  {parseFloat(orgBalance).toFixed(4)} <span style={{ fontSize: '1rem', color: '#616161' }}>ETH</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: '#616161' }}>Authorized to Manage</div>
                <div style={{ marginTop: '0.25rem' }}>
                  {treasurers.length === 0 ? (
                    <span style={{ color: '#616161', fontSize: '0.85rem' }}>No one assigned</span>
                  ) : (
                    treasurers.map(t => (
                      <div key={t.address} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.2rem' }}>
                        <Link href={`/agents/${t.address}`} style={{ color: '#1565c0', fontSize: '0.85rem' }}>{t.name}</Link>
                        {t.roles.filter(r => r === 'treasurer' || r === 'authorized-signer').map(r =>
                          <span key={r} data-component="role-badge" style={{ fontSize: '0.55rem' }}>{r}</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Treasury Agent Details */}
          {treasuryData.map(t => (
            <section key={t.address} data-component="graph-section">
              <div data-component="protocol-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <h2 style={{ margin: 0 }}>{t.name}</h2>
                  <span data-component="role-badge" data-status="active">AI Agent</span>
                  <span data-component="role-badge">executor</span>
                </div>

                {t.description && <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>{t.description}</p>}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: '#616161', marginBottom: '0.25rem' }}>Balance</div>
                    <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#2e7d32' }}>
                      {parseFloat(t.balance).toFixed(4)} <span style={{ fontSize: '1rem', color: '#616161' }}>ETH</span>
                    </div>
                  </div>
                  <dl>
                    <dt>Smart Account</dt>
                    <dd data-component="address">{t.address}</dd>
                    <dt>Controlled By</dt>
                    <dd>
                      <Link href={`/agents/${t.orgAddress}`} style={{ color: '#1565c0' }}>{t.orgName}</Link>
                      <span style={{ fontSize: '0.75rem', color: '#616161' }}> (via delegation)</span>
                    </dd>
                  </dl>
                </div>

                {/* Capabilities */}
                {t.capabilities.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <span style={{ fontSize: '0.7rem', color: '#616161' }}>Capabilities: </span>
                    {t.capabilities.map(c => <span key={c} data-component="role-badge" style={{ fontSize: '0.6rem', marginRight: 2 }}>{c}</span>)}
                  </div>
                )}

                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <Link href={`/agents/${t.address}`} style={{ color: '#1565c0' }}>Trust & Compliance</Link>
                  <Link href={`/agents/${t.address}/metadata`} style={{ color: '#1565c0' }}>Profile</Link>
                  <Link href={`/agents/${t.address}/communicate`} style={{ color: '#1565c0' }}>Chat</Link>
                </div>
              </div>

              {/* Delegation Bounds */}
              <div data-component="protocol-info" style={{ marginTop: '1rem' }}>
                <h3>Delegation Bounds</h3>
                <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '0.75rem' }}>
                  Operations within these bounds execute automatically.
                  Anything outside requires multi-sig approval.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem' }}>
                  {[
                    { label: 'Time Window', value: '30 days' },
                    { label: 'Per-Transaction Limit', value: '5 ETH' },
                    { label: 'Allowed Methods', value: 'transfer' },
                    { label: 'Allowed Targets', value: 'Approved list' },
                  ].map(b => (
                    <div key={b.label} style={{ padding: '0.5rem 0.75rem', background: '#fafafa', borderRadius: 6, border: '1px solid #e2e4e8' }}>
                      <div style={{ fontSize: '0.7rem', color: '#616161' }}>{b.label}</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1a1a2e' }}>{b.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fund */}
              <div data-component="protocol-info" style={{ marginTop: '1rem' }}>
                <h3>Fund {t.name}</h3>
                <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '0.75rem' }}>
                  Send ETH to this agent&apos;s smart account. Funds are held separately from the organization.
                </p>
                <TreasuryClient targetAddress={t.address} targetName={t.name} />
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
