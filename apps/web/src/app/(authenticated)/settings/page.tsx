import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { getPublicClient } from '@/lib/contracts'
import { agentControlAbi, agentIssuerProfileAbi } from '@smart-agent/sdk'
import { ORG_TEMPLATES } from '@/lib/org-templates.data'
import { SettingsTabs } from './SettingsTabs'

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  const client = getPublicClient()
  const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`
  const issuerAddr = process.env.AGENT_ISSUER_ADDRESS as `0x${string}`

  // Load governance config for selected org
  let govConfig = { minOwners: 0, quorum: 0, isBootstrap: false }
  let govOwners: string[] = []
  let govInitialized = false

  if (selectedOrg && controlAddr) {
    try {
      govInitialized = (await client.readContract({
        address: controlAddr, abi: agentControlAbi,
        functionName: 'isInitialized', args: [selectedOrg.smartAccountAddress as `0x${string}`],
      })) as boolean
      if (govInitialized) {
        const cfg = (await client.readContract({
          address: controlAddr, abi: agentControlAbi,
          functionName: 'getConfig', args: [selectedOrg.smartAccountAddress as `0x${string}`],
        })) as { minOwners: bigint; quorum: bigint; isBootstrap: boolean }
        govConfig = { minOwners: Number(cfg.minOwners), quorum: Number(cfg.quorum), isBootstrap: cfg.isBootstrap }
        govOwners = (await client.readContract({
          address: controlAddr, abi: agentControlAbi,
          functionName: 'getOwners', args: [selectedOrg.smartAccountAddress as `0x${string}`],
        })) as string[]
      }
    } catch { /* not deployed */ }
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
        <h1>Administration{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
        <p>Organization configuration, templates, governance, and authority management</p>
      </div>

      <Suspense fallback={<p>Loading...</p>}>
        <SettingsTabs>
          {{
            templates: (
              <div>
                <h2>Organization Templates</h2>
                <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
                  Templates define governance structure, roles, and AI agents for each organization type.
                  Select a template when <Link href="/setup" style={{ color: '#2563eb' }}>creating a new organization</Link>.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  {ORG_TEMPLATES.map(t => (
                    <div key={t.id} data-component="protocol-info">
                      <h3 style={{ color: t.color }}>{t.name}</h3>
                      <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.5rem' }}>{t.description}</p>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: '#f0f1f3', borderRadius: 4, color: '#6b7280' }}>
                          {t.defaultQuorum}-of-{t.defaultMinOwners} approval
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: '#f0f1f3', borderRadius: 4, color: '#6b7280' }}>
                          {t.roles.length} roles
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: '#f0f1f3', borderRadius: 4, color: '#6b7280' }}>
                          {t.aiAgents.length} AI agents
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem' }}>
                        <strong>Roles:</strong> {t.roles.map(r => r.label).join(', ')}
                      </div>
                      <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        <strong>Agents:</strong> {t.aiAgents.map(a => a.name).join(', ') || 'None'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ),

            governance: (
              <div>
                <h2>Governance (Control Plane){selectedOrg ? ` — ${selectedOrg.name}` : ''}</h2>
                <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
                  Governance controls <strong>who can change the organization itself</strong> — add/remove signers,
                  change approval thresholds, upgrade contracts. This is separate from operational roles and delegations
                  which are managed on the <Link href="/team" style={{ color: '#2563eb' }}>Organization page</Link>.
                </p>
                {!selectedOrg ? (
                  <p data-component="text-muted">Select or create an organization to view governance settings.</p>
                ) : !govInitialized ? (
                  <div data-component="protocol-info">
                    <p>Governance has not been initialized for this organization.</p>
                    <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: '0.5rem' }}>
                      <Link href={`/agents/${selectedOrg.smartAccountAddress}`} style={{ color: '#2563eb' }}>Initialize governance</Link> in the agent settings.
                    </p>
                  </div>
                ) : (
                  <div data-component="protocol-info">
                    <dl>
                      <dt>Status</dt>
                      <dd><span data-component="role-badge" data-status={govConfig.isBootstrap ? 'proposed' : 'active'}>
                        {govConfig.isBootstrap ? 'Awaiting minimum signers' : 'Active'}
                      </span></dd>
                      <dt>Approval Required</dt>
                      <dd>{govConfig.quorum} of {govConfig.minOwners} signers</dd>
                      <dt>Current Signers</dt>
                      <dd>{govOwners.length}</dd>
                    </dl>
                    {govOwners.length > 0 && (
                      <div style={{ marginTop: '0.75rem' }}>
                        <strong style={{ fontSize: '0.85rem' }}>Authorized Signers</strong>
                        {govOwners.map((addr, i) => (
                          <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                            {addr}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: '0.75rem' }}>
                      <Link href={`/agents/${selectedOrg.smartAccountAddress}`} style={{ color: '#2563eb', fontSize: '0.85rem' }}>
                        Manage signers and governance
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ),

            issuers: (
              <div>
                <h2>Registered Authorities ({issuerCount})</h2>
                <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
                  Authorities are agents authorized to make trust assertions — validators, auditors, accreditors, TEE verifiers.
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
                          <td style={{ fontSize: '0.8rem', color: '#6b7280', maxWidth: 300 }}>{iss.description}</td>
                          <td><span data-component="role-badge" data-status={iss.active ? 'active' : 'revoked'}>{iss.active ? 'Active' : 'Inactive'}</span></td>
                          <td><Link href={`/agents/${iss.address}`} style={{ color: '#2563eb', fontSize: '0.8rem' }}>View</Link></td>
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
                <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
                  The on-chain registry stores agent properties using a governed ontology.
                  Properties are defined as terms with URIs, labels, and data types.
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
          }}
        </SettingsTabs>
      </Suspense>
    </div>
  )
}
