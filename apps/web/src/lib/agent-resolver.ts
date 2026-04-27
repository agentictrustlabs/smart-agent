import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getPublicClient, getWalletClient, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  ATL_CONTROLLER,
  ATL_GENMAP_DATA,
  ATL_ACTIVITY_LOG,
  ATL_TRACKED_MEMBERS,
  ATL_TEMPLATE_ID,
  ROLE_OWNER,
  TYPE_AI_AGENT,
  TYPE_ORGANIZATION,
  TYPE_PERSON,
} from '@smart-agent/sdk'

// Re-export for app code
export { ATL_GENMAP_DATA, ATL_ACTIVITY_LOG, ATL_TRACKED_MEMBERS, ATL_TEMPLATE_ID }

type AgentKind = 'person' | 'org' | 'ai' | 'unknown'

export interface RegisteredAgent {
  address: string
  name: string
  description: string
  kind: AgentKind
  controllers: string[]
}

function getResolverAddress() {
  return process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
}

function kindFromType(agentType: `0x${string}`): AgentKind {
  if (agentType === TYPE_PERSON) return 'person'
  if (agentType === TYPE_ORGANIZATION) return 'org'
  if (agentType === TYPE_AI_AGENT) return 'ai'
  return 'unknown'
}

export async function getAgentStringProperty(agentAddress: string, predicate: `0x${string}`): Promise<string> {
  const resolverAddr = getResolverAddress()
  if (!resolverAddr) return ''

  try {
    const client = getPublicClient()
    return await client.readContract({
      address: resolverAddr,
      abi: agentAccountResolverAbi,
      functionName: 'getStringProperty',
      args: [agentAddress as `0x${string}`, predicate],
    }) as string
  } catch {
    return ''
  }
}

export async function setAgentStringProperty(agentAddress: string, predicate: `0x${string}`, value: string) {
  const resolverAddr = getResolverAddress()
  if (!resolverAddr) return

  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const hash = await walletClient.writeContract({
    address: resolverAddr,
    abi: agentAccountResolverAbi,
    functionName: 'setStringProperty',
    args: [agentAddress as `0x${string}`, predicate, value],
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

export async function addAgentController(agentAddress: string, walletAddress: string) {
  const resolverAddr = getResolverAddress()
  if (!resolverAddr) return

  const client = getPublicClient()
  const existing = await client.readContract({
    address: resolverAddr,
    abi: agentAccountResolverAbi,
    functionName: 'getMultiAddressProperty',
    args: [agentAddress as `0x${string}`, ATL_CONTROLLER as `0x${string}`],
  }) as string[]

  if (existing.some(addr => addr.toLowerCase() === walletAddress.toLowerCase())) return

  const walletClient = getWalletClient()
  const hash = await walletClient.writeContract({
    address: resolverAddr,
    abi: agentAccountResolverAbi,
    functionName: 'addMultiAddressProperty',
    args: [agentAddress as `0x${string}`, ATL_CONTROLLER as `0x${string}`, walletAddress as `0x${string}`],
  })
  await client.waitForTransactionReceipt({ hash })
}

export async function listRegisteredAgents(): Promise<RegisteredAgent[]> {
  const resolverAddr = getResolverAddress()
  if (!resolverAddr) return []

  const client = getPublicClient()
  const results: RegisteredAgent[] = []

  try {
    const count = await client.readContract({
      address: resolverAddr,
      abi: agentAccountResolverAbi,
      functionName: 'agentCount',
    }) as bigint

    // Fan out each agent index → addr in parallel, then per-agent
    // getCore + getMultiAddressProperty in parallel. Sequential awaits
    // here meant 3 round-trips per agent × 50 agents = 150 serial RPC
    // calls on every dashboard render.
    const indices = Array.from({ length: Number(count) }, (_, i) => BigInt(i))
    const addrs = await Promise.all(indices.map(i =>
      client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getAgentAt', args: [i] }) as Promise<`0x${string}`>,
    ))
    const cores = await Promise.all(addrs.map(a =>
      (client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [a] }) as Promise<{ displayName: string; description: string; agentType: `0x${string}` }>)
        .catch(() => null),
    ))
    const controllerLists = await Promise.all(addrs.map(a =>
      (client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getMultiAddressProperty', args: [a, ATL_CONTROLLER as `0x${string}`] }) as Promise<string[]>)
        .catch(() => [] as string[]),
    ))
    for (let i = 0; i < addrs.length; i++) {
      const core = cores[i]
      if (!core) continue
      results.push({
        address: addrs[i],
        name: core.displayName || `${addrs[i].slice(0, 6)}...${addrs[i].slice(-4)}`,
        description: core.description || '',
        kind: kindFromType(core.agentType),
        controllers: controllerLists[i],
      })
    }
  } catch {
    return []
  }

  return results
}

/**
 * Agents the user controls — combines two ownership signals:
 *   1. Resolver ATL_CONTROLLER list contains the user's wallet EOA.
 *   2. There's a confirmed/active ORGANIZATION_GOVERNANCE edge with ROLE_OWNER
 *      from the user's person agent to the org.
 *
 * The /relationships page uses this set to decide whether the signed-in user
 * can confirm a PROPOSED edge whose object is the agent. Combining both
 * sources means an OWNER edge alone is enough to enable approval, even when
 * the controller list hasn't been updated.
 */
export async function getControlledAgentsForUser(userId: string): Promise<RegisteredAgent[]> {
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  if (!user[0]) return []

  const wallet = user[0].walletAddress.toLowerCase()
  const personAgent = user[0].personAgentAddress?.toLowerCase()
  const agents = await listRegisteredAgents()
  const ownedAddrs = new Set<string>()

  // Signal 1: resolver controller list.
  for (const a of agents) {
    if (a.controllers.some(c => c.toLowerCase() === wallet)) ownedAddrs.add(a.address.toLowerCase())
  }

  // Signal 2: outgoing OWNER edges from the user's person agent.
  if (personAgent) {
    try {
      const edgeIds = await getEdgesBySubject(personAgent as `0x${string}`)
      const enriched = await Promise.all(edgeIds.map(async id => {
        try {
          const [e, roles] = await Promise.all([getEdge(id), getEdgeRoles(id)])
          return { e, roles }
        } catch { return null }
      }))
      for (const item of enriched) {
        if (!item) continue
        // Status 2 = Confirmed, 3 = Active. Skip Proposed/Rejected/Revoked.
        if (item.e.status !== 2 && item.e.status !== 3) continue
        if (!item.roles.some(r => r.toLowerCase() === (ROLE_OWNER as string).toLowerCase())) continue
        ownedAddrs.add(item.e.object_.toLowerCase())
      }
    } catch { /* best-effort */ }
  }

  return agents.filter(a => ownedAddrs.has(a.address.toLowerCase()))
}

export async function findAgentOwnerUserIds(agentAddress: string): Promise<string[]> {
  const agents = await listRegisteredAgents()
  const agent = agents.find(entry => entry.address.toLowerCase() === agentAddress.toLowerCase())
  const users = await db.select().from(schema.users)

  const ownerIds = new Set<string>()

  // Controllers
  if (agent && agent.controllers.length > 0) {
    const walletSet = new Set(agent.controllers.map(c => c.toLowerCase()))
    for (const u of users) {
      if (walletSet.has(u.walletAddress.toLowerCase())) ownerIds.add(u.id)
    }
  }

  // OWNER edges where the user's person agent is the subject.
  for (const u of users) {
    const pa = u.personAgentAddress?.toLowerCase()
    if (!pa) continue
    try {
      const edgeIds = await getEdgesBySubject(pa as `0x${string}`)
      for (const id of edgeIds) {
        try {
          const e = await getEdge(id)
          if (e.object_.toLowerCase() !== agentAddress.toLowerCase()) continue
          if (e.status !== 2 && e.status !== 3) continue
          const roles = await getEdgeRoles(id)
          if (roles.some(r => r.toLowerCase() === (ROLE_OWNER as string).toLowerCase())) {
            ownerIds.add(u.id)
            break
          }
        } catch { /* */ }
      }
    } catch { /* */ }
  }

  return [...ownerIds]
}

export async function getAgentTemplateId(agentAddress: string): Promise<string | null> {
  const value = await getAgentStringProperty(agentAddress, ATL_TEMPLATE_ID)
  return value || null
}

export async function setAgentTemplateId(agentAddress: string, templateId: string) {
  await setAgentStringProperty(agentAddress, ATL_TEMPLATE_ID, templateId)
}

export async function getAgentGenMapData(agentAddress: string): Promise<Record<string, unknown> | null> {
  const value = await getAgentStringProperty(agentAddress, ATL_GENMAP_DATA as `0x${string}`)
  if (!value) return null
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function setAgentGenMapData(agentAddress: string, data: Record<string, unknown>) {
  await setAgentStringProperty(agentAddress, ATL_GENMAP_DATA as `0x${string}`, JSON.stringify(data))
}

// ─── Activity Log (JSON array per org agent) ────────────────────────

export interface ActivityEntry {
  id: string
  type: 'entry' | 'evangelism' | 'discipleship' | 'formation' | 'leadership' | 'prayer' | 'service' | 'other'
  title: string
  description?: string
  date: string
  duration?: number
  participants?: number
  location?: string
  lat?: number
  lng?: number
  contributors?: string[]
  chainedFrom?: string
  peopleGroup?: string
  notes?: string
  createdBy: string
  createdAt: string
}

export async function getActivityLog(orgAddress: string): Promise<ActivityEntry[]> {
  const value = await getAgentStringProperty(orgAddress, ATL_ACTIVITY_LOG as `0x${string}`)
  if (!value) return []
  try {
    return JSON.parse(value) as ActivityEntry[]
  } catch {
    return []
  }
}

export async function setActivityLog(orgAddress: string, activities: ActivityEntry[]) {
  await setAgentStringProperty(orgAddress, ATL_ACTIVITY_LOG as `0x${string}`, JSON.stringify(activities))
}

// ─── Tracked Members (JSON object per org agent) ────────────────────

export interface TrackedMember {
  id: string
  name: string
  role?: string
  assignedNode?: string
  notes?: string
  createdAt: string
}

export async function getTrackedMembers(orgAddress: string): Promise<TrackedMember[]> {
  const value = await getAgentStringProperty(orgAddress, ATL_TRACKED_MEMBERS as `0x${string}`)
  if (!value) return []
  try {
    return JSON.parse(value) as TrackedMember[]
  } catch {
    return []
  }
}

export async function setTrackedMembers(orgAddress: string, members: TrackedMember[]) {
  await setAgentStringProperty(orgAddress, ATL_TRACKED_MEMBERS as `0x${string}`, JSON.stringify(members))
}
