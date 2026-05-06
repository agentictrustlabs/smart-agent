'use server'

/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pool action layer.
 *
 * Server-only entry points for the pools index + detail pages. Pipes
 * through `@smart-agent/discovery` for public-mirror reads + applies the
 * proposer-side rank signals (proximity to the pool's stewardship agent +
 * cold-start outcomes per FR-015).
 *
 * Reads only. No on-chain or GraphDB writes.
 */

import { DiscoveryService } from '@smart-agent/discovery'
import {
  PoolClient,
  rank,
  computeBasis,
  type Pool,
  type PoolListFilters,
  type PoolListItem,
  type PoolAllocationSummary,
  type RankBasis,
  type SideSignalsDiscovery,
} from '@smart-agent/sdk'

export interface ListPoolsActionInput {
  hubId: string
  viewerAgentId: string
  domain?: string
  governanceModel?: string
  geo?: string
  search?: string
}

/**
 * Build a pool's proposer-side `RankBasis` snapshot.
 *
 * Per FR-015 + spec.md Q2: hops are computed to the pool's first-class
 * stewardship agent; for pools without a pool-level agent, fall back to the
 * MIN hop distance across the set of individual stewards (deterministic
 * minimum, not per-viewer pick).
 *
 * Prior outcomes: v1 returns (0, 0) — same cold-start TODO marker pattern as
 * spec 001 / spec 003. Once the downstream allocation spec ships, the pool's
 * own prior allocations will populate this signal.
 */
async function buildPoolBasis(
  pool: Pool,
  viewerAgentId: string,
  discovery: SideSignalsDiscovery,
): Promise<RankBasis> {
  // Resolve the proximity target. Per Q2 the pool's stewardship agent comes
  // first; otherwise the minimum across individual stewards.
  let proximityHops = 6
  const candidates: string[] = []
  if (pool.stewardshipAgent) candidates.push(pool.stewardshipAgent)
  for (const s of pool.stewards ?? []) candidates.push(s)
  let minHops: number | null = null
  for (const target of candidates) {
    if (!target) continue
    try {
      const hops = await discovery.getHopDistance(viewerAgentId, target)
      if (hops != null && (minHops == null || hops < minHops)) minHops = hops
    } catch {
      /* best-effort */
    }
  }
  if (minHops != null) proximityHops = minHops

  // TODO(downstream-allocation): replace cold-start (0, 0) with the pool's
  // own prior allocation outcome counts once the allocation/disbursement spec
  // ships. Same placeholder pattern as spec 001/003 unranked-cold-start.
  const priorOutcomes = { fulfilled: 0, abandoned: 0 }

  return computeBasis({ proximityHops, priorOutcomes })
}

/**
 * Fetch pools for the index page with optional filters; rank by the
 * spec-001 composite (0.6 * proximity + 0.4 * outcome). Returns `PoolListItem`
 * with the `basis` snapshot attached so the card component can render the
 * "why rank" cue.
 */
export async function listPoolsForViewer(
  input: ListPoolsActionInput,
): Promise<PoolListItem[]> {
  const filters: PoolListFilters = {
    hubId: input.hubId,
    viewerAgentId: input.viewerAgentId,
    domain: input.domain,
    governanceModel: input.governanceModel as PoolListFilters['governanceModel'],
    geo: input.geo,
    search: input.search,
  }

  const discovery = DiscoveryService.fromEnv()
  const client = new PoolClient(discovery)

  let pools: PoolListItem[] = []
  try {
    pools = await client.list(filters)
  } catch {
    pools = []
  }

  if (pools.length === 0) return pools

  // ─── US4 — proposer-side ranking ─────────────────────────────────
  const sideDiscovery = discovery as unknown as SideSignalsDiscovery
  let ranked: PoolListItem[] = pools
  try {
    const enriched = await Promise.all(
      pools.map(async (p) => {
        try {
          const basis = await buildPoolBasis(p, input.viewerAgentId, sideDiscovery)
          return { pool: p, basis }
        } catch {
          return { pool: p, basis: undefined as RankBasis | undefined }
        }
      }),
    )
    const rankInput = enriched.map(({ pool, basis }) => ({
      item: { pool, basis },
      signals: basis
        ? {
            proximityHops: basis.proximityHops,
            priorOutcomes: basis.priorOutcomes,
            // Tie-break on recency — most recently active pool first.
            // v1 has no allocation history; we use pledgedTotal as a
            // crude proxy (pools that have received pledges are
            // 'active'). FR-017 keeps this deterministic.
            recencyKey: String(pool.pledgedTotal ?? 0),
          }
        : {
            proximityHops: 6,
            priorOutcomes: { fulfilled: 0, abandoned: 0 },
            recencyKey: String(pool.pledgedTotal ?? 0),
          },
    }))
    const result = rank(rankInput)
    ranked = result.map((r) => ({
      ...r.item.pool,
      basis: (r.item.basis ?? r.basis) as RankBasis,
    }))
  } catch {
    /* discovery unavailable — keep unranked */
  }

  return ranked
}

export interface GetPoolDetailResult {
  pool: Pool | null
  basis?: RankBasis
}

/**
 * Fetch a single pool by id with rank basis attached. Returns null when the
 * pool is private and the viewer is not addressed (or doesn't exist).
 */
export async function getPoolForViewer(
  poolId: string,
  viewerAgentId: string,
): Promise<GetPoolDetailResult> {
  const discovery = DiscoveryService.fromEnv()
  const client = new PoolClient(discovery)
  let pool: Pool | null = null
  try {
    pool = await client.getById(poolId, viewerAgentId)
  } catch {
    pool = null
  }
  if (!pool) return { pool: null }
  let basis: RankBasis | undefined
  try {
    basis = await buildPoolBasis(pool, viewerAgentId, discovery as unknown as SideSignalsDiscovery)
  } catch {
    /* best-effort */
  }
  return { pool, basis }
}

/**
 * Fetch recent allocations for a pool. v1 returns empty (downstream
 * allocation spec hasn't shipped); the `storyPermissions`-aware aggregation
 * in DiscoveryService handles the FR-006 privacy rules once allocations
 * exist.
 */
export async function getPoolRecentAllocations(
  poolId: string,
  viewerAgentId: string,
  limit = 5,
): Promise<PoolAllocationSummary[]> {
  const discovery = DiscoveryService.fromEnv()
  const client = new PoolClient(discovery)
  try {
    return await client.getRecentAllocations(poolId, viewerAgentId, limit)
  } catch {
    return []
  }
}
