import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'

import { getPublicClient, getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { formatEther } from 'viem'
import { getAgentMetadata, buildAgentNameMap, getNameFromMap } from '@/lib/agent-metadata'
import { roleName } from '@smart-agent/sdk'
import { TreasuryClient } from './TreasuryClient'

export default async function TreasuryPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)
  const client = getPublicClient()
  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(nameMap, a)
  const { getAiAgentsForOrg } = await import('@/lib/agent-registry')

  type TreasuryView = {
    name: string; address: string; description: string
    balance: string; capabilities: string[]; trustModels: string[]
    orgName: string; orgAddress: string
  }
  type OrgTreasury = {
    orgName: string; orgAddress: string; orgBalance: string
    agents: TreasuryView[]
    treasurers: Array<{ name: string; address: string; roles: string[] }>
  }

  const orgTreasuries: OrgTreasury[] = []

  for (const org of userOrgs) {
    // Find AI treasury agents for this org
    const aiAddrs = await getAiAgentsForOrg(org.address)
    const agents: TreasuryView[] = []
    for (const addr of aiAddrs) {
      const meta = await getAgentMetadata(addr)
      if (!meta.displayName.toLowerCase().includes('treasury') && meta.aiAgentClass !== 'executor') continue
      const balance = await client.getBalance({ address: addr as `0x${string}` }).catch(() => 0n)
      agents.push({
        name: meta.displayName, address: addr, description: meta.description,
        balance: formatEther(balance), capabilities: meta.capabilities, trustModels: meta.trustModels,
        orgName: org.name, orgAddress: org.address,
      })
    }

    // Org balance
    const orgBal = await client.getBalance({ address: org.address as `0x${string}` }).catch(() => 0n)

    // Treasurers
    const treasurers: Array<{ name: string; address: string; roles: string[] }> = []
    try {
      const edgeIds = await getEdgesByObject(org.address as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 3) continue
        const roles = (await getEdgeRoles(edgeId)).map(r => roleName(r))
        if (roles.some(r => ['treasurer', 'authorized-signer', 'owner'].includes(r))) {
          treasurers.push({ name: getName(edge.subject), address: edge.subject, roles })
        }
      }
    } catch { /* ignored */ }

    if (agents.length > 0 || org.roles.some(r => ['owner', 'treasurer', 'authorized-signer'].includes(r.toLowerCase()))) {
      orgTreasuries.push({
        orgName: org.name, orgAddress: org.address,
        orgBalance: formatEther(orgBal), agents, treasurers,
      })
    }
  }

  return (
    <div data-page="treasury">
      <div data-component="page-header">
        <h1>Treasury</h1>
        <p>Treasury Agents are autonomous smart accounts that hold and manage funds within delegation bounds.</p>
      </div>

      {orgTreasuries.length === 0 ? (
        <div data-component="empty-state">
          <p>No treasury access. Treasury requires a treasurer, authorized-signer, or owner role.</p>
          <Link href="/deploy/ai"><button style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Deploy AI Agent</button></Link>
        </div>
      ) : (
        orgTreasuries.map(ot => (
          <div key={ot.orgAddress} style={{ marginBottom: '2rem' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Link href={`/agents/${ot.orgAddress}`} style={{ color: '#1565c0' }}>{ot.orgName}</Link>
            </h2>

            <div data-component="protocol-info" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#616161' }}>Treasury Balance</div>
                  <div style={{ fontSize: '2rem', fontWeight: 700, color: '#2e7d32' }}>
                    {ot.agents.reduce((s, t) => s + parseFloat(t.balance), 0).toFixed(4)} <span style={{ fontSize: '1rem', color: '#616161' }}>ETH</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#616161' }}>Organization Account</div>
                  <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1a1a2e' }}>
                    {parseFloat(ot.orgBalance).toFixed(4)} <span style={{ fontSize: '1rem', color: '#616161' }}>ETH</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#616161' }}>Authorized</div>
                  <div style={{ marginTop: '0.25rem' }}>
                    {ot.treasurers.length === 0 ? (
                      <span style={{ color: '#616161', fontSize: '0.85rem' }}>No one assigned</span>
                    ) : (
                      ot.treasurers.map(t => (
                        <div key={t.address} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.2rem' }}>
                          <Link href={`/agents/${t.address}`} style={{ color: '#1565c0', fontSize: '0.85rem' }}>{t.name}</Link>
                          {t.roles.filter(r => ['treasurer', 'authorized-signer'].includes(r)).map(r =>
                            <span key={r} data-component="role-badge" style={{ fontSize: '0.55rem' }}>{r}</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {ot.agents.map(t => (
              <section key={t.address} data-component="graph-section">
                <div data-component="protocol-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0 }}>{t.name}</h3>
                    <span data-component="role-badge" data-status="active">AI Agent</span>
                  </div>
                  {t.description && <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '0.5rem' }}>{t.description}</p>}
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#2e7d32' }}>
                    {parseFloat(t.balance).toFixed(4)} <span style={{ fontSize: '0.85rem', color: '#616161' }}>ETH</span>
                  </div>
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <Link href={`/agents/${t.address}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                    <Link href={`/agents/${t.address}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                  </div>
                </div>
                <div data-component="protocol-info" style={{ marginTop: '1rem' }}>
                  <h3>Fund {t.name}</h3>
                  <TreasuryClient targetAddress={t.address} targetName={t.name} />
                </div>
              </section>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
