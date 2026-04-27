import 'server-only'
import { cache } from 'react'
import { getEdge as rawGetEdge, getEdgeRoles as rawGetEdgeRoles, getEdgesBySubject as rawEdgesBySubject, getEdgesByObject as rawEdgesByObject } from '@/lib/contracts'
import { getAgentMetadata as rawGetAgentMetadata, buildAgentNameMap as rawBuildAgentNameMap } from '@/lib/agent-metadata'
import { getAgentKind as rawGetAgentKind } from '@/lib/agent-registry'
import { getConnectedOrgs as rawGetConnectedOrgs, getOrgMembers as rawGetOrgMembers } from '@/lib/get-org-members'
import { getUserOrgs as rawGetUserOrgs } from '@/lib/get-user-orgs'
import { roleName, relationshipTypeName } from '@smart-agent/sdk'

/**
 * Request-scoped memoization for the network page.
 *
 * Each tab on /network needs the same agent metadata + edges in different
 * shapes. Without memoization the same address gets fetched 4× (relationships
 * pass, hierarchy walk, member walk, map). React's `cache()` deduplicates
 * within a single render so the second hit is free.
 *
 * All loops here use Promise.all so RPC round-trips overlap instead of
 * stacking serially.
 */

export const getAgentMetadata = cache(rawGetAgentMetadata)
export const getAgentKind = cache(rawGetAgentKind)
export const getEdge = cache(rawGetEdge)
export const getEdgeRoles = cache(rawGetEdgeRoles)
export const getEdgesBySubject = cache(rawEdgesBySubject)
export const getEdgesByObject = cache(rawEdgesByObject)
export const getConnectedOrgs = cache(rawGetConnectedOrgs)
export const getOrgMembers = cache(rawGetOrgMembers)
export const getUserOrgs = cache(rawGetUserOrgs)
export const buildAgentNameMap = cache(rawBuildAgentNameMap)

const STATUS_NAMES = ['None', 'Proposed', 'Confirmed', 'Active', 'Suspended', 'Revoked', 'Rejected']

export type RelView = {
  edgeId: string
  direction: 'outgoing' | 'incoming'
  counterparty: string
  counterpartyAddr: string
  type: string
  roles: string[]
  status: string
  orgName: string
  orgAddr: string
}

/**
 * Aggregate every edge touching any of the user's orgs (subject or object),
 * with display names + role labels resolved. Single shared fetch — all four
 * tabs that need this data hit the cached promise.
 */
export const loadRelationships = cache(async (userId: string): Promise<{
  relationships: RelView[]
  outgoing: RelView[]
  incoming: RelView[]
  userOrgs: Awaited<ReturnType<typeof rawGetUserOrgs>>
}> => {
  const userOrgs = await getUserOrgs(userId)
  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => nameMap.get(a.toLowerCase())?.name ?? `${a.slice(0, 6)}...${a.slice(-4)}`

  // 1. Fan out edge-id lookups across all orgs in parallel.
  const idLists = await Promise.all(
    userOrgs.flatMap(org => [
      getEdgesBySubject(org.address as `0x${string}`).then(ids => ({ org, dir: 'outgoing' as const, ids })).catch(() => ({ org, dir: 'outgoing' as const, ids: [] as `0x${string}`[] })),
      getEdgesByObject(org.address as `0x${string}`).then(ids => ({ org, dir: 'incoming' as const, ids })).catch(() => ({ org, dir: 'incoming' as const, ids: [] as `0x${string}`[] })),
    ]),
  )

  // 2. Dedupe edge IDs while remembering which org first claimed it.
  type Pending = { edgeId: `0x${string}`; org: typeof userOrgs[number]; dir: 'outgoing' | 'incoming' }
  const seen = new Set<string>()
  const pending: Pending[] = []
  for (const { org, dir, ids } of idLists) {
    for (const edgeId of ids) {
      if (seen.has(edgeId)) continue
      seen.add(edgeId)
      pending.push({ edgeId, org, dir })
    }
  }

  // 3. Hydrate every edge in parallel (getEdge + getEdgeRoles overlap too).
  const relationships = await Promise.all(pending.map(async ({ edgeId, org, dir }): Promise<RelView | null> => {
    try {
      const [edge, roles] = await Promise.all([getEdge(edgeId), getEdgeRoles(edgeId)])
      const counterAddr = dir === 'outgoing' ? edge.object_ : edge.subject
      return {
        edgeId,
        direction: dir,
        counterparty: getName(counterAddr),
        counterpartyAddr: counterAddr,
        type: relationshipTypeName(edge.relationshipType, undefined, 'catalyst'),
        roles: roles.map(r => roleName(r, undefined, 'catalyst')),
        status: STATUS_NAMES[edge.status] ?? 'Unknown',
        orgName: org.name,
        orgAddr: org.address,
      }
    } catch { return null }
  })).then(rows => rows.filter((r): r is RelView => r !== null))

  return {
    relationships,
    outgoing: relationships.filter(r => r.direction === 'outgoing'),
    incoming: relationships.filter(r => r.direction === 'incoming'),
    userOrgs,
  }
})
