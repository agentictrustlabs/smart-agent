/**
 * On-chain agent registry lookups.
 * All data from AgentAccountResolver + AgentRelationship edges.
 * The only DB table used is `users` (for auth → wallet mapping).
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
  // OAuth / passkey / SIWE users without a separate person agent: the smart
  // account itself acts as their person agent. Detected by walletAddress ==
  // smartAccountAddress (we set them equal in google-callback / passkey
  // signup / SIWE verify for non-EOA users).
  const wallet = user[0].walletAddress.toLowerCase()
  const smartAcct = user[0].smartAccountAddress?.toLowerCase()
  if (smartAcct && wallet === smartAcct) {
    return user[0].smartAccountAddress
  }

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

  function pushOrg(orgAddr: string, roles: string[]) {
    const existing = orgs.find(o => o.address.toLowerCase() === orgAddr.toLowerCase())
    if (existing) {
      for (const r of roles) if (!existing.roles.includes(r)) existing.roles.push(r)
    } else {
      orgs.push({ address: orgAddr, roles: [...roles] })
    }
  }

  // Edges where the person is the SUBJECT (e.g. person CONTROLS org).
  try {
    const edgeIds = await getEdgesBySubject(personAgentAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      try {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        const core = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [edge.object_ as `0x${string}`] }) as { agentType: `0x${string}` }
        if (core.agentType === TYPE_ORGANIZATION) {
          const roles = await getEdgeRoles(edgeId)
          pushOrg(edge.object_, roles.map(r => roleName(r)))
        }
      } catch { /* ignored */ }
    }
  } catch { /* ignored */ }

  // Edges where the person is the OBJECT (e.g. HAS_MEMBER subject=org,
  // object=person — written by createOrgInHub and joinOrgAsPerson).
  try {
    const edgeIds = await getEdgesByObject(personAgentAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      try {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        const core = await client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [edge.subject as `0x${string}`] }) as { agentType: `0x${string}` }
        if (core.agentType === TYPE_ORGANIZATION) {
          const roles = await getEdgeRoles(edgeId)
          pushOrg(edge.subject, roles.map(r => roleName(r)))
        }
      } catch { /* ignored */ }
    }
  } catch { /* ignored */ }

  return orgs
}

// Roles that grant write authority over an org agent. Mirrors the role
// taxonomy in `roleName()`; we accept the canonical labels we expect
// `getOrgsForPersonAgent` to surface.
const MANAGE_ROLES = new Set([
  'owner', 'controller', 'authorized-signer', 'ceo', 'treasurer',
  'board-member', 'admin', 'governance',
])

/**
 * Authority probe for org-level writes (skill / geo claims, metadata
 * edits, etc.). Returns true iff `personAgent`:
 *   • is the target itself, OR
 *   • has an active relationship edge to `target` carrying any
 *     management-class role, OR
 *   • is listed under the target's `ATL_CONTROLLER` multi-address
 *     resolver property.
 *
 * Read-only — exists so server actions can refuse subject substitution
 * before talking to the chain. The on-chain contracts also enforce
 * authority (mintSelf checks `_isAuthorized`); this helper avoids the
 * gas-burning revert when the answer is obviously "no".
 */
export async function canManageAgent(
  personAgent: string,
  target: string,
): Promise<boolean> {
  const a = personAgent.toLowerCase()
  const b = target.toLowerCase()
  if (a === b) return true

  // Path 1: relationship edges with a management-class role.
  const orgs = await getOrgsForPersonAgent(personAgent)
  const match = orgs.find(o => o.address.toLowerCase() === b)
  if (match) {
    const lower = match.roles.map(r => r.toLowerCase())
    if (lower.some(r => MANAGE_ROLES.has(r))) return true
  }

  // Path 2: the target's ATL_CONTROLLER list directly contains the
  // person agent. This catches v0 demo seeds (catalyst-seed sets
  // ATL_CONTROLLER on every org → owner's person agent) where role
  // edges might not yet be promoted to ACTIVE.
  const addr = resolver()
  if (!addr) return false
  try {
    const client = getPublicClient()
    const ctrls = await client.readContract({
      address: addr, abi: agentAccountResolverAbi,
      functionName: 'getMultiAddressProperty',
      args: [target as `0x${string}`, ATL_CONTROLLER as `0x${string}`],
    }) as string[]
    return ctrls.some(c => c.toLowerCase() === a)
  } catch { return false }
}

/**
 * Find AI agents operated by an org (ORGANIZATIONAL_CONTROL edges where subject is AI).
 * Edges + cores fetched in parallel — sequential awaits used to dominate
 * the catalyst dashboard render time (every org with N incoming edges
 * cost N round-trips).
 */
export async function getAiAgentsForOrg(orgAddress: string): Promise<string[]> {
  const addr = resolver()
  if (!addr) return []
  const client = getPublicClient()

  let edgeIds: `0x${string}`[] = []
  try { edgeIds = await getEdgesByObject(orgAddress as `0x${string}`) } catch { return [] }
  if (edgeIds.length === 0) return []

  const edges = await Promise.all(edgeIds.map(id => getEdge(id).catch(() => null)))
  const candidateSubjects = new Set<string>()
  for (const edge of edges) {
    if (!edge || edge.status < 2) continue
    candidateSubjects.add(edge.subject)
  }
  if (candidateSubjects.size === 0) return []

  const subjectArr = [...candidateSubjects]
  const cores = await Promise.all(subjectArr.map(s =>
    (client.readContract({ address: addr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [s as `0x${string}`] }) as Promise<{ agentType: `0x${string}` }>)
      .catch(() => null),
  ))
  const aiAddrs: string[] = []
  for (let i = 0; i < subjectArr.length; i++) {
    if (cores[i]?.agentType === TYPE_AI_AGENT) aiAddrs.push(subjectArr[i])
  }
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
