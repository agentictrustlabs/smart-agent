'use server'

import { requireSession } from '@/lib/auth/session'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT,
  CLASS_DISCOVERY, CLASS_VALIDATOR, CLASS_EXECUTOR, CLASS_ASSISTANT, CLASS_ORACLE, CLASS_CUSTOM,
  ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
} from '@smart-agent/sdk'


const AGENT_TYPE_MAP: Record<string, `0x${string}`> = {
  person: TYPE_PERSON as `0x${string}`,
  org: TYPE_ORGANIZATION as `0x${string}`,
  ai: TYPE_AI_AGENT as `0x${string}`,
}

const AI_CLASS_MAP: Record<string, `0x${string}`> = {
  discovery: CLASS_DISCOVERY as `0x${string}`,
  validator: CLASS_VALIDATOR as `0x${string}`,
  executor: CLASS_EXECUTOR as `0x${string}`,
  assistant: CLASS_ASSISTANT as `0x${string}`,
  oracle: CLASS_ORACLE as `0x${string}`,
  custom: CLASS_CUSTOM as `0x${string}`,
}

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

    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    if (!resolverAddr) return { success: false, error: 'Resolver not deployed' }

    const walletClient = getWalletClient()
    const publicClient = getPublicClient()
    const agentAddr = input.agentAddress as `0x${string}`

    const agentType = AGENT_TYPE_MAP[input.agentType] ?? AGENT_TYPE_MAP.person
    const agentClass = input.aiAgentClass ? (AI_CLASS_MAP[input.aiAgentClass] ?? ZERO_BYTES32) : ZERO_BYTES32

    // Check if already registered
    const isReg = await publicClient.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'isRegistered', args: [agentAddr],
    }) as boolean

    if (isReg) {
      // Update existing
      const hash = await walletClient.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'updateCore',
        args: [agentAddr, input.displayName, input.description, agentType, agentClass],
      })
      await publicClient.waitForTransactionReceipt({ hash })
    } else {
      // Register new
      const hash = await walletClient.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'register',
        args: [agentAddr, input.displayName, input.description, agentType, agentClass, ''],
      })
      await publicClient.waitForTransactionReceipt({ hash })
    }

    // Set multi-value properties
    if (input.capabilities && input.capabilities.length > 0) {
      // Clear existing
      await walletClient.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'clearMultiStringProperty',
        args: [agentAddr, ATL_CAPABILITY as `0x${string}`],
      }).then(h => publicClient.waitForTransactionReceipt({ hash: h }))

      for (const cap of input.capabilities) {
        if (!cap.trim()) continue
        const h = await walletClient.writeContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'addMultiStringProperty',
          args: [agentAddr, ATL_CAPABILITY as `0x${string}`, cap.trim()],
        })
        await publicClient.waitForTransactionReceipt({ hash: h })
      }
    }

    if (input.trustModels && input.trustModels.length > 0) {
      await walletClient.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'clearMultiStringProperty',
        args: [agentAddr, ATL_SUPPORTED_TRUST as `0x${string}`],
      }).then(h => publicClient.waitForTransactionReceipt({ hash: h }))

      for (const tm of input.trustModels) {
        if (!tm.trim()) continue
        const h = await walletClient.writeContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'addMultiStringProperty',
          args: [agentAddr, ATL_SUPPORTED_TRUST as `0x${string}`, tm.trim()],
        })
        await publicClient.waitForTransactionReceipt({ hash: h })
      }
    }

    // Set endpoint properties
    if (input.a2aEndpoint) {
      const h = await walletClient.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'setStringProperty',
        args: [agentAddr, ATL_A2A_ENDPOINT as `0x${string}`, input.a2aEndpoint],
      })
      await publicClient.waitForTransactionReceipt({ hash: h })
    }

    if (input.mcpServer) {
      const h = await walletClient.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'setStringProperty',
        args: [agentAddr, ATL_MCP_SERVER as `0x${string}`, input.mcpServer],
      })
      await publicClient.waitForTransactionReceipt({ hash: h })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to register metadata' }
  }
}

/**
 * Generate a JSON-LD metadata document from on-chain resolver data.
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

    // Map bytes32 type/class to readable strings
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

    // Read .agent name for the JSON-LD document
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
