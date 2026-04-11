import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName } from '@smart-agent/sdk'

export interface OrgContextData {
  orgs: Array<{
    address: string
    name: string
    description: string
    templateId: string | null
  }>
  /** Map of org address → user's roles in that org */
  roles: Record<string, string[]>
  /** Map of org address → AI agents operated by that org */
  aiAgents: Record<string, Array<{ address: string; name: string; agentType: string }>>
}

export async function GET() {
  try {
    const { getSession } = await import('@/lib/auth/session')
    const session = await getSession()
    if (!session) return NextResponse.json({ orgs: [], roles: {}, aiAgents: {} })

    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    if (!users[0]) return NextResponse.json({ orgs: [], roles: {}, aiAgents: {} })

    const userId = users[0].id

    // Get orgs created by user
    const createdOrgs = await db.select().from(schema.orgAgents)
      .where(eq(schema.orgAgents.createdBy, userId))

    // Get user's person agent
    const personAgents = await db.select().from(schema.personAgents)
      .where(eq(schema.personAgents.userId, userId)).limit(1)

    // Also find orgs the user joined via relationship edges
    const allOrgsInDb = await db.select().from(schema.orgAgents)
    const joinedOrgAddrs = new Set<string>()

    if (personAgents[0]) {
      try {
        const edgeIds = await getEdgesBySubject(personAgents[0].smartAccountAddress as `0x${string}`)
        for (const edgeId of edgeIds) {
          const edge = await getEdge(edgeId)
          if (edge.status < 2) continue
          const objAddr = edge.object_.toLowerCase()
          if (allOrgsInDb.some(o => o.smartAccountAddress.toLowerCase() === objAddr)) {
            joinedOrgAddrs.add(objAddr)
          }
        }
      } catch { /* contracts not deployed */ }
    }

    // Merge created + joined orgs (deduplicate)
    const orgAgents = [...createdOrgs]
    for (const org of allOrgsInDb) {
      if (joinedOrgAddrs.has(org.smartAccountAddress.toLowerCase()) &&
          !createdOrgs.some(c => c.smartAccountAddress.toLowerCase() === org.smartAccountAddress.toLowerCase())) {
        orgAgents.push(org)
      }
    }

    // Get AI agents for all accessible orgs
    const allAI = await db.select().from(schema.aiAgents)

    const aiAgentsByOrg: Record<string, Array<{ address: string; name: string; agentType: string }>> = {}
    for (const ai of allAI) {
      const opBy = ai.operatedBy?.toLowerCase() ?? ''
      if (!aiAgentsByOrg[opBy]) aiAgentsByOrg[opBy] = []
      aiAgentsByOrg[opBy].push({ address: ai.smartAccountAddress, name: ai.name, agentType: ai.agentType })
    }

    // Detect user's roles per org via relationship edges
    const rolesByOrg: Record<string, string[]> = {}

    if (personAgents[0]) {
      try {
        const edgeIds = await getEdgesBySubject(personAgents[0].smartAccountAddress as `0x${string}`)
        for (const edgeId of edgeIds) {
          const edge = await getEdge(edgeId)
          if (edge.status < 2) continue

          const orgAddr = edge.object_.toLowerCase()
          // Check against ALL orgs, not just user-created ones
          if (!orgAgents.some(o => o.smartAccountAddress.toLowerCase() === orgAddr)) continue

          const edgeRoles = await getEdgeRoles(edgeId)
          const roleNames = edgeRoles.map(r => roleName(r))

          if (!rolesByOrg[orgAddr]) rolesByOrg[orgAddr] = []
          rolesByOrg[orgAddr].push(...roleNames)
        }
      } catch { /* contracts may not be deployed */ }
    }

    // Creator is always "owner" even without explicit edge
    for (const org of createdOrgs) {
      const key = org.smartAccountAddress.toLowerCase()
      if (!rolesByOrg[key]) rolesByOrg[key] = []
      if (!rolesByOrg[key].includes('owner')) rolesByOrg[key].push('owner')
    }

    const result: OrgContextData = {
      orgs: orgAgents.map(o => ({
        address: o.smartAccountAddress,
        name: o.name,
        description: o.description ?? '',
        templateId: (o as Record<string, unknown>).templateId as string | null,
      })),
      roles: rolesByOrg,
      aiAgents: aiAgentsByOrg,
    }

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ orgs: [], roles: {}, aiAgents: {} })
  }
}
