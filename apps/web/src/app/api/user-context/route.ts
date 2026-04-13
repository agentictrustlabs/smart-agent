import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getEdgesBySubject } from '@/lib/contracts'
import { getPersonAgentForUser, getOrgsForPersonAgent, getAiAgentsForOrg } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'

/**
 * User-centric context API.
 * Returns everything needed to render the UI for the connected user:
 * - person agent
 * - all orgs with roles
 * - delegations (what the user is authorized to do)
 * - capabilities derived from roles + delegations
 */

export interface UserOrg {
  address: string
  name: string
  description: string
  roles: string[]
  aiAgents: Array<{ address: string; name: string; agentType: string }>
  capabilities: string[]
  hasChildren: boolean
}

export interface UserDelegation {
  id: string
  orgAddress: string
  orgName: string
  type: string // e.g. 'review', 'treasury', 'governance'
  status: string
  expiresAt: string
  caveats: string[]
}

export interface UserHub {
  address: string
  name: string
  description: string
}

export interface UserContextResponse {
  personAgent: { address: string; name: string } | null
  orgs: UserOrg[]
  delegations: UserDelegation[]
  /** Hub agents the user belongs to (via HAS_MEMBER edges) */
  hubs: UserHub[]
  /** Union of all capabilities across all orgs */
  capabilities: string[]
  /** Union of all roles across all orgs */
  roles: string[]
}

const ENFORCER_NAMES: Record<string, string> = {}

function initEnforcerNames() {
  const ts = process.env.TIMESTAMP_ENFORCER_ADDRESS?.toLowerCase()
  const am = process.env.ALLOWED_METHODS_ENFORCER_ADDRESS?.toLowerCase()
  const at = process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS?.toLowerCase()
  const ve = process.env.VALUE_ENFORCER_ADDRESS?.toLowerCase()
  if (ts) ENFORCER_NAMES[ts] = 'Time Window'
  if (am) ENFORCER_NAMES[am] = 'Allowed Methods'
  if (at) ENFORCER_NAMES[at] = 'Allowed Targets'
  if (ve) ENFORCER_NAMES[ve] = 'Spending Limit'
}

export async function GET() {
  initEnforcerNames()
  const empty: UserContextResponse = { personAgent: null, orgs: [], delegations: [], hubs: [], capabilities: [], roles: [] }

  try {
    const { getSession } = await import('@/lib/auth/session')
    const session = await getSession()
    if (!session) return NextResponse.json(empty)

    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    if (!users[0]) return NextResponse.json(empty)

    // Person agent from on-chain
    const personAddr = await getPersonAgentForUser(users[0].id)
    let personAgent: UserContextResponse['personAgent'] = null
    if (personAddr) {
      const meta = await getAgentMetadata(personAddr)
      personAgent = { address: personAddr, name: meta.displayName }
    }

    // All orgs via on-chain edges
    const orgEdges = personAddr ? await getOrgsForPersonAgent(personAddr) : []
    const allRoles = new Set<string>()
    const allCapabilities = new Set<string>()

    const orgs: UserOrg[] = []
    for (const orgEdge of orgEdges) {
      const meta = await getAgentMetadata(orgEdge.address)
      for (const r of orgEdge.roles) allRoles.add(r)

      // AI agents
      const aiAddrs = await getAiAgentsForOrg(orgEdge.address)
      const aiAgents = await Promise.all(
        aiAddrs.map(async addr => {
          const m = await getAgentMetadata(addr)
          return { address: addr, name: m.displayName, agentType: m.aiAgentClass || 'custom' }
        })
      )

      // Capabilities derived from roles + on-chain data
      const caps: string[] = ['network', 'agents']
      let hasChildren = false
      try {
        const outEdges = await getEdgesBySubject(orgEdge.address as `0x${string}`)
        if (outEdges.length > 0) {
          hasChildren = true
          caps.push('genmap', 'activities', 'members')
        }
      } catch { /* ignored */ }
      if (aiAgents.length > 0) caps.push('treasury')

      // Role-derived capabilities
      const roles = orgEdge.roles.map(r => r.toLowerCase())
      if (roles.some(r => ['owner', 'admin', 'ceo'].includes(r))) caps.push('settings', 'governance')
      if (roles.some(r => ['owner', 'treasurer', 'authorized-signer'].includes(r))) caps.push('treasury')
      if (roles.some(r => ['reviewer', 'auditor', 'endorser'].includes(r))) caps.push('reviews')
      if (roles.some(r => ['operator', 'member', 'owner'].includes(r))) caps.push('reviews')

      const uniqueCaps = [...new Set(caps)]
      for (const c of uniqueCaps) allCapabilities.add(c)

      orgs.push({
        address: orgEdge.address,
        name: meta.displayName,
        description: meta.description,
        roles: orgEdge.roles,
        aiAgents,
        capabilities: uniqueCaps,
        hasChildren,
      })
    }

    // Delegations: find all delegations where this user's person agent is the reviewer
    const delegations: UserDelegation[] = []
    if (personAddr) {
      const allDelegations = await db.select().from(schema.reviewDelegations)
        .where(eq(schema.reviewDelegations.reviewerAgentAddress, personAddr.toLowerCase()))

      for (const d of allDelegations) {
        const isExpired = new Date(d.expiresAt) < new Date()
        let caveats: string[] = []
        try {
          const parsed = JSON.parse(d.delegationJson)
          caveats = (parsed.caveats ?? []).map((c: { enforcer: string }) =>
            ENFORCER_NAMES[c.enforcer?.toLowerCase()] ?? 'Custom'
          )
        } catch { /* ignored */ }

        // Find org name
        const org = orgs.find(o => o.address.toLowerCase() === d.subjectAgentAddress.toLowerCase())
        delegations.push({
          id: d.id,
          orgAddress: d.subjectAgentAddress,
          orgName: org?.name ?? d.subjectAgentAddress.slice(0, 10) + '...',
          type: 'review',
          status: isExpired ? 'expired' : d.status,
          expiresAt: d.expiresAt,
          caveats,
        })

        if (!isExpired && d.status === 'active') allCapabilities.add('reviews')
      }
    }

    // Discover hub agents the user belongs to
    const { getHubsForAgent } = await import('@/lib/agent-registry')
    const hubs: UserHub[] = []
    const seenHubs = new Set<string>()
    for (const org of orgs) {
      try {
        const hubAddrs = await getHubsForAgent(org.address)
        for (const hubAddr of hubAddrs) {
          if (seenHubs.has(hubAddr.toLowerCase())) continue
          seenHubs.add(hubAddr.toLowerCase())
          const hubMeta = await getAgentMetadata(hubAddr)
          hubs.push({ address: hubAddr, name: hubMeta.displayName, description: hubMeta.description })
        }
      } catch { /* ignored */ }
    }

    return NextResponse.json({
      personAgent,
      orgs,
      delegations,
      hubs,
      capabilities: [...allCapabilities],
      roles: [...allRoles],
    } satisfies UserContextResponse)
  } catch {
    return NextResponse.json(empty)
  }
}
