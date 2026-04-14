import { getEdgesByObject, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName } from '@smart-agent/sdk'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getAgentKind } from '@/lib/agent-registry'
import { getAgentGenMapData, getAgentTemplateId } from '@/lib/agent-resolver'

export interface OrgMember {
  address: string
  name: string
  roles: string[]
  status: string
  isPerson: boolean
}

/**
 * Get all members/partners of an org from on-chain edges.
 * Names from resolver. Agent kind from resolver agentType.
 */
export async function getOrgMembers(orgAddress: string): Promise<{ members: OrgMember[]; partners: OrgMember[] }> {
  const members: OrgMember[] = []
  const partners: OrgMember[] = []

  try {
    const edgeIds = await getEdgesByObject(orgAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      const roles = await getEdgeRoles(edgeId)
      const roleNames = roles.map(r => roleName(r))
      const kind = await getAgentKind(edge.subject)
      if (kind === 'hub' || kind === 'unknown') continue // skip hub agents and unregistered
      const isPerson = kind === 'person'
      const meta = await getAgentMetadata(edge.subject)
      const target = isPerson ? members : partners

      const existing = target.find(m => m.address.toLowerCase() === edge.subject.toLowerCase())
      if (existing) {
        for (const r of roleNames) { if (!existing.roles.includes(r)) existing.roles.push(r) }
      } else {
        target.push({ address: edge.subject, name: meta.displayName, roles: roleNames, status: 'Active', isPerson })
      }
    }
  } catch { /* ignored */ }

  return { members, partners }
}

/**
 * Get connected org agents via ALLIANCE edges (outgoing, transitively).
 */
export async function getConnectedOrgs(orgAddress: string): Promise<Array<{
  address: string; name: string; description: string; metadata: Record<string, unknown> | null; templateId: string | null
}>> {
  const connectedAddrs = new Set<string>()

  try {
    const edgeIds = await getEdgesBySubject(orgAddress as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status >= 2) connectedAddrs.add(edge.object_.toLowerCase())
    }

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
  } catch { /* ignored */ }

  const results: Array<{ address: string; name: string; description: string; metadata: Record<string, unknown> | null; templateId: string | null }> = []
  for (const addr of connectedAddrs) {
    const meta = await getAgentMetadata(addr)
    results.push({
      address: addr,
      name: meta.displayName,
      description: meta.description,
      metadata: await getAgentGenMapData(addr),
      templateId: await getAgentTemplateId(addr),
    })
  }
  return results
}
