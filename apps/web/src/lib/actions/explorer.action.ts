'use server'

import { getPublicClient } from '@/lib/contracts'
import { getAgentMetadata } from '@/lib/agent-metadata'
import {
  agentNameRegistryAbi, agentNameResolverAbi, agentNameUniversalResolverAbi,
  agentAccountResolverAbi, namehash, labelhash,
  ATL_PRIMARY_NAME,
} from '@smart-agent/sdk'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

// ─── Types ─────────────────────────────────────────────────────────

export interface ExplorerNode {
  node: string          // namehash
  label: string         // this level's label
  fullName: string      // full .agent name
  ownerAddress: string
  ownerName: string
  agentType: string     // person, org, ai, hub, unknown
  resolverAddress: string
  childCount: number
  registeredAt: number
  expiry: number
  isExpired: boolean
  primaryName: string
}

export interface ExplorerRecord {
  key: string
  value: string
  type: 'addr' | 'text' | 'agent'
}

export interface ExplorerRelationship {
  edgeId: string
  direction: 'outgoing' | 'incoming'
  counterparty: string
  counterpartyName: string
  counterpartyAgentName: string
  relationshipType: string
  roles: string[]
  status: number
}

export interface RegistryStats {
  totalNames: number
  rootChildren: number
  personCount: number
  orgCount: number
  aiCount: number
  hubCount: number
}

// ─── Helpers ───────────────────────────────────────────────────────

function getRegistryAddr(): `0x${string}` | null {
  return (process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}`) || null
}
function getResolverAddr(): `0x${string}` | null {
  return (process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}`) || null
}
function getUniversalAddr(): `0x${string}` | null {
  return (process.env.AGENT_NAME_UNIVERSAL_RESOLVER_ADDRESS as `0x${string}`) || null
}

// ─── Tree Operations ───────────────────────────────────────────────

/**
 * Get children of a name node. Returns enriched nodes with agent metadata.
 */
export async function getExplorerChildren(parentNode: string): Promise<ExplorerNode[]> {
  const registryAddr = getRegistryAddr()
  if (!registryAddr) return []

  const client = getPublicClient()
  const results: ExplorerNode[] = []

  try {
    const labelhashes = await client.readContract({
      address: registryAddr, abi: agentNameRegistryAbi,
      functionName: 'childLabelhashes', args: [parentNode as `0x${string}`],
    }) as `0x${string}`[]

    for (const lh of labelhashes) {
      const childNodeHash = await client.readContract({
        address: registryAddr, abi: agentNameRegistryAbi,
        functionName: 'childNode', args: [parentNode as `0x${string}`, lh],
      }) as `0x${string}`

      const owner = await client.readContract({
        address: registryAddr, abi: agentNameRegistryAbi,
        functionName: 'owner', args: [childNodeHash],
      }) as `0x${string}`

      const resolver = await client.readContract({
        address: registryAddr, abi: agentNameRegistryAbi,
        functionName: 'resolver', args: [childNodeHash],
      }) as `0x${string}`

      const childCount = await client.readContract({
        address: registryAddr, abi: agentNameRegistryAbi,
        functionName: 'childCount', args: [childNodeHash],
      }) as bigint

      const regAt = await client.readContract({
        address: registryAddr, abi: agentNameRegistryAbi,
        functionName: 'registeredAt', args: [childNodeHash],
      }) as bigint

      const exp = await client.readContract({
        address: registryAddr, abi: agentNameRegistryAbi,
        functionName: 'expiry', args: [childNodeHash],
      }) as bigint

      const isExp = await client.readContract({
        address: registryAddr, abi: agentNameRegistryAbi,
        functionName: 'isExpired', args: [childNodeHash],
      }) as boolean

      // Get agent metadata for display
      const meta = await getAgentMetadata(owner)

      results.push({
        node: childNodeHash,
        label: meta.nameLabel || '?',
        fullName: meta.primaryName || '',
        ownerAddress: owner,
        ownerName: meta.displayName,
        agentType: meta.agentType,
        resolverAddress: resolver,
        childCount: Number(childCount),
        registeredAt: Number(regAt),
        expiry: Number(exp),
        isExpired: isExp,
        primaryName: meta.primaryName,
      })
    }
  } catch (e) {
    console.warn('[explorer] getExplorerChildren failed:', e)
  }

  return results.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Get the root .agent node info.
 */
export async function getExplorerRoot(): Promise<{ node: string; childCount: number } | null> {
  const registryAddr = getRegistryAddr()
  if (!registryAddr) return null

  const client = getPublicClient()
  try {
    const root = await client.readContract({
      address: registryAddr, abi: agentNameRegistryAbi, functionName: 'AGENT_ROOT',
    }) as `0x${string}`

    const childCount = await client.readContract({
      address: registryAddr, abi: agentNameRegistryAbi,
      functionName: 'childCount', args: [root],
    }) as bigint

    return { node: root, childCount: Number(childCount) }
  } catch { return null }
}

/**
 * Get full detail for a specific name node.
 */
export async function getExplorerNodeDetail(nodeHash: string): Promise<ExplorerNode | null> {
  const registryAddr = getRegistryAddr()
  if (!registryAddr) return null

  const client = getPublicClient()
  try {
    const exists = await client.readContract({
      address: registryAddr, abi: agentNameRegistryAbi,
      functionName: 'recordExists', args: [nodeHash as `0x${string}`],
    }) as boolean
    if (!exists) return null

    const owner = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'owner', args: [nodeHash as `0x${string}`] }) as `0x${string}`
    const resolver = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'resolver', args: [nodeHash as `0x${string}`] }) as `0x${string}`
    const childCount = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'childCount', args: [nodeHash as `0x${string}`] }) as bigint
    const regAt = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'registeredAt', args: [nodeHash as `0x${string}`] }) as bigint
    const exp = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'expiry', args: [nodeHash as `0x${string}`] }) as bigint
    const isExp = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'isExpired', args: [nodeHash as `0x${string}`] }) as boolean

    const meta = await getAgentMetadata(owner)

    return {
      node: nodeHash,
      label: meta.nameLabel || '?',
      fullName: meta.primaryName || '',
      ownerAddress: owner,
      ownerName: meta.displayName,
      agentType: meta.agentType,
      resolverAddress: resolver,
      childCount: Number(childCount),
      registeredAt: Number(regAt),
      expiry: Number(exp),
      isExpired: isExp,
      primaryName: meta.primaryName,
    }
  } catch { return null }
}

// ─── Records ───────────────────────────────────────────────────────

/**
 * Get all records for a name node (addr + agent metadata).
 */
export async function getExplorerRecords(ownerAddress: string): Promise<ExplorerRecord[]> {
  const records: ExplorerRecord[] = []

  try {
    const meta = await getAgentMetadata(ownerAddress)
    records.push({ key: 'displayName', value: meta.displayName, type: 'agent' })
    records.push({ key: 'description', value: meta.description, type: 'agent' })
    records.push({ key: 'agentType', value: meta.agentType, type: 'agent' })
    if (meta.primaryName) records.push({ key: '.agent name', value: meta.primaryName, type: 'agent' })
    if (meta.a2aEndpoint) records.push({ key: 'a2aEndpoint', value: meta.a2aEndpoint, type: 'text' })
    if (meta.mcpServer) records.push({ key: 'mcpServer', value: meta.mcpServer, type: 'text' })
    if (meta.capabilities.length) records.push({ key: 'capabilities', value: meta.capabilities.join(', '), type: 'agent' })
    if (meta.trustModels.length) records.push({ key: 'trustModels', value: meta.trustModels.join(', '), type: 'agent' })
    if (meta.latitude) records.push({ key: 'latitude', value: meta.latitude, type: 'text' })
    if (meta.longitude) records.push({ key: 'longitude', value: meta.longitude, type: 'text' })
    records.push({ key: 'addr(ETH)', value: ownerAddress, type: 'addr' })
    records.push({ key: 'active', value: meta.isActive ? 'true' : 'false', type: 'agent' })
  } catch { /* agent not in resolver */ }

  return records
}

// ─── Relationships ─────────────────────────────────────────────────

export async function getExplorerRelationships(agentAddress: string): Promise<ExplorerRelationship[]> {
  const { getEdgesBySubject, getEdgesByObject, getEdge, getEdgeRoles } = await import('@/lib/contracts')
  const { relationshipTypeName, roleName } = await import('@smart-agent/sdk')

  const results: ExplorerRelationship[] = []

  try {
    // Outgoing edges
    const outEdgeIds = await getEdgesBySubject(agentAddress as `0x${string}`)
    for (const edgeId of outEdgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      const roles = await getEdgeRoles(edgeId)
      const counterMeta = await getAgentMetadata(edge.object_)
      results.push({
        edgeId,
        direction: 'outgoing',
        counterparty: edge.object_,
        counterpartyName: counterMeta.displayName,
        counterpartyAgentName: counterMeta.primaryName,
        relationshipType: relationshipTypeName(edge.relationshipType),
        roles: roles.map(r => roleName(r)),
        status: edge.status,
      })
    }

    // Incoming edges
    const inEdgeIds = await getEdgesByObject(agentAddress as `0x${string}`)
    for (const edgeId of inEdgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      const roles = await getEdgeRoles(edgeId)
      const counterMeta = await getAgentMetadata(edge.subject)
      results.push({
        edgeId,
        direction: 'incoming',
        counterparty: edge.subject,
        counterpartyName: counterMeta.displayName,
        counterpartyAgentName: counterMeta.primaryName,
        relationshipType: relationshipTypeName(edge.relationshipType),
        roles: roles.map(r => roleName(r)),
        status: edge.status,
      })
    }
  } catch { /* edges unavailable */ }

  return results
}

// ─── Stats ─────────────────────────────────────────────────────────

export async function getRegistryStats(): Promise<RegistryStats> {
  const registryAddr = getRegistryAddr()
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!registryAddr || !resolverAddr) return { totalNames: 0, rootChildren: 0, personCount: 0, orgCount: 0, aiCount: 0, hubCount: 0 }

  const client = getPublicClient()

  try {
    const root = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'AGENT_ROOT' }) as `0x${string}`
    const rootChildren = Number(await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'childCount', args: [root] }) as bigint)

    // Count total registered agents (proxy for total names)
    const totalAgents = Number(await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount' }) as bigint)

    // Count by type — iterate agents
    let personCount = 0, orgCount = 0, aiCount = 0, hubCount = 0
    for (let i = 0; i < Math.min(totalAgents, 100); i++) {
      try {
        const addr = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getAgentAt', args: [BigInt(i)] }) as `0x${string}`
        const meta = await getAgentMetadata(addr)
        if (meta.agentType === 'person') personCount++
        else if (meta.agentType === 'org') orgCount++
        else if (meta.agentType === 'ai') aiCount++
        else if (meta.displayName.toLowerCase().includes('hub')) hubCount++
      } catch { break }
    }

    return { totalNames: totalAgents, rootChildren, personCount, orgCount, aiCount, hubCount }
  } catch {
    return { totalNames: 0, rootChildren: 0, personCount: 0, orgCount: 0, aiCount: 0, hubCount: 0 }
  }
}

// ─── Resolution ────────────────────────────────────────────────────

export async function resolveAgentName(name: string): Promise<{ address: string; node: string } | null> {
  const registryAddr = getRegistryAddr()
  if (!registryAddr) return null

  try {
    const node = namehash(name)
    const client = getPublicClient()
    const exists = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'recordExists', args: [node] }) as boolean
    if (!exists) return null
    const owner = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'owner', args: [node] }) as `0x${string}`
    return { address: owner, node }
  } catch { return null }
}

/**
 * Find all registered .agent names that resolve to a given address.
 * Iterates all registered agents and checks their ATL_PRIMARY_NAME.
 * Also checks NAMESPACE_CONTAINS edges to find names in the registry.
 */
export async function findAllNamesForAddress(address: string): Promise<string[]> {
  const registryAddr = getRegistryAddr()
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!registryAddr || !resolverAddr) return []

  const client = getPublicClient()
  const names: string[] = []

  // The primary name
  try {
    const primaryName = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getStringProperty', args: [address as `0x${string}`, ATL_PRIMARY_NAME as `0x${string}`],
    }) as string
    if (primaryName) names.push(primaryName)
  } catch { /* */ }

  // Search the registry for any node owned by this address
  // This is expensive — in production would use an indexer
  // For demo, check the root's children and one level deeper
  try {
    const root = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'AGENT_ROOT' }) as `0x${string}`
    const rootLabels = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'childLabelhashes', args: [root] }) as `0x${string}`[]

    for (const lh of rootLabels) {
      const childNode = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'childNode', args: [root, lh] }) as `0x${string}`
      const owner = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'owner', args: [childNode] }) as `0x${string}`

      if (owner.toLowerCase() === address.toLowerCase()) {
        const meta = await getAgentMetadata(owner)
        if (meta.primaryName && !names.includes(meta.primaryName)) names.push(meta.primaryName)
      }

      // Check one level deeper
      const subLabels = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'childLabelhashes', args: [childNode] }) as `0x${string}`[]
      for (const slh of subLabels) {
        const subNode = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'childNode', args: [childNode, slh] }) as `0x${string}`
        const subOwner = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'owner', args: [subNode] }) as `0x${string}`
        if (subOwner.toLowerCase() === address.toLowerCase()) {
          const subMeta = await getAgentMetadata(subOwner)
          if (subMeta.primaryName && !names.includes(subMeta.primaryName)) names.push(subMeta.primaryName)
        }
      }
    }
  } catch { /* registry traversal failed */ }

  return names
}

export async function reverseResolveAddress(address: string): Promise<string | null> {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolverAddr) return null

  try {
    const client = getPublicClient()
    const name = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getStringProperty', args: [address as `0x${string}`, ATL_PRIMARY_NAME as `0x${string}`],
    }) as string
    return name || null
  } catch { return null }
}
