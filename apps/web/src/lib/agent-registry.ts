/**
 * On-chain agent registry lookups.
 * All data from AgentAccountResolver + AgentRelationship edges.
 * The only DB table used is `users` (for Privy auth → wallet mapping).
 */

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  getPublicClient, getEdgesBySubject, getEdgesByObject, getEdge, getEdgeRoles,
} from '@/lib/contracts'
import {
  agentAccountResolverAbi, agentRelationshipQueryAbi, roleName,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT, TYPE_HUB,
  ATL_CONTROLLER, HAS_MEMBER,
} from '@smart-agent/sdk'

function resolver() { return process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` }
function queryContract() { return process.env.AGENT_RELATIONSHIP_QUERY_ADDRESS as `0x${string}` | undefined }

/**
 * Find a user's person agent address from on-chain registry.
 * Iterates registered person agents and checks ATL_CONTROLLER for the user's wallet.
 */
export async function getPersonAgentForUser(userId: string): Promise<string | null> {
  // Fast path: read the persisted address from the user row. The on-chain
  // scan is reserved as a fallback for rows that never finished provisioning.
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  if (!user[0]) return null
  if (user[0].personAgentAddress) return user[0].personAgentAddress
  const wallet = user[0].walletAddress.toLowerCase()

  const addr = resolver()
  if (!addr) return null
  const client = getPublicClient()

  try {
    const count = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'agentCount' }) as bigint
    // Parallelise the per-agent lookups — we used to do ~3 sequential RPC
    // calls per agent, which made N user-page renders cost ~3N round-trips.
    const indexes = Array.from({ length: Number(count) }, (_, i) => BigInt(i))
    const agentAddrs = await Promise.all(indexes.map(i =>
      client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getAgentAt', args: [i] }) as Promise<`0x${string}`>,
    ))
    const cores = await Promise.all(agentAddrs.map(a =>
      client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [a] }) as Promise<{ agentType: `0x${string}` }>,
    ))
    const persons = agentAddrs.filter((_, i) => cores[i].agentType === TYPE_PERSON)
    const controllerLists = await Promise.all(persons.map(a =>
      client.readContract({
        address: addr, abi: agentAccountResolverAbi,
        functionName: 'getMultiAddressProperty',
        args: [a, ATL_CONTROLLER as `0x${string}`],
      }) as Promise<string[]>,
    ))
    for (let i = 0; i < persons.length; i++) {
      if (controllerLists[i].some(c => c.toLowerCase() === wallet)) {
        return persons[i]
      }
    }
  } catch { /* ignored */ }
  return null
}

/**
 * Find all orgs a person agent has relationships with (GOVERNANCE/MEMBERSHIP edges).
 */
export async function getOrgsForPersonAgent(personAgentAddress: string): Promise<Array<{ address: string; roles: string[] }>> {
  const orgs: Array<{ address: string; roles: string[] }> = []
  const addr = resolver()
  if (!addr) return orgs
  const client = getPublicClient()

  try {
    const edgeIds = await getEdgesBySubject(personAgentAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      try {
        const core = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [edge.object_ as `0x${string}`] }) as { agentType: `0x${string}` }
        if (core.agentType === TYPE_ORGANIZATION) {
          const roles = await getEdgeRoles(edgeId)
          const existing = orgs.find(o => o.address.toLowerCase() === edge.object_.toLowerCase())
          if (existing) {
            existing.roles.push(...roles.map(r => roleName(r)))
          } else {
            orgs.push({ address: edge.object_, roles: roles.map(r => roleName(r)) })
          }
        }
      } catch { /* ignored */ }
    }
  } catch { /* ignored */ }
  return orgs
}

/**
 * Find AI agents operated by an org (ORGANIZATIONAL_CONTROL edges where subject is AI).
 */
export async function getAiAgentsForOrg(orgAddress: string): Promise<string[]> {
  const aiAddrs: string[] = []
  const addr = resolver()
  if (!addr) return aiAddrs
  const client = getPublicClient()

  try {
    const edgeIds = await getEdgesByObject(orgAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      try {
        const core = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [edge.subject as `0x${string}`] }) as { agentType: `0x${string}` }
        if (core.agentType === TYPE_AI_AGENT) {
          if (!aiAddrs.includes(edge.subject)) aiAddrs.push(edge.subject)
        }
      } catch { /* ignored */ }
    }
  } catch { /* ignored */ }
  return aiAddrs
}

/**
 * Get agent kind from on-chain resolver agentType.
 */
export async function getAgentKind(agentAddress: string): Promise<'person' | 'org' | 'ai' | 'hub' | 'unknown'> {
  const addr = resolver()
  if (!addr) return 'unknown'
  try {
    const client = getPublicClient()
    const core = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [agentAddress as `0x${string}`] }) as { agentType: `0x${string}` }
    if (core.agentType === TYPE_PERSON) return 'person'
    if (core.agentType === TYPE_ORGANIZATION) return 'org'
    if (core.agentType === TYPE_AI_AGENT) return 'ai'
    if (core.agentType === TYPE_HUB) return 'hub'
  } catch { /* ignored */ }
  return 'unknown'
}

/**
 * Find orgs created by a user (where user's person agent has GOVERNANCE/owner edge).
 */
export async function getOrgsCreatedByUser(userId: string): Promise<string[]> {
  const personAddr = await getPersonAgentForUser(userId)
  if (!personAddr) return []
  const orgs = await getOrgsForPersonAgent(personAddr)
  return orgs.filter(o => o.roles.includes('owner')).map(o => o.address)
}

/**
 * Find hub agents that an agent belongs to (via HAS_MEMBER edges where agent is target).
 * Uses the AgentRelationshipQuery contract's directSourcesOf if available,
 * otherwise falls back to edge iteration.
 */
export async function getHubsForAgent(agentAddress: string): Promise<string[]> {
  const qAddr = queryContract()
  if (qAddr) {
    try {
      const client = getPublicClient()
      const sources = await client.readContract({
        address: qAddr,
        abi: agentRelationshipQueryAbi,
        functionName: 'directSourcesOf',
        args: [agentAddress as `0x${string}`, HAS_MEMBER as `0x${string}`],
      }) as string[]
      return sources
    } catch { /* fallback below */ }
  }

  // Fallback: iterate edges
  const hubs: string[] = []
  const addr = resolver()
  if (!addr) return hubs
  const client = getPublicClient()

  try {
    const edgeIds = await getEdgesByObject(agentAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      try {
        const core = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [edge.subject as `0x${string}`] }) as { agentType: `0x${string}` }
        if (core.agentType === TYPE_HUB) {
          hubs.push(edge.subject)
        }
      } catch { /* ignored */ }
    }
  } catch { /* ignored */ }
  return hubs
}

/**
 * Get all members of a hub (via HAS_MEMBER edges where hub is source).
 */
export async function getHubMembers(hubAddress: string): Promise<string[]> {
  const qAddr = queryContract()
  if (qAddr) {
    try {
      const client = getPublicClient()
      return await client.readContract({
        address: qAddr,
        abi: agentRelationshipQueryAbi,
        functionName: 'directTargetsOf',
        args: [hubAddress as `0x${string}`, HAS_MEMBER as `0x${string}`],
      }) as string[]
    } catch { /* fallback below */ }
  }

  // Fallback
  const members: string[] = []
  try {
    const edgeIds = await getEdgesBySubject(hubAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      members.push(edge.object_)
    }
  } catch { /* ignored */ }
  return members
}
