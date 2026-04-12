import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  AI_CLASS_LABELS,
  ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT,
} from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { MetadataEditorClient } from './MetadataEditorClient'
import { AgentSubNav } from '@/components/nav/AgentSubNav'

export default async function MetadataEditorPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const agentAddress = address as `0x${string}`
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  const client = getPublicClient()

  // Get agent name from DB (fallback)
  let agentName = 'Agent'
  let dbAgentType = 'person'
  let dbAiClass = ''
  let dbDescription = ''
  const org = await db.select().from(schema.orgAgents).where(eq(schema.orgAgents.smartAccountAddress, agentAddress)).limit(1)
  if (org[0]) { agentName = org[0].name; dbAgentType = 'org'; dbDescription = org[0].description ?? '' }
  const ai = await db.select().from(schema.aiAgents).where(eq(schema.aiAgents.smartAccountAddress, agentAddress)).limit(1)
  if (ai[0]) { agentName = ai[0].name; dbAgentType = 'ai'; dbAiClass = ai[0].agentType ?? 'custom'; dbDescription = ai[0].description ?? '' }
  const person = await db.select().from(schema.personAgents).where(eq(schema.personAgents.smartAccountAddress, agentAddress)).limit(1)
  if (person[0]) { agentName = person[0].name; dbAgentType = 'person' }

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

        const typeMap: Record<string, string> = {
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

      <MetadataEditorClient agentAddress={agentAddress} agentName={agentName} chainId={Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')} initial={initial} />
    </div>
  )
}
