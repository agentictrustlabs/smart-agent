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

    // Find orgs the user joined via relationship edges (on-chain)
    const allOrgsInDb = await db.select().from(schema.orgAgents)
    const joinedOrgAddrs = new Set<string>()
    const rolesByOrg: Record<string, string[]> = {}

    if (personAgents[0]) {
      try {
        const edgeIds = await getEdgesBySubject(personAgents[0].smartAccountAddress as `0x${string}`)
        for (const edgeId of edgeIds) {
          const edge = await getEdge(edgeId)
          if (edge.status < 2) continue

          const orgAddr = edge.object_.toLowerCase()
          if (allOrgsInDb.some(o => o.smartAccountAddress.toLowerCase() === orgAddr)) {
            joinedOrgAddrs.add(orgAddr)
          }

          // Collect roles from edges
          const edgeRoles = await getEdgeRoles(edgeId)
          const roleNames = edgeRoles.map(r => roleName(r))
          if (!rolesByOrg[orgAddr]) rolesByOrg[orgAddr] = []
          rolesByOrg[orgAddr].push(...roleNames)
        }
      } catch { /* contracts may not be deployed */ }
    }

    // On-chain edges are the source of truth — no DB fallbacks

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

    // Creator is always "owner" even without explicit edge
    for (const org of createdOrgs) {
      const key = org.smartAccountAddress.toLowerCase()
      if (!rolesByOrg[key]) rolesByOrg[key] = []
      if (!rolesByOrg[key].includes('owner')) rolesByOrg[key].push('owner')
    }

    // Compute capabilities per org based on template + data presence
    const capsByOrg: Record<string, string[]> = {}
    const TOGO_TEMPLATES = ['impact-investor', 'field-agency', 'oversight-committee', 'portfolio-business']
    const CPM_TEMPLATES = ['movement-network', 'church-planting-team', 'local-group', 'catalyst-network', 'facilitator-hub', 'local-group']

    for (const org of orgAgents) {
      const key = org.smartAccountAddress.toLowerCase()
      const tpl = (org as Record<string, unknown>).templateId as string ?? ''
      const caps: string[] = ['network', 'agents', 'reviews'] // always available

      if (CPM_TEMPLATES.includes(tpl)) {
        caps.push('genmap', 'activities', 'members')
      }
      if (TOGO_TEMPLATES.includes(tpl)) {
        caps.push('portfolio', 'revenue', 'training', 'governance')
      }
      if (['grant-org', 'church', 'investment-club', 'giving-intermediary', 'impact-investor'].includes(tpl)) {
        caps.push('treasury')
      }
      capsByOrg[key] = caps
    }

    const result = {
      orgs: orgAgents.map(o => ({
        address: o.smartAccountAddress,
        name: o.name,
        description: o.description ?? '',
        templateId: (o as Record<string, unknown>).templateId as string | null,
      })),
      roles: rolesByOrg,
      aiAgents: aiAgentsByOrg,
      capabilities: capsByOrg,
    }

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ orgs: [], roles: {}, aiAgents: {}, capabilities: {} })
  }
}
