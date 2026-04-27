import { getPublicClient } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  AGENT_TYPE_LABELS, AI_CLASS_LABELS,
  ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE,
  ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT,
} from '@smart-agent/sdk'
import { db, schema } from '@/db'

/**
 * Unified agent metadata — reads from on-chain resolver.
 * No DB fallback for name/description — resolver is source of truth.
 */
export interface AgentMetadata {
  address: string
  displayName: string
  description: string
  /** Primary .agent name (e.g., "david.fortcollins.catalyst.agent") */
  primaryName: string
  /** Name label at this level (e.g., "david") */
  nameLabel: string
  agentType: 'person' | 'org' | 'ai' | 'unknown'
  agentTypeLabel: string
  aiAgentClass: string
  capabilities: string[]
  trustModels: string[]
  a2aEndpoint: string
  mcpServer: string
  metadataURI: string
  isResolverRegistered: boolean
  isActive: boolean
  latitude: string
  longitude: string
  spatialCRS: string
  spatialType: string
}

const TYPE_MAP: Record<string, 'person' | 'org' | 'ai'> = {
  [TYPE_PERSON]: 'person',
  [TYPE_ORGANIZATION]: 'org',
  [TYPE_AI_AGENT]: 'ai',
}

/**
 * Load metadata for a single agent from on-chain resolver.
 */
export async function getAgentMetadata(agentAddress: string): Promise<AgentMetadata> {
  const addr = agentAddress as `0x${string}`
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`

  const meta: AgentMetadata = {
    address: agentAddress,
    displayName: `${agentAddress.slice(0, 6)}...${agentAddress.slice(-4)}`,
    description: '',
    primaryName: '',
    nameLabel: '',
    agentType: 'unknown',
    agentTypeLabel: 'Unknown',
    aiAgentClass: '',
    capabilities: [],
    trustModels: [],
    a2aEndpoint: '',
    mcpServer: '',
    metadataURI: '',
    isResolverRegistered: false,
    isActive: true,
    latitude: '', longitude: '', spatialCRS: '', spatialType: '',
  }

  // Agent kind will be set from resolver agentType below

  // On-chain resolver (source of truth)
  if (resolverAddr) {
    try {
      const client = getPublicClient()
      const isReg = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'isRegistered', args: [addr],
      }) as boolean

      if (isReg) {
        meta.isResolverRegistered = true
        const core = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getCore', args: [addr],
        }) as { displayName: string; description: string; agentType: `0x${string}`; agentClass: `0x${string}`; metadataURI: string; active: boolean }

        if (core.displayName) meta.displayName = core.displayName
        if (core.description) meta.description = core.description
        if (core.metadataURI) meta.metadataURI = core.metadataURI
        meta.isActive = core.active

        if (TYPE_MAP[core.agentType]) {
          meta.agentType = TYPE_MAP[core.agentType]
          meta.agentTypeLabel = AGENT_TYPE_LABELS[core.agentType] ?? meta.agentTypeLabel
        }
        if (AI_CLASS_LABELS[core.agentClass]) {
          meta.aiAgentClass = AI_CLASS_LABELS[core.agentClass]
        }

        meta.capabilities = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getMultiStringProperty', args: [addr, ATL_CAPABILITY as `0x${string}`] }) as string[]
        meta.trustModels = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getMultiStringProperty', args: [addr, ATL_SUPPORTED_TRUST as `0x${string}`] }) as string[]
        meta.primaryName = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [addr, ATL_PRIMARY_NAME as `0x${string}`] }) as string
        meta.nameLabel = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [addr, ATL_NAME_LABEL as `0x${string}`] }) as string
        meta.a2aEndpoint = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [addr, ATL_A2A_ENDPOINT as `0x${string}`] }) as string
        meta.mcpServer = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [addr, ATL_MCP_SERVER as `0x${string}`] }) as string
        meta.latitude = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [addr, ATL_LATITUDE as `0x${string}`] }) as string
        meta.longitude = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [addr, ATL_LONGITUDE as `0x${string}`] }) as string
        meta.spatialCRS = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [addr, ATL_SPATIAL_CRS as `0x${string}`] }) as string
        meta.spatialType = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [addr, ATL_SPATIAL_TYPE as `0x${string}`] }) as string
      }
    } catch { /* ignored */ }
  }

  return meta
}

/**
 * Build name lookup map from on-chain resolver.
 */
export async function buildAgentNameMap(): Promise<Map<string, { name: string; type: string }>> {
  const nameMap = new Map<string, { name: string; type: string }>()

  // User EOA names
  const allUsers = await db.select().from(schema.users)
  for (const u of allUsers) nameMap.set(u.walletAddress.toLowerCase(), { name: u.name, type: 'eoa' })

  // On-chain resolver (source of truth for names and types). Fan out
  // getAgentAt + getCore in parallel — sequential awaits used to dominate
  // the network page's render time.
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (resolverAddr) {
    try {
      const client = getPublicClient()
      const count = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount' }) as bigint
      const indices = Array.from({ length: Number(count) }, (_, i) => BigInt(i))
      const addrs = await Promise.all(indices.map(i =>
        client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getAgentAt', args: [i] }) as Promise<`0x${string}`>,
      ))
      const cores = await Promise.all(addrs.map(a =>
        (client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [a] }) as Promise<{ displayName: string; agentType: `0x${string}` }>)
          .catch(() => null),
      ))
      for (let i = 0; i < addrs.length; i++) {
        const core = cores[i]
        if (!core?.displayName) continue
        const agentAddr = addrs[i]
        const type = TYPE_MAP[core.agentType] ?? nameMap.get(agentAddr.toLowerCase())?.type ?? 'unknown'
        nameMap.set(agentAddr.toLowerCase(), { name: core.displayName, type })
      }
    } catch { /* ignored */ }
  }

  return nameMap
}

export function getNameFromMap(map: Map<string, { name: string; type: string }>, addr: string): string {
  return map.get(addr.toLowerCase())?.name ?? `${addr.slice(0, 6)}...${addr.slice(-4)}`
}
