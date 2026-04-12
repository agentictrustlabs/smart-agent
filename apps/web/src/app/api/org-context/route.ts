import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getEdgesBySubject } from '@/lib/contracts'
import { getPersonAgentForUser, getOrgsForPersonAgent, getAiAgentsForOrg } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'

export async function GET() {
  try {
    const { getSession } = await import('@/lib/auth/session')
    const session = await getSession()
    if (!session) return NextResponse.json({ orgs: [], roles: {}, aiAgents: {}, capabilities: {} })

    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    if (!users[0]) return NextResponse.json({ orgs: [], roles: {}, aiAgents: {}, capabilities: {} })

    // Find person agent from on-chain registry
    const personAddr = await getPersonAgentForUser(users[0].id)

    // Find orgs via on-chain edges
    const orgRoles = personAddr ? await getOrgsForPersonAgent(personAddr) : []
    const rolesByOrg: Record<string, string[]> = {}
    for (const o of orgRoles) rolesByOrg[o.address.toLowerCase()] = o.roles

    const orgRows = await db.select().from(schema.orgAgents)
    const templateByAddress = new Map(
      orgRows.map(org => [org.smartAccountAddress.toLowerCase(), (org as Record<string, unknown>).templateId as string | null ?? null])
    )

    // Build org list with on-chain metadata
    const orgs: Array<{ address: string; name: string; description: string; templateId: string | null }> = []
    for (const o of orgRoles) {
      const meta = await getAgentMetadata(o.address)
      orgs.push({
        address: o.address,
        name: meta.displayName,
        description: meta.description,
        templateId: templateByAddress.get(o.address.toLowerCase()) ?? null,
      })
    }

    // AI agents from on-chain ORGANIZATIONAL_CONTROL edges
    const aiAgentsByOrg: Record<string, Array<{ address: string; name: string; agentType: string }>> = {}
    for (const org of orgs) {
      const aiAddrs = await getAiAgentsForOrg(org.address)
      if (aiAddrs.length > 0) {
        aiAgentsByOrg[org.address.toLowerCase()] = await Promise.all(
          aiAddrs.map(async addr => {
            const meta = await getAgentMetadata(addr)
            return { address: addr, name: meta.displayName, agentType: meta.aiAgentClass || 'custom' }
          })
        )
      }
    }

    // Derive capabilities from on-chain data
    const capsByOrg: Record<string, string[]> = {}
    for (const org of orgs) {
      const caps = ['network', 'agents', 'reviews']
      try {
        const outEdges = await getEdgesBySubject(org.address as `0x${string}`)
        if (outEdges.length > 0) caps.push('genmap', 'activities', 'members')
      } catch { /* ignored */ }
      if (aiAgentsByOrg[org.address.toLowerCase()]?.length > 0) caps.push('treasury')
      try {
        if (db.select().from(schema.revenueReports).limit(1).all().length > 0) caps.push('portfolio', 'revenue')
        if (db.select().from(schema.trainingModules).limit(1).all().length > 0) caps.push('training')
        if (db.select().from(schema.proposals).limit(1).all().length > 0) caps.push('governance')
      } catch { /* ignored */ }
      capsByOrg[org.address.toLowerCase()] = caps
    }

    return NextResponse.json({ orgs, roles: rolesByOrg, aiAgents: aiAgentsByOrg, capabilities: capsByOrg })
  } catch { /* ignored */
    return NextResponse.json({ orgs: [], roles: {}, aiAgents: {}, capabilities: {} })
  }
}
