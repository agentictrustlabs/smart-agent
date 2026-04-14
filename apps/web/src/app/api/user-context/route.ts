import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getEdgesBySubject } from '@/lib/contracts'
import { getPersonAgentForUser, getOrgsForPersonAgent, getAiAgentsForOrg } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getEdge, getEdgeRoles } from '@/lib/contracts'
import { REVIEW_RELATIONSHIP, ROLE_REVIEWER } from '@smart-agent/sdk'

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

export async function GET() {
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

    // Reviewer authority is derived from active reviewer relationships.
    const delegations: UserDelegation[] = []
    if (personAddr) {
      const edgeIds = await getEdgesBySubject(personAddr as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.relationshipType !== REVIEW_RELATIONSHIP) continue
        if (edge.status < 2) continue
        const roles = await getEdgeRoles(edgeId)
        if (!roles.some(role => role === ROLE_REVIEWER)) continue

        const org = orgs.find(o => o.address.toLowerCase() === edge.object_.toLowerCase())
        delegations.push({
          id: edgeId,
          orgAddress: edge.object_,
          orgName: org?.name ?? edge.object_.slice(0, 10) + '...',
          type: 'review',
          status: 'available',
          expiresAt: '',
          caveats: ['Issued on demand'],
        })
        allCapabilities.add('reviews')
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
