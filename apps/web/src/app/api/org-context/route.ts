import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getEdgesBySubject } from '@/lib/contracts'
import { getPersonAgentForUser, getOrgsForPersonAgent, getAiAgentsForOrg } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getAgentTemplateId } from '@/lib/agent-resolver'

export async function GET() {
  try {
    const { getSession } = await import('@/lib/auth/session')
    const session = await getSession()
    if (!session) return NextResponse.json({ orgs: [], roles: {}, aiAgents: {}, capabilities: {} })

    const users = await db.select().from(schema.users)
      .where(eq(schema.users.did, session.userId)).limit(1)
    if (!users[0]) return NextResponse.json({ orgs: [], roles: {}, aiAgents: {}, capabilities: {} })

    // Find person agent from on-chain registry
    const personAddr = await getPersonAgentForUser(users[0].id)

    // Find orgs via on-chain edges
    const orgRoles = personAddr ? await getOrgsForPersonAgent(personAddr) : []
    const rolesByOrg: Record<string, string[]> = {}
    for (const o of orgRoles) rolesByOrg[o.address.toLowerCase()] = o.roles

    // Build org list with on-chain metadata
    const orgs: Array<{ address: string; name: string; description: string; templateId: string | null }> = []
    for (const o of orgRoles) {
      const meta = await getAgentMetadata(o.address)
      orgs.push({
        address: o.address,
        name: meta.displayName,
        description: meta.description,
        templateId: await getAgentTemplateId(o.address),
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
        if (db.select().from(schema.trainingModules).limit(1).all().length > 0) caps.push('training')
      } catch { /* ignored */ }
      // Revenue / proposal capabilities now live in org-mcp; gating belongs
      // there (per-org delegation scope), not on existence of any row in the
      // web SQL. Until per-org capability check lands, surface conservatively.
      caps.push('portfolio', 'revenue', 'governance')
      capsByOrg[org.address.toLowerCase()] = caps
    }

    return NextResponse.json({ orgs, roles: rolesByOrg, aiAgents: aiAgentsByOrg, capabilities: capsByOrg })
  } catch { /* ignored */
    return NextResponse.json({ orgs: [], roles: {}, aiAgents: {}, capabilities: {} })
  }
}
