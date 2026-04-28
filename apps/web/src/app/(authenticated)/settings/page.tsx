import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getPublicClient } from '@/lib/contracts'
import { agentControlAbi, agentIssuerProfileAbi } from '@smart-agent/sdk'
import { ORG_TEMPLATES } from '@/lib/org-templates.data'
import { SettingsTabs } from './SettingsTabs'
import { SessionsPanel } from './SessionsPanel'

export default async function SettingsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)
  // Only show admin for orgs where user has admin/owner roles
  const adminOrgs = userOrgs.filter(o =>
    o.roles.some(r => ['owner', 'admin', 'ceo'].includes(r.toLowerCase()))
  )

  const client = getPublicClient()
  const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`
  const issuerAddr = process.env.AGENT_ISSUER_ADDRESS as `0x${string}`

  // Load governance config for each admin org
  type OrgGov = {
    orgName: string; orgAddress: string
    initialized: boolean; minOwners: number; quorum: number; isBootstrap: boolean; owners: string[]
  }
  const orgGovs: OrgGov[] = []

  for (const org of adminOrgs) {
    const gov: OrgGov = { orgName: org.name, orgAddress: org.address, initialized: false, minOwners: 0, quorum: 0, isBootstrap: false, owners: [] }
    if (controlAddr) {
      try {
        gov.initialized = (await client.readContract({
          address: controlAddr, abi: agentControlAbi,
          functionName: 'isInitialized', args: [org.address as `0x${string}`],
        })) as boolean
        if (gov.initialized) {
          const cfg = (await client.readContract({
            address: controlAddr, abi: agentControlAbi,
            functionName: 'getConfig', args: [org.address as `0x${string}`],
          })) as { minOwners: bigint; quorum: bigint; isBootstrap: boolean }
          gov.minOwners = Number(cfg.minOwners)
          gov.quorum = Number(cfg.quorum)
          gov.isBootstrap = cfg.isBootstrap
          gov.owners = (await client.readContract({
            address: controlAddr, abi: agentControlAbi,
            functionName: 'getOwners', args: [org.address as `0x${string}`],
          })) as string[]
        }
      } catch { /* not deployed */ }
    }
    orgGovs.push(gov)
  }

  // Load issuers
  let issuerCount = 0
  const issuers: Array<{ address: string; name: string; description: string; active: boolean }> = []
  try {
    issuerCount = Number(await client.readContract({ address: issuerAddr, abi: agentIssuerProfileAbi, functionName: 'issuerCount' }) as bigint)
    for (let i = 0; i < Math.min(issuerCount, 20); i++) {
      const addr = (await client.readContract({ address: issuerAddr, abi: agentIssuerProfileAbi, functionName: 'getIssuerAt', args: [BigInt(i)] })) as `0x${string}`
      const profile = (await client.readContract({ address: issuerAddr, abi: agentIssuerProfileAbi, functionName: 'getProfile', args: [addr] })) as [string, `0x${string}`, string, string, string, bigint, boolean]
      issuers.push({ address: addr, name: profile[2], description: profile[3], active: profile[6] })
    }
  } catch { /* not deployed */ }

  return (
    <div data-page="settings">
      <div data-component="page-header">
        <h1>Administration</h1>
        <p>Organization configuration, templates, governance, and authority management</p>
      </div>

      <Suspense fallback={<p>Loading...</p>}>
        <SettingsTabs>
          {{
            templates: (
              <div>
                <h2>Organization Templates</h2>
                <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
                  Templates define governance structure, roles, and AI agents for each organization type.
                  Select a template when <Link href="/setup" style={{ color: '#1565c0' }}>creating a new organization</Link>.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  {ORG_TEMPLATES.map(t => (
                    <div key={t.id} data-component="protocol-info">
                      <h3 style={{ color: t.color }}>{t.name}</h3>
                      <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '0.5rem' }}>{t.description}</p>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: '#f5f5f5', borderRadius: 4, color: '#616161' }}>
                          {t.defaultQuorum}-of-{t.defaultMinOwners} approval
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: '#f5f5f5', borderRadius: 4, color: '#616161' }}>
                          {t.roles.length} roles
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem' }}>
                        <strong>Roles:</strong> {t.roles.map(r => r.label).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ),

            governance: (
              <div>
                <h2>Governance</h2>
                <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
                  Governance controls who can change the organization — add/remove signers,
                  change approval thresholds, upgrade contracts.
                </p>
                {adminOrgs.length === 0 ? (
                  <p data-component="text-muted">You don&apos;t have admin access to any organization.</p>
                ) : (
                  orgGovs.map(gov => (
                    <div key={gov.orgAddress} data-component="protocol-info" style={{ marginBottom: '1rem' }}>
                      <h3><Link href={`/agents/${gov.orgAddress}`} style={{ color: '#1565c0' }}>{gov.orgName}</Link></h3>
                      {!gov.initialized ? (
                        <p style={{ fontSize: '0.85rem', color: '#616161' }}>
                          Governance not initialized. <Link href={`/agents/${gov.orgAddress}`} style={{ color: '#1565c0' }}>Initialize</Link>
                        </p>
                      ) : (
                        <>
                          <dl>
                            <dt>Status</dt>
                            <dd><span data-component="role-badge" data-status={gov.isBootstrap ? 'proposed' : 'active'}>
                              {gov.isBootstrap ? 'Awaiting minimum signers' : 'Active'}
                            </span></dd>
                            <dt>Approval Required</dt>
                            <dd>{gov.quorum} of {gov.minOwners} signers</dd>
                            <dt>Current Signers</dt>
                            <dd>{gov.owners.length}</dd>
                          </dl>
                          {gov.owners.length > 0 && (
                            <div style={{ marginTop: '0.5rem' }}>
                              {gov.owners.map((addr, i) => (
                                <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#616161' }}>{addr}</div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            ),

            issuers: (
              <div>
                <h2>Registered Authorities ({issuerCount})</h2>
                <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
                  Authorities are agents authorized to make trust assertions.
                </p>
                {issuers.length === 0 ? (
                  <p data-component="text-muted">No authorities registered.</p>
                ) : (
                  <table data-component="graph-table">
                    <thead><tr><th>Name</th><th>Description</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {issuers.map(iss => (
                        <tr key={iss.address}>
                          <td><strong>{iss.name}</strong></td>
                          <td style={{ fontSize: '0.8rem', color: '#616161', maxWidth: 300 }}>{iss.description}</td>
                          <td><span data-component="role-badge" data-status={iss.active ? 'active' : 'revoked'}>{iss.active ? 'Active' : 'Inactive'}</span></td>
                          <td><Link href={`/agents/${iss.address}`} style={{ color: '#1565c0', fontSize: '0.8rem' }}>View</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ),

            ontology: (
              <div>
                <h2>Data Registry</h2>
                <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
                  The on-chain registry stores agent properties using a governed ontology.
                </p>
                <div data-component="protocol-info">
                  <dl>
                    <dt>Ontology</dt><dd>RDFS classes and properties for agent types</dd>
                    <dt>Validation</dt><dd>SHACL rules define required properties per agent type</dd>
                    <dt>Export</dt><dd>JSON-LD context for semantic data interchange</dd>
                  </dl>
                </div>
              </div>
            ),

            sessions: <SessionsPanel />,
          }}
        </SettingsTabs>
      </Suspense>
    </div>
  )
}
