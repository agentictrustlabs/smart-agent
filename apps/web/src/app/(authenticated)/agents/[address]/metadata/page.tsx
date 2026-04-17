import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  AI_CLASS_LABELS,
  ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
  ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT,
} from '@smart-agent/sdk'
import { MetadataEditorClient } from './MetadataEditorClient'
import { AgentSubNav } from '@/components/nav/AgentSubNav'

export default async function MetadataEditorPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const agentAddress = address as `0x${string}`
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  const client = getPublicClient()

  // Get agent identity from on-chain resolver
  const { getAgentMetadata } = await import('@/lib/agent-metadata')
  const agentMeta = await getAgentMetadata(agentAddress)
  const agentName = agentMeta.displayName
  const dbAgentType = agentMeta.agentType === 'unknown' ? 'person' : agentMeta.agentType
  const dbAiClass = agentMeta.aiAgentClass
  const dbDescription = agentMeta.description

  // Load existing resolver data
  let initial = {
    displayName: agentName,
    description: dbDescription,
    agentType: dbAgentType,
    aiAgentClass: dbAiClass,
    capabilities: [] as string[],
    trustModels: [] as string[],
    a2aEndpoint: '',
    mcpServer: '',
    primaryName: agentMeta.primaryName,
    nameLabel: agentMeta.nameLabel,
    isRegistered: false,
  }

  try {
    if (resolverAddr) {
      const isReg = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'isRegistered', args: [agentAddress],
      }) as boolean

      if (isReg) {
        const core = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getCore', args: [agentAddress],
        }) as { displayName: string; description: string; agentType: `0x${string}`; agentClass: `0x${string}`; active: boolean }

        const typeMap: Record<string, 'person' | 'org' | 'ai'> = {
          [TYPE_PERSON]: 'person', [TYPE_ORGANIZATION]: 'org', [TYPE_AI_AGENT]: 'ai',
        }

        const classMap: Record<string, string> = {}
        for (const [k, v] of Object.entries(AI_CLASS_LABELS)) {
          classMap[k] = v.toLowerCase()
        }

        const caps = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiStringProperty',
          args: [agentAddress, ATL_CAPABILITY as `0x${string}`],
        }) as string[]

        const trusts = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiStringProperty',
          args: [agentAddress, ATL_SUPPORTED_TRUST as `0x${string}`],
        }) as string[]

        const a2a = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [agentAddress, ATL_A2A_ENDPOINT as `0x${string}`],
        }) as string

        const mcp = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [agentAddress, ATL_MCP_SERVER as `0x${string}`],
        }) as string

        initial = {
          displayName: core.displayName,
          description: core.description,
          agentType: typeMap[core.agentType] ?? 'person',
          aiAgentClass: classMap[core.agentClass] ?? '',
          capabilities: caps,
          trustModels: trusts,
          a2aEndpoint: a2a,
          mcpServer: mcp,
          primaryName: agentMeta.primaryName,
          nameLabel: agentMeta.nameLabel,
          isRegistered: true,
        }
      }
    }
  } catch { /* resolver may not be deployed */ }

  return (
    <div data-page="metadata-editor">
      <div data-component="page-header">
        <div data-component="section-header">
          <h1>{agentName}</h1>
          <Link href={`/agents/${agentAddress}`} data-component="section-action">Back to Agent</Link>
        </div>
        <p>Manage this agent&apos;s profile — name, description, capabilities, and service endpoints.
          Changes are saved to the on-chain registry where other organizations and agents can discover them.</p>
      </div>

      <AgentSubNav address={agentAddress} />

      <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
        <dl>
          <dt>Agent</dt><dd data-component="address">{agentAddress}</dd>
          <dt>Resolver</dt><dd data-component="address">{resolverAddr}</dd>
          <dt>Profile</dt><dd><span data-component="role-badge" data-status={initial.isRegistered ? 'active' : 'proposed'}>{initial.isRegistered ? 'Published' : 'Draft'}</span></dd>
        </dl>
      </div>

      {/* .agent Name Section */}
      <div className="mb-4 rounded-md border border-outline-variant bg-white p-5 shadow-elevation-1">
        <h3 className="text-label-lg text-primary uppercase tracking-wider font-bold mb-3">.agent Namespace</h3>
        {initial.primaryName ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-label-md text-on-surface-variant">Primary Name</span>
              <span className="font-mono text-title-sm font-semibold text-primary">{initial.primaryName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-label-md text-on-surface-variant">Label</span>
              <span className="font-mono text-body-md text-on-surface">{initial.nameLabel}</span>
            </div>
            <div className="pt-2">
              <Link href={`/explorer`} className="text-label-lg text-primary font-semibold no-underline hover:text-primary/80 transition-colors">
                Open in Namespace Explorer →
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-body-md text-on-surface-variant mb-3">This agent does not have a .agent name registered.</p>
            <Link href={`/explorer`} className="text-label-lg text-primary font-semibold no-underline hover:text-primary/80 transition-colors">
              Register in Namespace Explorer →
            </Link>
          </div>
        )}
      </div>

      <MetadataEditorClient agentAddress={agentAddress} agentName={agentName} chainId={Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')} initial={initial} />
    </div>
  )
}
