'use server'

/**
 * People-search aggregator — the engine behind /people/discover and the
 * Cmd+K palette. Lighter-weight than the full ZK trust-overlap path
 * (`trust-search.action.ts`): no proof, no held-credential intersection,
 * just catalog + on-chain edges.
 *
 *   1. Pull the agent catalog from the GraphDB knowledge base
 *      (DiscoveryService.listAgents — supports search and capability filter).
 *   2. Compute the caller's relational-distance map once (1 RPC fan-out
 *      across the caller's edge neighborhood).
 *   3. Classify every candidate (1st / 2nd / 3rd / 4th degree).
 *   4. Sort: nearer rings first, then by name match relevance.
 *
 * The caller's identity is inferred from the session — no parameters.
 * Returns degree-bucketed results ready for direct render.
 */

import { DiscoveryService } from '@smart-agent/discovery'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import {
  buildDistanceMap,
  classifyDistance,
  type DistanceMap,
  type Classification,
} from '@/lib/people-graph/relational-distance'

export interface PeopleSearchHit {
  address: `0x${string}`
  displayName: string
  primaryName: string | null
  description: string
  capabilities: string[]
  trustModels: string[]
  degree: 1 | 2 | 3 | 4
  reason: string
}

export interface PeopleSearchResult {
  /** True when the caller's relational-distance map was built; false
   *  means we returned a degree-4 (open) view because the caller has
   *  no on-chain person agent yet. */
  callerScored: boolean
  /** Total candidates returned (after limit). */
  count: number
  /** Hits, sorted near→far. */
  hits: PeopleSearchHit[]
}

const DEFAULT_LIMIT = 40

export async function searchPeople(opts: {
  query?: string
  capability?: string
  limit?: number
} = {}): Promise<PeopleSearchResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT

  // ── 1. Catalog ──────────────────────────────────────────────────
  const discovery = DiscoveryService.fromEnv()
  let agents: Awaited<ReturnType<typeof discovery.listAgents>> = []
  try {
    agents = await discovery.listAgents({
      agentType: 'person',
      search: opts.query?.trim() || undefined,
      capability: opts.capability?.trim() || undefined,
      sortBy: 'name',
      sortDir: 'asc',
      limit: Math.max(limit * 2, 80),    // overfetch, we'll re-rank
    })
  } catch (err) {
    console.error('[searchPeople] listAgents failed:', err)
    return { callerScored: false, count: 0, hits: [] }
  }

  // ── 2. Caller distance map (best-effort) ────────────────────────
  let distanceMap: DistanceMap | null = null
  try {
    const me = await getCurrentUser()
    const caller = me ? await getPersonAgentForUser(me.id) : null
    if (caller) distanceMap = await buildDistanceMap(caller as `0x${string}`)
  } catch (err) {
    console.error('[searchPeople] distance map failed:', err)
  }

  // ── 3. Classify + filter out caller themselves ──────────────────
  const callerLc = distanceMap?.caller.toLowerCase()
  const enriched = agents
    .filter(a => !!a.address && a.address.toLowerCase() !== callerLc)
    .map(a => {
      const cls: Classification = distanceMap
        ? classifyDistance(distanceMap, a.address as `0x${string}`)
        : { degree: 4, reason: 'Open registry' }
      return {
        address: a.address as `0x${string}`,
        displayName: a.displayName || a.primaryName || a.address,
        primaryName: a.primaryName || null,
        description: a.description,
        capabilities: a.capabilities,
        trustModels: a.trustModels,
        degree: cls.degree,
        reason: cls.reason,
      } satisfies PeopleSearchHit
    })

  // ── 4. Sort: near first, then by name ───────────────────────────
  enriched.sort((a, b) => {
    if (a.degree !== b.degree) return a.degree - b.degree
    return a.displayName.localeCompare(b.displayName)
  })

  const hits = enriched.slice(0, limit)
  return { callerScored: !!distanceMap, count: hits.length, hits }
}
