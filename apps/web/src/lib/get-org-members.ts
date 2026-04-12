import { db, schema } from '@/db'
import { getEdgesByObject, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName } from '@smart-agent/sdk'

export interface OrgMember {
  address: string
  name: string
  roles: string[]
  status: string
  isPerson: boolean
}

/**
 * Get all members/partners of an org from on-chain relationship edges.
 */
export async function getOrgMembers(orgAddress: string): Promise<{ members: OrgMember[]; partners: OrgMember[] }> {
  const allPersonAgents = await db.select().from(schema.personAgents)
  const allUsers = await db.select().from(schema.users)
  const allOrgs = await db.select().from(schema.orgAgents)
  const allAI = await db.select().from(schema.aiAgents)
  const personAddrs = new Set(allPersonAgents.map(p => p.smartAccountAddress.toLowerCase()))

  const members: OrgMember[] = []
  const partners: OrgMember[] = []

  const getName = (addr: string) => {
    const pa = allPersonAgents.find(p => p.smartAccountAddress.toLowerCase() === addr.toLowerCase())
    if (pa) {
      const user = allUsers.find(u => u.id === pa.userId)
      return user?.name ?? (pa as Record<string, unknown>).name as string ?? addr.slice(0, 10)
    }
    const org = allOrgs.find(o => o.smartAccountAddress.toLowerCase() === addr.toLowerCase())
    if (org) return org.name
    const ai = allAI.find(a => a.smartAccountAddress.toLowerCase() === addr.toLowerCase())
    if (ai) return ai.name
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  try {
    const edgeIds = await getEdgesByObject(orgAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      const roles = await getEdgeRoles(edgeId)
      const roleNames = roles.map(r => roleName(r))
      const isPerson = personAddrs.has(edge.subject.toLowerCase())
      const target = isPerson ? members : partners

      const existing = target.find(m => m.address.toLowerCase() === edge.subject.toLowerCase())
      if (existing) {
        for (const r of roleNames) { if (!existing.roles.includes(r)) existing.roles.push(r) }
      } else {
        target.push({
          address: edge.subject, name: getName(edge.subject),
          roles: roleNames, status: 'Active', isPerson,
        })
      }
    }
  } catch { /* contracts not deployed */ }

  return { members, partners }
}

/**
 * Get connected org agents via ALLIANCE edges (outgoing from this org, transitively).
 */
export async function getConnectedOrgs(orgAddress: string): Promise<Array<{
  address: string; name: string; description: string; metadata: Record<string, unknown> | null; templateId: string | null
}>> {
  const allOrgs = await db.select().from(schema.orgAgents)
  const connectedAddrs = new Set<string>()

  try {
    const edgeIds = await getEdgesBySubject(orgAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status >= 2) connectedAddrs.add(edge.object_.toLowerCase())
    }

    // Transitive: find children of children
    let changed = true
    while (changed) {
      changed = false
      for (const addr of [...connectedAddrs]) {
        try {
          const childEdges = await getEdgesBySubject(addr as `0x${string}`)
          for (const ceid of childEdges) {
            const ce = await getEdge(ceid)
            if (ce.status >= 2 && !connectedAddrs.has(ce.object_.toLowerCase())) {
              connectedAddrs.add(ce.object_.toLowerCase())
              changed = true
            }
          }
        } catch { /* ignored */ }
      }
    }
  } catch { /* contracts not deployed */ }

  return allOrgs
    .filter(o => connectedAddrs.has(o.smartAccountAddress.toLowerCase()))
    .map(o => ({
      address: o.smartAccountAddress,
      name: o.name,
      description: o.description ?? '',
      metadata: (o as Record<string, unknown>).metadata ? (() => { try { return JSON.parse((o as Record<string, unknown>).metadata as string) } catch { return null } })() : null,
      templateId: (o as Record<string, unknown>).templateId as string | null,
    }))
}
