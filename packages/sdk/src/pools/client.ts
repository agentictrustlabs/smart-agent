/**
 * Spec 002 — Intent Marketplace (Pool Lane). PoolClient.
 *
 * Pass-through over `@smart-agent/discovery` for pool reads. The contract
 * (`specs/002-intent-marketplace-pool/contracts/pool.ts`) defines the
 * `PoolClient` shape — this is the v1 implementation:
 *
 *   - Public-tier reads: GraphDB mirror via DiscoveryService.listPools()
 *     and DiscoveryService.getPoolDetail().
 *   - Private-tier federated reads (pool bodies that live in the pool's
 *     org-mcp ONLY) deferred to a future implementation pass; the v1
 *     SPARQL filters out private pools the viewer isn't addressed to.
 *   - Recent allocations: read from the discovery layer; v1 returns empty
 *     since the downstream allocation spec hasn't shipped (mirrors the
 *     pattern in `priorStats.ts`).
 *
 * The client is constructed with a discovery instance so the SDK does not
 * need to know about env vars / fetching — that responsibility stays with
 * the action layer (apps/web).
 */

import type {
  Pool,
  PoolListFilters,
  PoolListItem,
  PoolAllocationSummary,
} from './types'

/**
 * Minimal discovery surface the client consumes. Lets callers pass either
 * a real `DiscoveryService` from `@smart-agent/discovery` or a mock for
 * tests — the SDK doesn't import the concrete class.
 */
export interface PoolDiscoveryReader {
  listPools(filters: PoolListFilters): Promise<PoolListItem[]>
  getPoolDetail(poolId: string, viewerAgentId: string): Promise<Pool | null>
  listRecentAllocations(
    poolId: string,
    viewerAgentId: string,
    limit?: number,
  ): Promise<PoolAllocationSummary[]>
}

/** Client interface from the spec contract. */
export interface IPoolClient {
  list(filters: PoolListFilters): Promise<PoolListItem[]>
  getById(id: string, viewerAgentId: string): Promise<Pool | null>
  getRecentAllocations(
    poolId: string,
    viewerAgentId: string,
    limit?: number,
  ): Promise<PoolAllocationSummary[]>
}

export class PoolClient implements IPoolClient {
  private discovery: PoolDiscoveryReader

  constructor(discovery: PoolDiscoveryReader) {
    this.discovery = discovery
  }

  async list(filters: PoolListFilters): Promise<PoolListItem[]> {
    return this.discovery.listPools(filters)
  }

  async getById(id: string, viewerAgentId: string): Promise<Pool | null> {
    return this.discovery.getPoolDetail(id, viewerAgentId)
  }

  async getRecentAllocations(
    poolId: string,
    viewerAgentId: string,
    limit?: number,
  ): Promise<PoolAllocationSummary[]> {
    return this.discovery.listRecentAllocations(poolId, viewerAgentId, limit)
  }
}
