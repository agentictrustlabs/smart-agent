'use server'

/**
 * Phase 4 — Web→MCP rewiring.
 *
 * Previously this file used the deployer wallet (`getWalletClient()`) to
 * write directly to AgentAccountResolver. Now it routes those writes
 * through the org-mcp `agent_resolver:register` /
 * `agent_resolver:set_address_property` tools, which forward to a2a-agent's
 * stateless-redeem path.
 *
 * Reads (generateMetadataJsonLd) still use the public client directly —
 * reads are not gated.
 */

import { requireSession } from '@/lib/auth/session'
import { getPublicClient } from '@/lib/contracts'
import { callMcp } from '@/lib/clients/mcp-client'
import {
  agentAccountResolverAbi,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT,
  CLASS_DISCOVERY, CLASS_VALIDATOR, CLASS_EXECUTOR, CLASS_ASSISTANT, CLASS_ORACLE,
  ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
} from '@smart-agent/sdk'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

export interface RegisterAgentMetadataInput {
  agentAddress: string
  displayName: string
  description: string
  agentType: string       // 'person' | 'org' | 'ai'
  aiAgentClass?: string   // 'discovery' | 'validator' | etc.
  capabilities?: string[]
  trustModels?: string[]
  a2aEndpoint?: string
  mcpServer?: string
}

export async function registerAgentMetadata(input: RegisterAgentMetadataInput) {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'Not connected' }

    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (!resolverAddr) return { success: false, error: 'Resolver not deployed' }

    // Map the action layer's `agentType` slug to the canonical string the
    // MCP tool understands (`person` | `org` | `ai`). The tool will
    // re-resolve to the bytes32 constant.
    const typeSlug = input.agentType === 'org' ? 'org'
                   : input.agentType === 'ai'  ? 'ai'
                   : 'person'

    await callMcp(
      'org',
      'agent_resolver:register',
      {
        agentAddress: input.agentAddress,
        displayName: input.displayName,
        description: input.description ?? '',
        agentType: typeSlug,
        aiAgentClass: input.aiAgentClass,
        capabilities: input.capabilities,
        trustModels: input.trustModels,
        a2aEndpoint: input.a2aEndpoint,
        mcpServer: input.mcpServer,
      },
      { agentAddress: input.agentAddress },
    )

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to register metadata' }
  }
}

/**
 * Generate a JSON-LD metadata document from on-chain resolver data.
 * Read-only — uses the public client; no MCP hop.
 */
export async function generateMetadataJsonLd(agentAddress: string) {
  try {
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    if (!resolverAddr) return { success: false, error: 'Resolver not deployed' }

    const client = getPublicClient()
    const agentAddr = agentAddress as `0x${string}`
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

    const core = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getCore', args: [agentAddr],
    }) as {
      displayName: string; description: string; agentType: `0x${string}`
      agentClass: `0x${string}`; metadataURI: string; active: boolean
    }

    const capabilities = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getMultiStringProperty',
      args: [agentAddr, ATL_CAPABILITY as `0x${string}`],
    }) as string[]

    const trustModels = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getMultiStringProperty',
      args: [agentAddr, ATL_SUPPORTED_TRUST as `0x${string}`],
    }) as string[]

    const a2a = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getStringProperty',
      args: [agentAddr, ATL_A2A_ENDPOINT as `0x${string}`],
    }) as string

    const mcp = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getStringProperty',
      args: [agentAddr, ATL_MCP_SERVER as `0x${string}`],
    }) as string

    const typeLabels: Record<string, string> = {
      [TYPE_PERSON]: 'sa:PersonAgent',
      [TYPE_ORGANIZATION]: 'sa:OrganizationAgent',
      [TYPE_AI_AGENT]: 'sa:AIAgentAccount',
    }
    const classLabels: Record<string, string> = {
      [CLASS_DISCOVERY]: 'atl:DiscoveryAgent',
      [CLASS_VALIDATOR]: 'atl:ValidatorAgent',
      [CLASS_EXECUTOR]: 'atl:ExecutorAgent',
      [CLASS_ASSISTANT]: 'atl:AssistantAgent',
      [CLASS_ORACLE]: 'atl:OracleAgent',
    }

    const agentTypeName = typeLabels[core.agentType] ?? 'sa:Agent'
    const rdfType = classLabels[core.agentClass] || agentTypeName

    let primaryName = ''
    try {
      const { ATL_PRIMARY_NAME: PN } = await import('@smart-agent/sdk')
      primaryName = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty', args: [agentAddr, PN as `0x${string}`],
      }) as string
    } catch { /* */ }

    const doc: Record<string, unknown> = {
      '@context': 'https://smartagent.io/ontology/context.jsonld',
      '@id': primaryName || `did:ethr:${chainId}:${agentAddress}`,
      '@type': rdfType,
      accountAddress: agentAddress,
      displayName: core.displayName,
      isActive: core.active,
      agentType: agentTypeName,
    }

    if (primaryName) doc.primaryName = primaryName
    if (core.description) doc.description = core.description
    if (core.agentClass !== ZERO_BYTES32) doc.aiAgentClass = classLabels[core.agentClass]
    if (capabilities.length > 0) doc.hasCapability = capabilities
    if (trustModels.length > 0) doc.supportedTrustModel = trustModels
    if (a2a) doc.hasA2AEndpoint = a2a
    if (mcp) doc.hasMCPServer = mcp

    return { success: true, document: doc }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to generate JSON-LD' }
  }
}
