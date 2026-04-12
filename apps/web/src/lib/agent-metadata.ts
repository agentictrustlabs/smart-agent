import { getPublicClient } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  AGENT_TYPE_LABELS, AI_CLASS_LABELS,
  ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT,
} from '@smart-agent/sdk'
import { db, schema } from '@/db'

/**
 * Unified agent metadata — merges on-chain resolver data with DB fallback.
 * Use this everywhere instead of querying DB tables directly for agent info.
 */
export interface AgentMetadata {
  address: string
  displayName: string
  description: string
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
  // Geospatial
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
 * Load metadata for a single agent, resolver-first with DB fallback.
 */
export async function getAgentMetadata(agentAddress: string): Promise<AgentMetadata> {
  const addr = agentAddress as `0x${string}`
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`

  // Start with defaults
  const meta: AgentMetadata = {
    address: agentAddress,
    displayName: `${agentAddress.slice(0, 6)}...${agentAddress.slice(-4)}`,
    description: '',
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
    latitude: '',
    longitude: '',
    spatialCRS: '',
    spatialType: '',
  }

  // DB fallback first
  const allOrgs = await db.select().from(schema.orgAgents)
  const allAI = await db.select().from(schema.aiAgents)
  const allPerson = await db.select().from(schema.personAgents)

  const org = allOrgs.find(o => o.smartAccountAddress.toLowerCase() === addr.toLowerCase())
  const ai = allAI.find(a => a.smartAccountAddress.toLowerCase() === addr.toLowerCase())
  const person = allPerson.find(p => p.smartAccountAddress.toLowerCase() === addr.toLowerCase())

  if (org) {
    meta.displayName = org.name
    meta.description = org.description ?? ''
    meta.agentType = 'org'
    meta.agentTypeLabel = 'Organization'
  } else if (ai) {
    meta.displayName = ai.name
    meta.description = ai.description ?? ''
    meta.agentType = 'ai'
    meta.agentTypeLabel = 'AI Agent'
    meta.aiAgentClass = ai.agentType ?? ''
  } else if (person) {
    meta.displayName = person.name
    meta.agentType = 'person'
    meta.agentTypeLabel = 'Person Agent'
  }

  // On-chain resolver override
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
        }) as {
          displayName: string; description: string
          agentType: `0x${string}`; agentClass: `0x${string}`
          metadataURI: string; active: boolean
        }

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

        meta.capabilities = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiStringProperty',
          args: [addr, ATL_CAPABILITY as `0x${string}`],
        }) as string[]

        meta.trustModels = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiStringProperty',
          args: [addr, ATL_SUPPORTED_TRUST as `0x${string}`],
        }) as string[]

        meta.a2aEndpoint = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [addr, ATL_A2A_ENDPOINT as `0x${string}`],
        }) as string

        meta.mcpServer = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [addr, ATL_MCP_SERVER as `0x${string}`],
        }) as string

        // Geospatial
        meta.latitude = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [addr, ATL_LATITUDE as `0x${string}`],
        }) as string
        meta.longitude = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [addr, ATL_LONGITUDE as `0x${string}`],
        }) as string
        meta.spatialCRS = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [addr, ATL_SPATIAL_CRS as `0x${string}`],
        }) as string
        meta.spatialType = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [addr, ATL_SPATIAL_TYPE as `0x${string}`],
        }) as string
      }
    } catch { /* resolver not deployed or agent not registered */ }
  }

  return meta
}

/**
 * Build a name lookup map for all known agents (resolver-first, DB fallback).
 * Cheaper than calling getAgentMetadata for every address — bulk loads from DB
 * then overrides with resolver names for registered agents.
 */
export async function buildAgentNameMap(): Promise<Map<string, { name: string; type: string }>> {
  const nameMap = new Map<string, { name: string; type: string }>()

  // DB baseline
  const allOrgs = await db.select().from(schema.orgAgents)
  const allAI = await db.select().from(schema.aiAgents)
  const allPerson = await db.select().from(schema.personAgents)
  const allUsers = await db.select().from(schema.users)

  for (const p of allPerson) {
    const u = allUsers.find(u => u.id === p.userId)
    nameMap.set(p.smartAccountAddress.toLowerCase(), { name: p.name || u?.name || 'Person Agent', type: 'person' })
  }
  for (const o of allOrgs) nameMap.set(o.smartAccountAddress.toLowerCase(), { name: o.name, type: 'org' })
  for (const a of allAI) nameMap.set(a.smartAccountAddress.toLowerCase(), { name: a.name, type: 'ai' })
  for (const u of allUsers) nameMap.set(u.walletAddress.toLowerCase(), { name: u.name, type: 'eoa' })

  // Resolver override for registered agents
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (resolverAddr) {
    try {
      const client = getPublicClient()
      const count = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'agentCount',
      }) as bigint

      for (let i = 0n; i < count; i++) {
        const agentAddr = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getAgentAt', args: [i],
        }) as `0x${string}`

        const core = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getCore', args: [agentAddr],
        }) as { displayName: string; agentType: `0x${string}` }

        if (core.displayName) {
          const type = TYPE_MAP[core.agentType] ?? nameMap.get(agentAddr.toLowerCase())?.type ?? 'unknown'
          nameMap.set(agentAddr.toLowerCase(), { name: core.displayName, type })
        }
      }
    } catch { /* resolver not deployed */ }
  }

  return nameMap
}

/**
 * Simple name lookup — returns display name for an address.
 */
export function getNameFromMap(map: Map<string, { name: string; type: string }>, addr: string): string {
  return map.get(addr.toLowerCase())?.name ?? `${addr.slice(0, 6)}...${addr.slice(-4)}`
}
