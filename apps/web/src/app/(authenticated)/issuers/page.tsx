import { getPublicClient } from '@/lib/contracts'
import { agentIssuerProfileAbi } from '@smart-agent/sdk'
import { issuerTypeName, validationMethodName, toDidEthr } from '@smart-agent/sdk'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

interface IssuerView {
  address: string
  did: string
  issuerType: string
  name: string
  description: string
  validationMethods: string[]
  active: boolean
}

export default async function IssuersPage() {
  const issuers: IssuerView[] = []

  try {
    const client = getPublicClient()
    const issuerAddr = process.env.AGENT_ISSUER_ADDRESS as `0x${string}`
    if (!issuerAddr) throw new Error('AGENT_ISSUER_ADDRESS not set')

    const count = (await client.readContract({
      address: issuerAddr, abi: agentIssuerProfileAbi, functionName: 'issuerCount',
    })) as bigint

    for (let i = 0n; i < count; i++) {
      const addr = (await client.readContract({
        address: issuerAddr, abi: agentIssuerProfileAbi, functionName: 'getIssuerAt', args: [i],
      })) as `0x${string}`

      const profile = (await client.readContract({
        address: issuerAddr, abi: agentIssuerProfileAbi, functionName: 'getProfile', args: [addr],
      })) as [string, `0x${string}`, string, string, string, bigint, boolean]

      const methods = (await client.readContract({
        address: issuerAddr, abi: agentIssuerProfileAbi, functionName: 'getValidationMethods', args: [addr],
      })) as `0x${string}`[]

      issuers.push({
        address: addr,
        did: toDidEthr(CHAIN_ID, addr),
        issuerType: issuerTypeName(profile[1]),
        name: profile[2],
        description: profile[3],
        validationMethods: methods.map((m) => validationMethodName(m)),
        active: profile[6],
      })
    }
  } catch {
    // issuers not deployed
  }

  return (
    <div data-page="issuers">
      <div data-component="page-header">
        <h1>Claim Issuers</h1>
        <p>
          Registered agents authorized to make assertions about other agents.
          Each issuer has a type, supported validation methods, and claim types.
        </p>
      </div>

      <div data-component="protocol-info">
        <h3>Protocol Contract</h3>
        <dl>
          <dt>AgentIssuerProfile</dt>
          <dd data-component="address">{process.env.AGENT_ISSUER_ADDRESS}</dd>
          <dt>AgentValidationProfile</dt>
          <dd data-component="address">{process.env.AGENT_VALIDATION_ADDRESS}</dd>
        </dl>
      </div>

      {issuers.length === 0 ? (
        <div data-component="empty-state">
          <p>No issuers registered. Run <code>scripts/seed-graph.sh</code> to seed.</p>
        </div>
      ) : (
        <div data-component="template-grid">
          {issuers.map((issuer) => (
            <div key={issuer.address} data-component="template-full-card" data-active={issuer.active ? 'true' : 'false'}>
              <div data-component="template-full-header">
                <h3>{issuer.name}</h3>
                <span data-component="role-badge">{issuer.issuerType}</span>
              </div>
              <p data-component="template-desc">{issuer.description}</p>
              <code data-component="did">{issuer.did}</code>
              <div data-component="template-meta">
                <dl>
                  <dt>Address</dt>
                  <dd data-component="address">{issuer.address}</dd>
                  <dt>Validation Methods</dt>
                  <dd data-component="role-list">
                    {issuer.validationMethods.map((m, i) => (
                      <span key={i} data-component="role-badge">{m}</span>
                    ))}
                  </dd>
                  <dt>Status</dt>
                  <dd>
                    <span data-component="role-badge" data-status={issuer.active ? 'active' : 'proposed'}>
                      {issuer.active ? 'active' : 'inactive'}
                    </span>
                  </dd>
                </dl>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
