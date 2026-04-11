import Link from 'next/link'
import { getPublicClient } from '@/lib/contracts'
import { agentValidationProfileAbi, agentIssuerProfileAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { keccak256, toBytes } from 'viem'

const TEE_ARCH_NAMES: Record<string, string> = {
  [keccak256(toBytes('aws-nitro'))]: 'AWS Nitro',
  [keccak256(toBytes('intel-tdx'))]: 'Intel TDX',
  [keccak256(toBytes('intel-sgx'))]: 'Intel SGX',
  [keccak256(toBytes('amd-sev'))]: 'AMD SEV',
}

const VM_NAMES: Record<string, string> = {
  [keccak256(toBytes('tee-onchain-verified'))]: 'On-Chain Verified',
  [keccak256(toBytes('tee-offchain-aggregated'))]: 'Off-Chain Aggregated',
  [keccak256(toBytes('reproducible-build'))]: 'Reproducible Build',
}

export default async function TeeValidationPage() {
  const client = getPublicClient()
  const validationAddr = process.env.AGENT_VALIDATION_ADDRESS as `0x${string}`
  const issuerAddr = process.env.AGENT_ISSUER_ADDRESS as `0x${string}`

  // Build address→name lookup
  const allOrgs = await db.select().from(schema.orgAgents)
  const allAI = await db.select().from(schema.aiAgents)
  const allPerson = await db.select().from(schema.personAgents)
  const nameMap = new Map<string, string>()
  for (const o of allOrgs) nameMap.set(o.smartAccountAddress.toLowerCase(), o.name)
  for (const a of allAI) nameMap.set(a.smartAccountAddress.toLowerCase(), a.name)
  for (const p of allPerson) nameMap.set(p.smartAccountAddress.toLowerCase(), p.name)
  const getName = (a: string) => nameMap.get(a.toLowerCase()) ?? `${a.slice(0, 6)}...${a.slice(-4)}`

  type ValidationView = {
    id: number
    agent: string
    agentAddress: string
    assertionId: number
    teeArch: string
    validationMethod: string
    verifier: string
    codeMeasurement: string
    evidenceURI: string
    validatedBy: string
    validatedAt: string
  }

  type IssuerView = {
    address: string
    name: string
    description: string
    active: boolean
  }

  const validations: ValidationView[] = []
  const teeVerifiers: IssuerView[] = []

  // Load validation records
  try {
    const count = (await client.readContract({
      address: validationAddr,
      abi: agentValidationProfileAbi,
      functionName: 'validationCount',
    })) as bigint

    for (let i = 0n; i < count; i++) {
      const v = (await client.readContract({
        address: validationAddr,
        abi: agentValidationProfileAbi,
        functionName: 'getValidation',
        args: [i],
      })) as {
        validationId: bigint; agent: string; assertionId: bigint; validationMethod: `0x${string}`
        verifierContract: string; teeArch: `0x${string}`; codeMeasurement: `0x${string}`
        evidenceURI: string; validatedBy: string; validatedAt: bigint
      }

      validations.push({
        id: Number(v.validationId),
        agent: getName(v.agent),
        agentAddress: v.agent,
        assertionId: Number(v.assertionId),
        teeArch: TEE_ARCH_NAMES[v.teeArch] ?? 'Unknown',
        validationMethod: VM_NAMES[v.validationMethod] ?? 'Unknown',
        verifier: v.verifierContract,
        codeMeasurement: v.codeMeasurement,
        evidenceURI: v.evidenceURI,
        validatedBy: getName(v.validatedBy),
        validatedAt: new Date(Number(v.validatedAt) * 1000).toLocaleString(),
      })
    }
  } catch { /* not deployed */ }

  // Load TEE verifier issuers
  try {
    const TEE_VERIFIER_TYPE = keccak256(toBytes('tee-verifier'))
    const verifierAddrs = (await client.readContract({
      address: issuerAddr,
      abi: agentIssuerProfileAbi,
      functionName: 'getIssuersByType',
      args: [TEE_VERIFIER_TYPE],
    })) as `0x${string}`[]

    for (const addr of verifierAddrs) {
      const profile = (await client.readContract({
        address: issuerAddr,
        abi: agentIssuerProfileAbi,
        functionName: 'getProfile',
        args: [addr],
      })) as [string, `0x${string}`, string, string, string, bigint, boolean]

      teeVerifiers.push({
        address: addr,
        name: profile[2],
        description: profile[3],
        active: profile[6],
      })
    }
  } catch { /* not deployed */ }

  return (
    <div data-page="tee-validation">
      <div data-component="page-header">
        <div data-component="section-header">
          <h1>TEE Validation</h1>
          <Link href="/tee/simulate" data-component="section-action" style={{ marginRight: '0.5rem' }}>Simulate TEE</Link>
          <Link href="/tee/submit" data-component="section-action">+ Record Validation</Link>
        </div>
        <p>Trusted Execution Environment attestation records for agents in the trust fabric</p>
      </div>

      <div data-component="protocol-info">
        <h3>What is TEE Validation?</h3>
        <p style={{ fontSize: '0.85rem', color: '#616161', lineHeight: 1.6 }}>
          A Trusted Execution Environment (TEE) is a secure, isolated area within a processor
          that guarantees code and data are protected from the rest of the system. TEE validation
          proves that an agent&apos;s code is running exactly as published, inside tamper-proof hardware.
          The attestation includes a <strong>code measurement</strong> (hash of the running code) and the
          <strong> TEE architecture</strong> (AWS Nitro, Intel TDX/SGX, AMD SEV).
        </p>
        <dl>
          <dt>AgentValidationProfile</dt><dd data-component="address">{validationAddr}</dd>
          <dt>AgentIssuerProfile</dt><dd data-component="address">{issuerAddr}</dd>
        </dl>
      </div>

      {/* TEE Verifiers */}
      <section data-component="graph-section">
        <h2>Registered TEE Verifiers ({teeVerifiers.length})</h2>
        {teeVerifiers.length === 0 ? (
          <p data-component="text-muted">No TEE verifiers registered.</p>
        ) : (
          <table data-component="graph-table">
            <thead>
              <tr><th>Name</th><th>Address</th><th>Description</th><th>Status</th></tr>
            </thead>
            <tbody>
              {teeVerifiers.map((v) => (
                <tr key={v.address}>
                  <td><strong>{v.name}</strong></td>
                  <td data-component="address" style={{ fontSize: '0.75rem' }}>{v.address}</td>
                  <td style={{ fontSize: '0.8rem', color: '#616161' }}>{v.description}</td>
                  <td><span data-component="role-badge" data-status={v.active ? 'active' : 'revoked'}>{v.active ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Validation Records */}
      <section data-component="graph-section">
        <h2>Validation Records ({validations.length})</h2>
        {validations.length === 0 ? (
          <p data-component="text-muted">No TEE validations recorded yet.</p>
        ) : (
          <table data-component="graph-table">
            <thead>
              <tr><th>Agent</th><th>TEE</th><th>Method</th><th>Code Measurement</th><th>Validated By</th><th>Date</th></tr>
            </thead>
            <tbody>
              {validations.map((v) => (
                <tr key={v.id}>
                  <td><Link href={`/agents/${v.agentAddress}`} style={{ color: '#1565c0' }}>{v.agent}</Link></td>
                  <td><span data-component="role-badge">{v.teeArch}</span></td>
                  <td><span data-component="role-badge" data-status="active">{v.validationMethod}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.7rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={v.codeMeasurement}>{v.codeMeasurement.slice(0, 10)}...{v.codeMeasurement.slice(-8)}</td>
                  <td>{v.validatedBy}</td>
                  <td style={{ fontSize: '0.8rem', color: '#616161' }}>{v.validatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* How It Works */}
      <section data-component="graph-section">
        <h2>How TEE Validation Works</h2>
        <div style={{ fontSize: '0.85rem', color: '#616161', lineHeight: 1.7 }}>
          <ol style={{ paddingLeft: '1.2rem' }}>
            <li><strong>Agent runs in TEE</strong> — The agent&apos;s code executes inside a Trusted Execution Environment (AWS Nitro Enclave, Intel TDX VM, etc.)</li>
            <li><strong>TEE generates attestation</strong> — The hardware produces a cryptographic quote containing code measurements (PCRs for Nitro, RTMRs for TDX)</li>
            <li><strong>Verifier checks the quote</strong> — An on-chain or off-chain verifier validates the attestation against the TEE vendor&apos;s root of trust</li>
            <li><strong>Validation recorded on-chain</strong> — The code measurement, TEE architecture, and evidence are stored in AgentValidationProfile</li>
            <li><strong>Trust resolution uses validation</strong> — Other agents and users can query the validation to verify the agent&apos;s runtime integrity</li>
          </ol>
        </div>
      </section>
    </div>
  )
}
