import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient, getEdgesBySubject, getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import {
  agentControlAbi, agentAccountAbi, agentReviewRecordAbi,
  agentValidationProfileAbi, agentTrustProfileAbi, agentDisputeRecordAbi,
  agentAccountResolverAbi,
  roleName, relationshipTypeName,
  
  ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT,
} from '@smart-agent/sdk'
import { toDidEthr } from '@smart-agent/sdk'
import { getAgentMetadata, buildAgentNameMap, getNameFromMap } from '@/lib/agent-metadata'
import { keccak256, toBytes } from 'viem'
import { AgentSettingsClient } from './AgentSettingsClient'
import { AgentSubNav } from '@/components/nav/AgentSubNav'

const REC_NAMES: Record<string, string> = {
  [keccak256(toBytes('endorses'))]: 'endorses', [keccak256(toBytes('recommends'))]: 'recommends',
  [keccak256(toBytes('neutral'))]: 'neutral', [keccak256(toBytes('flags'))]: 'flags',
  [keccak256(toBytes('disputes'))]: 'disputes',
}
const TEE_ARCH_NAMES: Record<string, string> = {
  [keccak256(toBytes('aws-nitro'))]: 'AWS Nitro', [keccak256(toBytes('intel-tdx'))]: 'Intel TDX',
  [keccak256(toBytes('intel-sgx'))]: 'Intel SGX', [keccak256(toBytes('amd-sev'))]: 'AMD SEV',
}
const VM_NAMES: Record<string, string> = {
  [keccak256(toBytes('tee-onchain-verified'))]: 'On-Chain', [keccak256(toBytes('tee-offchain-aggregated'))]: 'Off-Chain',
  [keccak256(toBytes('reproducible-build'))]: 'Repro Build',
}
const STATUS_NAMES = ['None', 'Proposed', 'Confirmed', 'Active', 'Suspended', 'Revoked', 'Rejected']

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function AgentSettingsPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = await params
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const agentAddress = address as `0x${string}`
  const client = getPublicClient()
  const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`

  // Build name lookup from on-chain resolver
  const agentNameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(agentNameMap, a)

  // Get agent identity from on-chain resolver
  const agentMeta = await getAgentMetadata(agentAddress)
  let agentName = agentMeta.displayName
  let agentType = agentMeta.agentType === 'unknown' ? 'unknown' : agentMeta.agentType
  let agentDescription = agentMeta.description

  // ─── On-Chain Resolver Data (overrides DB if registered) ──────────
  let resolverRegistered = false
  let resolverCapabilities: string[] = []
  let resolverTrustModels: string[] = []
  let resolverA2A = ''
  let resolverMCP = ''
  let resolverMetadataURI = ''
  try {
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    if (resolverAddr) {
      resolverRegistered = (await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'isRegistered', args: [agentAddress],
      })) as boolean

      if (resolverRegistered) {
        const core = (await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getCore', args: [agentAddress],
        })) as { displayName: string; description: string; agentType: `0x${string}`; agentClass: `0x${string}`; metadataURI: string; active: boolean }

        // Override DB values with on-chain data
        if (core.displayName) agentName = core.displayName
        if (core.description) agentDescription = core.description
        if (core.metadataURI) resolverMetadataURI = core.metadataURI

        const typeMap: Record<string, string> = { [TYPE_PERSON]: 'person', [TYPE_ORGANIZATION]: 'org', [TYPE_AI_AGENT]: 'ai' }
        if (typeMap[core.agentType]) agentType = typeMap[core.agentType]

        resolverCapabilities = (await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiStringProperty', args: [agentAddress, ATL_CAPABILITY as `0x${string}`],
        })) as string[]

        resolverTrustModels = (await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiStringProperty', args: [agentAddress, ATL_SUPPORTED_TRUST as `0x${string}`],
        })) as string[]

        resolverA2A = (await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty', args: [agentAddress, ATL_A2A_ENDPOINT as `0x${string}`],
        })) as string

        resolverMCP = (await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty', args: [agentAddress, ATL_MCP_SERVER as `0x${string}`],
        })) as string
      }
    }
  } catch { /* resolver may not be deployed */ }

  // Get on-chain owner info from AgentAccount
  
  let ownerCount = 0
  try {
    ownerCount = Number(await client.readContract({
      address: agentAddress,
      abi: agentAccountAbi,
      functionName: 'ownerCount',
    }))
  } catch { /* not deployed */ }

  // Check AgentControl governance
  let governanceInitialized = false
  let governanceConfig = { minOwners: 0, quorum: 0, isBootstrap: false }
  let governanceOwners: string[] = []

  if (controlAddr) {
    try {
      governanceInitialized = (await client.readContract({
        address: controlAddr,
        abi: agentControlAbi,
        functionName: 'isInitialized',
        args: [agentAddress],
      })) as boolean

      if (governanceInitialized) {
        const config = (await client.readContract({
          address: controlAddr,
          abi: agentControlAbi,
          functionName: 'getConfig',
          args: [agentAddress],
        })) as { minOwners: bigint; quorum: bigint; isBootstrap: boolean }
        governanceConfig = {
          minOwners: Number(config.minOwners),
          quorum: Number(config.quorum),
          isBootstrap: config.isBootstrap,
        }

        governanceOwners = (await client.readContract({
          address: controlAddr,
          abi: agentControlAbi,
          functionName: 'getOwners',
          args: [agentAddress],
        })) as string[]
      }
    } catch { /* not deployed */ }
  }

  // ─── Trust Scores ──────────────────────────────────────────────────
  const trustAddr = process.env.AGENT_TRUST_PROFILE_ADDRESS as `0x${string}`
  type TrustData = { passes: boolean; score: bigint; edgeCount: bigint; reviewCount: bigint; avgReviewScore: bigint; openDisputes: bigint; validationCount: bigint }
  const emptyTrust: TrustData = { passes: false, score: 0n, edgeCount: 0n, reviewCount: 0n, avgReviewScore: 0n, openDisputes: 0n, validationCount: 0n }
  let discoveryTrust = emptyTrust
  let executionTrust = emptyTrust
  let runtimeTrust = emptyTrust
  try {
    discoveryTrust = (await client.readContract({ address: trustAddr, abi: agentTrustProfileAbi, functionName: 'checkDiscoveryTrust', args: [agentAddress] })) as TrustData
    executionTrust = (await client.readContract({ address: trustAddr, abi: agentTrustProfileAbi, functionName: 'checkExecutionTrust', args: [agentAddress] })) as TrustData
    runtimeTrust = (await client.readContract({ address: trustAddr, abi: agentTrustProfileAbi, functionName: 'checkRuntimeTrust', args: [agentAddress] })) as TrustData
  } catch { /* not deployed */ }

  // ─── Relationships ─────────────────────────────────────────────────
  type RelView = { edgeId: string; direction: string; counterparty: string; counterpartyAddr: string; type: string; roles: string[]; status: string }
  const relationships: RelView[] = []
  try {
    for (const edgeId of await getEdgesBySubject(agentAddress)) {
      const edge = await getEdge(edgeId)
      const roles = await getEdgeRoles(edgeId)
      relationships.push({ edgeId, direction: '→', counterparty: getName(edge.object_), counterpartyAddr: edge.object_, type: relationshipTypeName(edge.relationshipType), roles: roles.map(r => roleName(r)), status: STATUS_NAMES[edge.status] ?? 'Unknown' })
    }
    for (const edgeId of await getEdgesByObject(agentAddress)) {
      const edge = await getEdge(edgeId)
      const roles = await getEdgeRoles(edgeId)
      relationships.push({ edgeId, direction: '←', counterparty: getName(edge.subject), counterpartyAddr: edge.subject, type: relationshipTypeName(edge.relationshipType), roles: roles.map(r => roleName(r)), status: STATUS_NAMES[edge.status] ?? 'Unknown' })
    }
  } catch { /* not deployed */ }

  // ─── Reviews ───────────────────────────────────────────────────────
  type ReviewView = { id: number; reviewer: string; score: number; recommendation: string; comment: string }
  const reviews: ReviewView[] = []
  try {
    const reviewAddr = process.env.AGENT_REVIEW_ADDRESS as `0x${string}`
    const reviewIds = (await client.readContract({ address: reviewAddr, abi: agentReviewRecordAbi, functionName: 'getReviewsBySubject', args: [agentAddress] })) as bigint[]
    for (const rid of reviewIds) {
      const r = (await client.readContract({ address: reviewAddr, abi: agentReviewRecordAbi, functionName: 'getReview', args: [rid] })) as { reviewer: string; overallScore: number; recommendation: `0x${string}`; comment: string; revoked: boolean }
      if (!r.revoked) reviews.push({ id: Number(rid), reviewer: getName(r.reviewer), score: r.overallScore, recommendation: REC_NAMES[r.recommendation] ?? 'unknown', comment: r.comment })
    }
  } catch { /* not deployed */ }

  // ─── TEE Validations ───────────────────────────────────────────────
  type ValView = { id: number; teeArch: string; method: string; codeMeasurement: string; validatedBy: string; date: string }
  const validations: ValView[] = []
  try {
    const valAddr = process.env.AGENT_VALIDATION_ADDRESS as `0x${string}`
    const valIds = (await client.readContract({ address: valAddr, abi: agentValidationProfileAbi, functionName: 'getValidationsByAgent', args: [agentAddress] })) as bigint[]
    for (const vid of valIds) {
      const v = (await client.readContract({ address: valAddr, abi: agentValidationProfileAbi, functionName: 'getValidation', args: [vid] })) as { teeArch: `0x${string}`; validationMethod: `0x${string}`; codeMeasurement: `0x${string}`; validatedBy: string; validatedAt: bigint }
      validations.push({ id: Number(vid), teeArch: TEE_ARCH_NAMES[v.teeArch] ?? 'Unknown', method: VM_NAMES[v.validationMethod] ?? 'Unknown', codeMeasurement: v.codeMeasurement, validatedBy: getName(v.validatedBy), date: new Date(Number(v.validatedAt) * 1000).toLocaleDateString() })
    }
  } catch { /* not deployed */ }

  // ─── Disputes ──────────────────────────────────────────────────────
  type DisputeView = { id: number; filedBy: string; type: string; status: string; reason: string }
  const disputes: DisputeView[] = []
  try {
    const dispAddr = process.env.AGENT_DISPUTE_ADDRESS as `0x${string}`
    const dtNames = ['none', 'flag', 'dispute', 'sanction', 'suspension', 'revocation', 'blacklist']
    const dsNames = ['open', 'under-review', 'resolved', 'dismissed', 'upheld']
    const disputeIds = (await client.readContract({ address: dispAddr, abi: agentDisputeRecordAbi, functionName: 'getDisputesBySubject', args: [agentAddress] })) as bigint[]
    for (const did of disputeIds) {
      const d = (await client.readContract({ address: dispAddr, abi: agentDisputeRecordAbi, functionName: 'getDispute', args: [did] })) as { filedBy: string; disputeType: number; status: number; reason: string }
      disputes.push({ id: Number(did), filedBy: getName(d.filedBy), type: dtNames[d.disputeType] ?? 'unknown', status: dsNames[d.status] ?? 'unknown', reason: d.reason })
    }
  } catch { /* not deployed */ }

  // ─── Delegations ───────────────────────────────────────────────────
  const timestampEnforcer = (process.env.TIMESTAMP_ENFORCER_ADDRESS ?? '').toLowerCase()
  const methodsEnforcer = (process.env.ALLOWED_METHODS_ENFORCER_ADDRESS ?? '').toLowerCase()
  const targetsEnforcer = (process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS ?? '').toLowerCase()
  const enforcerNames: Record<string, string> = {
    [timestampEnforcer]: 'Time Window',
    [methodsEnforcer]: 'Allowed Methods',
    [targetsEnforcer]: 'Allowed Targets',
  }

  type DelegationView = {
    id: string; role: string; counterparty: string; counterpartyAddr: string
    direction: string; status: string; createdAt: string; expiresAt: string
    delegator: string; delegate: string
    caveats: Array<{ name: string; enforcer: string }>
    authority: string
  }
  const delegations: DelegationView[] = []
  // Delegation data is now derived from on-chain relationship edges and role authority below

  // Also derive authority from relationship edges (roles imply delegation authority)
  const ROLE_AUTHORITY: Record<string, { description: string; bounds: string[] }> = {
    'owner': { description: 'Full authority over organization', bounds: ['All methods', 'All targets', 'No spending limit'] },
    'ceo': { description: 'Executive authority', bounds: ['All methods', 'All targets', 'No spending limit'] },
    'treasurer': { description: 'Financial management authority', bounds: ['Time Window', 'Spending Limit', 'Allowed Targets'] },
    'authorized-signer': { description: 'Transaction signing authority', bounds: ['Time Window', 'Spending Limit'] },
    'board-member': { description: 'Governance proposal and approval authority', bounds: ['Allowed Methods (proposals)'] },
    'admin': { description: 'Administrative operations', bounds: ['Allowed Methods', 'Allowed Targets'] },
    'operator': { description: 'Operational execution authority', bounds: ['Time Window', 'Allowed Methods', 'Allowed Targets'] },
    'reviewer': { description: 'Review submission authority', bounds: ['Time Window', 'Allowed Methods (createReview)', 'Allowed Targets (ReviewRecord)'] },
    'auditor': { description: 'Read-only audit access', bounds: ['Allowed Methods (view only)'] },
    'validator': { description: 'Validation and endorsement authority', bounds: ['Allowed Methods', 'Allowed Targets'] },
  }

  // For person agents: show authority from their org relationships
  if (agentType === 'person') {
    for (const rel of relationships) {
      if (rel.direction !== '→') continue // outgoing = this person → some org
      for (const role of rel.roles) {
        const auth = ROLE_AUTHORITY[role]
        if (!auth) continue
        // Check if we already have an explicit delegation for this
        const alreadyExists = delegations.some(d =>
          d.id === `role-${rel.edgeId}-${role}`
        )
        if (!alreadyExists) {
          delegations.push({
            id: `role-${rel.edgeId}-${role}`,
            role: `${auth.description} at`,
            counterparty: rel.counterparty,
            counterpartyAddr: rel.counterpartyAddr,
            direction: 'outgoing',
            status: rel.status === 'Active' ? 'active' : 'proposed',
            createdAt: '',
            expiresAt: 'Permanent (role-based)',
            delegator: rel.counterpartyAddr,
            delegate: agentAddress,
            caveats: auth.bounds.map(b => ({ name: b, enforcer: '' })),
            authority: 'Role',
          })
        }
      }
    }
  }

  // For org agents: show authority granted TO people
  if (agentType === 'org' || agentType === 'ai') {
    for (const rel of relationships) {
      if (rel.direction !== '←') continue // incoming = some person → this org
      for (const role of rel.roles) {
        const auth = ROLE_AUTHORITY[role]
        if (!auth) continue
        const alreadyExists = delegations.some(d =>
          d.id === `role-${rel.edgeId}-${role}`
        )
        if (!alreadyExists) {
          delegations.push({
            id: `role-${rel.edgeId}-${role}`,
            role: `Granted ${role} authority to`,
            counterparty: rel.counterparty,
            counterpartyAddr: rel.counterpartyAddr,
            direction: 'incoming',
            status: rel.status === 'Active' ? 'active' : 'proposed',
            createdAt: '',
            expiresAt: 'Permanent (role-based)',
            delegator: agentAddress,
            delegate: rel.counterpartyAddr,
            caveats: auth.bounds.map(b => ({ name: b, enforcer: '' })),
            authority: 'Role',
          })
        }
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────
  const typeLabel = agentType === 'ai' ? 'AI Agent' : agentType === 'org' ? 'Organization' : 'Person Agent'
  const aiSubtype = agentMeta.aiAgentClass || null

  function TrustScoreBar({ score, passes }: { score: number; passes: boolean }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ flex: 1, height: 8, background: '#f5f5f5', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${score}%`, height: '100%', background: passes ? '#2e7d32' : score >= 40 ? '#f59e0b' : '#ef4444', borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
        <span style={{ fontWeight: 700, fontSize: '0.9rem', minWidth: 40 }}>{score}</span>
        <span data-component="role-badge" data-status={passes ? 'active' : 'revoked'} style={{ whiteSpace: 'nowrap' }}>{passes ? 'Pass' : 'Fail'}</span>
      </div>
    )
  }

  return (
    <div data-page="agent-settings">
      {/* ─── Header ────────────────────────────────────────────────── */}
      <div data-component="page-header">
        <div data-component="section-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 style={{ margin: 0 }}>{agentName}</h1>
            <span data-component="role-badge" data-status="active">{typeLabel}</span>
            {aiSubtype && <span data-component="role-badge">{aiSubtype}</span>}
          </div>
          <Link href={`/agents/${agentAddress}/communicate`} data-component="section-action" style={{ marginRight: '0.5rem' }}>Communicate</Link>
          <Link href={`/agents/${agentAddress}/metadata`} data-component="section-action">Metadata</Link>
        </div>
        {agentDescription && <p>{agentDescription}</p>}
      </div>

      <AgentSubNav address={agentAddress} />

      {/* ─── Identity Card ─────────────────────────────────────────── */}
      <div data-component="protocol-info">
        <dl>
          <dt>Smart Account</dt><dd data-component="address">{agentAddress}</dd>
          <dt>DID</dt><dd style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{toDidEthr(CHAIN_ID, agentAddress)}</dd>
          <dt>On-Chain Owners</dt><dd>{ownerCount}</dd>
          {/* Operated-by relationship is shown in the Relationships section below */}
        </dl>
      </div>

      {/* ─── On-Chain Metadata (from Resolver) ──────────────────────── */}
      {resolverRegistered && (
        <section data-component="graph-section">
          <h2>On-Chain Metadata</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            {resolverCapabilities.length > 0 && (
              <div data-component="protocol-info">
                <h3>Capabilities</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {resolverCapabilities.map(c => <span key={c} data-component="role-badge">{c}</span>)}
                </div>
              </div>
            )}
            {resolverTrustModels.length > 0 && (
              <div data-component="protocol-info">
                <h3>Trust Models</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {resolverTrustModels.map(t => <span key={t} data-component="role-badge" data-status="active">{t}</span>)}
                </div>
              </div>
            )}
            {(resolverA2A || resolverMCP) && (
              <div data-component="protocol-info">
                <h3>Endpoints</h3>
                <dl>
                  {resolverA2A && <><dt>A2A</dt><dd style={{ fontSize: '0.75rem' }}>{resolverA2A}</dd></>}
                  {resolverMCP && <><dt>MCP</dt><dd style={{ fontSize: '0.75rem' }}>{resolverMCP}</dd></>}
                </dl>
              </div>
            )}
          </div>
          {resolverMetadataURI && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#616161' }}>
              Metadata URI: <code>{resolverMetadataURI.slice(0, 50)}{resolverMetadataURI.length > 50 ? '...' : ''}</code>
            </div>
          )}
        </section>
      )}

      {/* ─── Trust Scores ──────────────────────────────────────────── */}
      <section data-component="graph-section">
        <h2>Trust Profile</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* Discovery Trust */}
          <div data-component="protocol-info">
            <h3>Discovery Trust</h3>
            <p style={{ fontSize: '0.8rem', color: '#616161', margin: '0.25rem 0 0.75rem' }}>
              Can this agent be found and relied upon? Measures organizational backing,
              community feedback, and whether the agent has been independently validated.
            </p>
            <TrustScoreBar score={Number(discoveryTrust.score)} passes={discoveryTrust.passes} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.8rem' }}>
              <div><span style={{ color: '#616161' }}>Edges</span><br /><strong>{Number(discoveryTrust.edgeCount)}</strong></div>
              <div><span style={{ color: '#616161' }}>Reviews</span><br /><strong>{Number(discoveryTrust.reviewCount)}</strong> (avg {Number(discoveryTrust.avgReviewScore)})</div>
              <div><span style={{ color: '#616161' }}>TEE</span><br /><strong>{Number(discoveryTrust.validationCount)}</strong></div>
            </div>
          </div>

          {/* Execution Trust */}
          <div data-component="protocol-info">
            <h3>Execution Trust</h3>
            <p style={{ fontSize: '0.8rem', color: '#616161', margin: '0.25rem 0 0.75rem' }}>
              Can this agent safely execute tasks on your behalf? Weighs delegation authority,
              TEE validation (code runs in verified hardware), review quality, and dispute history.
            </p>
            <TrustScoreBar score={Number(executionTrust.score)} passes={executionTrust.passes} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.8rem' }}>
              <div><span style={{ color: '#616161' }}>Delegations</span><br /><strong>{delegations.filter(d => d.status === 'active').length}</strong></div>
              <div><span style={{ color: '#616161' }}>TEE</span><br /><strong>{Number(executionTrust.validationCount)}</strong></div>
              <div><span style={{ color: '#616161' }}>Edges</span><br /><strong>{Number(executionTrust.edgeCount)}</strong></div>
              <div><span style={{ color: '#616161' }}>Disputes</span><br /><strong>{Number(executionTrust.openDisputes)}</strong></div>
            </div>
          </div>

          {/* Runtime Trust */}
          <div data-component="protocol-info" style={{ gridColumn: 'span 2' }}>
            <h3>Runtime Trust</h3>
            <p style={{ fontSize: '0.8rem', color: '#616161', margin: '0.25rem 0 0.75rem' }}>
              Is the agent running verified code inside tamper-proof hardware?
              This profile is dominated by TEE attestation — a hardware-backed proof that
              the agent&apos;s code matches a published measurement and hasn&apos;t been modified.
              {validations.length === 0 && ' No TEE attestation recorded yet.'}
            </p>
            <TrustScoreBar score={Number(runtimeTrust.score)} passes={runtimeTrust.passes} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.8rem' }}>
              <div><span style={{ color: '#616161' }}>TEE Validations</span><br /><strong>{Number(runtimeTrust.validationCount)}</strong></div>
              <div><span style={{ color: '#616161' }}>Edges</span><br /><strong>{Number(runtimeTrust.edgeCount)}</strong></div>
              <div><span style={{ color: '#616161' }}>Reviews</span><br /><strong>{Number(runtimeTrust.reviewCount)}</strong></div>
              <div><span style={{ color: '#616161' }}>Disputes</span><br /><strong>{Number(runtimeTrust.openDisputes)}</strong></div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Relationships ─────────────────────────────────────────── */}
      <section data-component="graph-section">
        <h2>Relationships ({relationships.length})</h2>
        {relationships.length === 0 ? <p data-component="text-muted">No relationships.</p> : (
          <table data-component="graph-table">
            <thead><tr><th></th><th>Counterparty</th><th>Type</th><th>Roles</th><th>Status</th></tr></thead>
            <tbody>
              {relationships.map((r) => (
                <tr key={r.edgeId}>
                  <td>{r.direction}</td>
                  <td><Link href={`/agents/${r.counterpartyAddr}`} style={{ color: '#1565c0' }}>{r.counterparty}</Link></td>
                  <td><span data-component="role-badge">{r.type}</span></td>
                  <td>{r.roles.map((role) => <span key={role} data-component="role-badge" style={{ marginRight: 4 }}>{role}</span>)}</td>
                  <td><span data-component="role-badge" data-status={r.status === 'Active' ? 'active' : r.status === 'Proposed' ? 'proposed' : 'revoked'}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ─── Authority & Delegations ─────────────────────────────── */}
      <section data-component="graph-section">
        <h2>{agentType === 'person' ? 'Your Authority' : 'Granted Authority'} ({delegations.length})</h2>
        <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
          {agentType === 'person'
            ? 'What you can do within each organization, based on your roles and delegated permissions.'
            : 'Authority granted to people and agents, defining what they can do on behalf of this organization.'}
        </p>
        {delegations.length === 0 ? (
          <p data-component="text-muted">No authority assigned. Join an organization and accept a role to receive delegated authority.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {delegations.map((d) => {
              // Extract the role name from the delegation description
              const roleName = d.authority === 'Role'
                ? d.role.replace(' at', '').replace('Granted ', '').replace(' authority to', '')
                : 'Delegated Review'

              return (
                <div key={d.id} style={{
                  background: '#ffffff', border: '1px solid #e2e4e8', borderRadius: 8,
                  padding: '1rem', borderLeft: `4px solid ${d.status === 'active' ? '#2e7d32' : '#d97706'}`,
                }}>
                  {/* Header: Role + Org + Status */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1a1a2e' }}>{roleName}</span>
                      <span data-component="role-badge" data-status={d.status === 'active' ? 'active' : d.status === 'expired' ? 'revoked' : 'proposed'}>{d.status}</span>
                    </div>
                    <Link href={`/agents/${d.counterpartyAddr}`} style={{ color: '#1565c0', fontSize: '0.85rem' }}>{d.counterparty}</Link>
                  </div>

                  {/* What you can do */}
                  <div style={{ fontSize: '0.85rem', color: '#4b5563', marginBottom: '0.75rem' }}>
                    {d.role.includes('Full authority') && 'Full control over the organization — manage members, approve transactions, change settings.'}
                    {d.role.includes('Financial management') && 'Manage funds within spending limits — process payments, track budgets, approve disbursements.'}
                    {d.role.includes('Transaction signing') && 'Sign and authorize transactions on behalf of the organization.'}
                    {d.role.includes('Governance proposal') && 'Create and vote on governance proposals — policy changes, budget approvals.'}
                    {d.role.includes('Administrative') && 'Manage day-to-day operations — schedules, assignments, communications.'}
                    {d.role.includes('Operational execution') && 'Execute operational tasks within defined boundaries.'}
                    {d.role.includes('Review submission') && 'Submit performance reviews and evaluations for this organization.'}
                    {d.role.includes('Read-only') && 'View financial records and compliance data for audit purposes.'}
                    {d.role.includes('Validation') && 'Validate, endorse, or certify this organization.'}
                    {d.role.includes('Granted owner') && `${d.counterparty} has full control over this organization.`}
                    {d.role.includes('Granted treasurer') && `${d.counterparty} can manage funds within spending limits.`}
                    {d.role.includes('Granted authorized-signer') && `${d.counterparty} can sign transactions on behalf of this organization.`}
                    {d.role.includes('Granted reviewer') && `${d.counterparty} can submit reviews for this organization.`}
                    {d.role.includes('Granted validator') && `${d.counterparty} can validate or endorse this organization.`}
                    {d.role.includes('Granted board-member') && `${d.counterparty} can participate in governance decisions.`}
                    {d.role.includes('Granted ceo') && `${d.counterparty} has executive authority over this organization.`}
                    {d.role.includes('Delegated review') && 'Submit structured reviews via delegated execution.'}
                  </div>

                  {/* Boundaries */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    {d.caveats.map((c, i) => (
                      <span key={i} style={{
                        fontSize: '0.75rem', padding: '0.2rem 0.5rem',
                        background: '#fafafa', border: '1px solid #e2e4e8', borderRadius: 4,
                        color: '#4b5563',
                      }}>{c.name}</span>
                    ))}
                  </div>

                  {/* Footer: From/To + Duration */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#616161', borderTop: '1px solid #f0f1f3', paddingTop: '0.5rem' }}>
                    <span>
                      {agentType === 'person' ? 'Granted by ' : 'Assigned to '}
                      <Link href={`/agents/${agentType === 'person' ? d.delegator : d.delegate}`} style={{ color: '#1565c0' }}>
                        {agentType === 'person' ? getName(d.delegator) : getName(d.delegate)}
                      </Link>
                    </span>
                    <span>{d.expiresAt}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ─── Reviews ───────────────────────────────────────────────── */}
      <section data-component="graph-section">
        <h2>Reviews ({reviews.length})</h2>
        {reviews.length === 0 ? <p data-component="text-muted">No reviews.</p> : (
          <table data-component="graph-table">
            <thead><tr><th>Reviewer</th><th>Score</th><th>Signal</th><th>Comment</th></tr></thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id}>
                  <td>{r.reviewer}</td>
                  <td><strong>{r.score}</strong>/100</td>
                  <td><span data-component="role-badge" data-status={r.recommendation === 'endorses' || r.recommendation === 'recommends' ? 'active' : r.recommendation === 'flags' || r.recommendation === 'disputes' ? 'revoked' : 'proposed'}>{r.recommendation}</span></td>
                  <td style={{ maxWidth: 300, fontSize: '0.8rem', color: '#616161' }}>{r.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ─── TEE Validations ───────────────────────────────────────── */}
      <section data-component="graph-section">
        <h2>TEE Validations ({validations.length})</h2>
        {validations.length === 0 ? (
          <p data-component="text-muted">No TEE validations recorded. <Link href="/tee/simulate" style={{ color: '#1565c0' }}>Simulate one</Link></p>
        ) : (
          <table data-component="graph-table">
            <thead><tr><th>Architecture</th><th>Method</th><th>Code Measurement</th><th>Validator</th><th>Date</th></tr></thead>
            <tbody>
              {validations.map((v) => (
                <tr key={v.id}>
                  <td><span data-component="role-badge">{v.teeArch}</span></td>
                  <td><span data-component="role-badge" data-status="active">{v.method}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.7rem' }} title={v.codeMeasurement}>{v.codeMeasurement.slice(0, 10)}...{v.codeMeasurement.slice(-8)}</td>
                  <td>{v.validatedBy}</td>
                  <td style={{ fontSize: '0.8rem', color: '#616161' }}>{v.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ─── Disputes ──────────────────────────────────────────────── */}
      <section data-component="graph-section">
        <h2>Disputes ({disputes.length})</h2>
        {disputes.length === 0 ? <p data-component="text-muted">No disputes filed.</p> : (
          <table data-component="graph-table">
            <thead><tr><th>Filed By</th><th>Type</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id}>
                  <td>{d.filedBy}</td>
                  <td><span data-component="role-badge">{d.type}</span></td>
                  <td><span data-component="role-badge" data-status={d.status === 'open' ? 'proposed' : d.status === 'upheld' ? 'revoked' : 'active'}>{d.status}</span></td>
                  <td style={{ maxWidth: 300, fontSize: '0.8rem', color: '#616161' }}>{d.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ─── Governance ────────────────────────────────────────────── */}
      <section data-component="graph-section">
        <h2>Governance</h2>
        <AgentSettingsClient
          agentAddress={agentAddress}
          agentName={agentName}
          controlAddress={controlAddr}
          governanceInitialized={governanceInitialized}
          governanceConfig={governanceConfig}
          governanceOwners={governanceOwners}
        />
      </section>
    </div>
  )
}
