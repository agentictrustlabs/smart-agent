import { getEdgesByObject, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, ALLIANCE, GENERATIONAL_LINEAGE } from '@smart-agent/sdk'
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
 * Get connected org agents via outgoing edges, walked transitively.
 *
 * Performance: BFS by level with each level fanned out via Promise.all,
 * and per-result enrichment (metadata + genmap + template) also runs in
 * parallel. The previous sequential implementation was 5–10s per call on
 * the demo seed because every getEdge and getAgentMetadata round-tripped
 * to anvil one at a time; this version is dominated by the depth of the
 * graph rather than its size.
 */
export async function getConnectedOrgs(orgAddress: string): Promise<Array<{
  address: string; name: string; description: string; metadata: Record<string, unknown> | null; templateId: string | null
}>> {
  const connectedAddrs = new Set<string>()

  // BFS expand a frontier of addresses. At each level: fan out
  // getEdgesBySubject in parallel, then fan out getEdge for every
  // discovered edge in parallel. Cap depth to avoid pathological loops
  // even though the seen-set already prevents cycles.
  let frontier: string[] = [orgAddress]
  let depth = 0
  while (frontier.length > 0 && depth < 8) {
    const edgeIdLists = await Promise.all(frontier.map(a =>
      getEdgesBySubject(a as `0x${string}`).catch(() => [] as `0x${string}`[]),
    ))
    const allEdgeIds = edgeIdLists.flat()
    if (allEdgeIds.length === 0) break

    const edges = await Promise.all(allEdgeIds.map(id => getEdge(id).catch(() => null)))
    const next: string[] = []
    for (const e of edges) {
      if (!e || e.status < 2) continue
      // Only follow Alliance + Generational Lineage edges. The previous
      // implementation walked every outgoing edge type — Hub Membership,
      // Namespace Contains, Coaching, etc. — which exploded the BFS by
      // 10× on the demo seed (every member edge from a hub spilled into
      // the search). Connected Orgs by definition is the alliance/parent
      // network, not the entire reachable graph.
      const t = e.relationshipType.toLowerCase()
      if (t !== (ALLIANCE as string).toLowerCase() && t !== (GENERATIONAL_LINEAGE as string).toLowerCase()) continue
      const obj = e.object_.toLowerCase()
      if (connectedAddrs.has(obj)) continue
      connectedAddrs.add(obj)
      next.push(e.object_)
    }
    frontier = next
    depth++
  }

  // Per-address enrichment: every metadata + genmap + template lookup
  // overlaps. ~3× speedup over the sequential triple-await per addr.
  const addrList = [...connectedAddrs]
  const enriched = await Promise.all(addrList.map(async addr => {
    const [meta, genmap, templateId] = await Promise.all([
      getAgentMetadata(addr).catch(() => ({ displayName: '', description: '' } as { displayName: string; description: string })),
      getAgentGenMapData(addr).catch(() => null),
      getAgentTemplateId(addr).catch(() => null),
    ])
    return { address: addr, name: meta.displayName, description: meta.description, metadata: genmap, templateId }
  }))
  return enriched
}
