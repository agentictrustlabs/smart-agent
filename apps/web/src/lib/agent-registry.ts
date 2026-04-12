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
  agentAccountResolverAbi, roleName,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT,
  ATL_CONTROLLER,
} from '@smart-agent/sdk'

function resolver() { return process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` }

/**
 * Find a user's person agent address from on-chain registry.
 * Iterates registered person agents and checks ATL_CONTROLLER for the user's wallet.
 */
export async function getPersonAgentForUser(userId: string): Promise<string | null> {
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  if (!user[0]) return null
  const wallet = user[0].walletAddress.toLowerCase()

  const addr = resolver()
  if (!addr) return null
  const client = getPublicClient()

  try {
    const count = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'agentCount' }) as bigint
    for (let i = 0n; i < count; i++) {
      const agentAddr = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getAgentAt', args: [i] }) as `0x${string}`
      const core = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [agentAddr] }) as { agentType: `0x${string}` }
      if (core.agentType !== TYPE_PERSON) continue

      // Check if this person agent's controller list includes the user's wallet
      const controllers = await client.readContract({
        address: addr, abi: agentAccountResolverAbi,
        functionName: 'getMultiAddressProperty',
        args: [agentAddr, ATL_CONTROLLER as `0x${string}`],
      }) as string[]

      if (controllers.some(c => c.toLowerCase() === wallet)) {
        return agentAddr
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
export async function getAgentKind(agentAddress: string): Promise<'person' | 'org' | 'ai' | 'unknown'> {
  const addr = resolver()
  if (!addr) return 'unknown'
  try {
    const client = getPublicClient()
    const core = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [agentAddress as `0x${string}`] }) as { agentType: `0x${string}` }
    if (core.agentType === TYPE_PERSON) return 'person'
    if (core.agentType === TYPE_ORGANIZATION) return 'org'
    if (core.agentType === TYPE_AI_AGENT) return 'ai'
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
