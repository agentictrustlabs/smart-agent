/**
 * hub-mcp client — every public knowledge-base read in the web app
 * routes through hub-mcp so caching (LRU + TTL + per-mutation
 * invalidation) happens in one place. Web no longer holds GraphDB
 * write credentials and no longer imports `@smart-agent/discovery` for
 * runtime data access.
 *
 * Server-only module. Imported by server actions and API routes.
 *
 * Transport: routes through the A2A gateway at
 * `<system>.agent.localhost:3100/mcp/hub/<tool>` via `callMcp('hub', …)`.
 * The gateway has a dedicated unauthenticated handler for the `hub`
 * server-key — hub-mcp is system-level (public KB + GraphDB sync)
 * and is not bound to any user delegation. Cache invalidation lives
 * inside hub-mcp's `sync:*` tools so read-after-write is consistent
 * through the gateway. Routing through A2A (instead of a direct
 * port-3900 fetch) keeps "everything goes through A2A" as the single
 * uniform transport for the web app.
 */

import { callMcp, McpCallError } from './mcp-client'
import type {
  KBAgent,
  KBAgentDetail,
  KBRelationshipEdge,
  AgentQueryOptions,
  Round,
  RoundListItem,
  RoundListFilters,
  Pool,
  PoolListItem,
  PoolListFilters,
  PoolAllocationSummary,
  SparqlResults,
  KBCandidateIntent,
  KBMatchInitiationMirror,
} from '@smart-agent/discovery'

export class HubCallError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HubCallError'
  }
}

/**
 * Invoke a hub-mcp tool by name. Returns the parsed JSON body the tool
 * writes via `mcpText(...)`. Goes through the A2A gateway's `/mcp/hub/*`
 * proxy so the routing surface stays uniform across person / org / hub.
 */
export async function callHub<T = unknown>(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await callMcp<T>('hub', tool, args)
  } catch (e) {
    if (e instanceof McpCallError) {
      throw new HubCallError(e.status, e.message)
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// Typed convenience wrappers — signatures match the equivalent
// `DiscoveryService.*` methods so callers can swap with minimal churn.
// ---------------------------------------------------------------------------

export async function hubListAgents(opts: AgentQueryOptions = {}): Promise<KBAgent[]> {
  const res = await callHub<{ agents: KBAgent[] }>('discovery:list_agents', opts as Record<string, unknown>)
  return res.agents
}

export async function hubGetAgentDetail(agentId: string): Promise<KBAgentDetail | null> {
  const res = await callHub<{ agent: KBAgentDetail | null }>('discovery:get_agent_detail', { agentId })
  return res.agent
}

export async function hubListRounds(filters: RoundListFilters): Promise<RoundListItem[]> {
  const res = await callHub<{ rounds: RoundListItem[] }>(
    'discovery:list_rounds',
    filters as unknown as Record<string, unknown>,
  )
  return res.rounds
}

export async function hubGetRoundDetail(
  roundId: string,
  viewerAgentId: string | null,
): Promise<Round | null> {
  const args: Record<string, unknown> = { roundId }
  if (viewerAgentId) args.viewerAgentId = viewerAgentId
  const res = await callHub<{ round: Round | null }>('discovery:get_round_detail', args)
  return res.round
}

export async function hubListPools(filters: PoolListFilters): Promise<PoolListItem[]> {
  const res = await callHub<{ pools: PoolListItem[] }>(
    'discovery:list_pools',
    filters as unknown as Record<string, unknown>,
  )
  return res.pools
}

export async function hubGetPoolDetail(
  poolId: string,
  viewerAgentId: string,
): Promise<Pool | null> {
  const res = await callHub<{ pool: Pool | null }>('discovery:get_pool_detail', {
    poolId,
    viewerAgentId,
  })
  return res.pool
}

export async function hubGetOutgoingEdges(agentId: string): Promise<KBRelationshipEdge[]> {
  const res = await callHub<{ edges: KBRelationshipEdge[] }>('discovery:get_outgoing_edges', { agentId })
  return res.edges
}

export async function hubGetIncomingEdges(agentId: string): Promise<KBRelationshipEdge[]> {
  const res = await callHub<{ edges: KBRelationshipEdge[] }>('discovery:get_incoming_edges', { agentId })
  return res.edges
}

export async function hubGetHopDistance(addressA: string, addressB: string): Promise<number | null> {
  const res = await callHub<{ hops: number | null }>('discovery:get_hop_distance', { addressA, addressB })
  return res.hops
}

export async function hubListRecentAllocations(
  poolId: string,
  viewerAgentId: string,
  limit: number = 5,
): Promise<PoolAllocationSummary[]> {
  const res = await callHub<{ allocations: PoolAllocationSummary[] }>(
    'discovery:list_recent_allocations',
    { poolId, viewerAgentId, limit },
  )
  return res.allocations
}

export async function hubRawSparql(sparql: string): Promise<SparqlResults> {
  const res = await callHub<{ results: SparqlResults }>('discovery:raw_sparql', { sparql })
  return res.results
}

export async function hubListCandidatesForIntent(opts: {
  viewedIntentId: string
  viewedDirection: 'receive' | 'give'
  viewedKind: string
  viewedExpresser: string
  limit?: number
}): Promise<KBCandidateIntent[]> {
  const res = await callHub<{ candidates: KBCandidateIntent[] }>(
    'discovery:list_candidates_for_intent',
    opts as Record<string, unknown>,
  )
  return res.candidates
}

export async function hubListActiveInitiationsForIntent(
  intentId: string,
): Promise<KBMatchInitiationMirror[]> {
  const res = await callHub<{ initiations: KBMatchInitiationMirror[] }>(
    'discovery:list_active_initiations_for_intent',
    { intentId },
  )
  return res.initiations
}

export async function hubCountAgentsByType(): Promise<Record<string, number>> {
  const res = await callHub<{ counts: Record<string, number> }>('discovery:count_agents_by_type', {})
  return res.counts
}

export async function hubCountEdges(): Promise<number> {
  const res = await callHub<{ count: number }>('discovery:count_edges', {})
  return res.count
}

// ---------------------------------------------------------------------------
// Sync triggers — web action layer calls these after on-chain writes so
// hub-mcp's read caches see the freshly-mirrored state.
// ---------------------------------------------------------------------------

export async function hubSyncAll(): Promise<{ ok: boolean; message?: string; agentCount?: number }> {
  return callHub('sync:all', {})
}

export async function hubSyncPool(
  poolAgentAddress: `0x${string}`,
  slug?: string,
): Promise<{ ok: boolean; message?: string }> {
  return callHub('sync:pool', slug ? { poolAgentAddress, slug } : { poolAgentAddress })
}

export async function hubSyncRound(slug: string): Promise<{ ok: boolean; message?: string }> {
  return callHub('sync:round', { slug })
}

export async function hubSyncAllPools(): Promise<{ ok: boolean; message?: string }> {
  return callHub('sync:all_pools', {})
}

export async function hubSyncAllCommitments(): Promise<{ ok: boolean; message?: string }> {
  return callHub('sync:all_commitments', {})
}

/**
 * Schedule a debounced full-graph sync. Use after user-driven writes —
 * `eager: true` skips the QUIET_MS debounce (still respects cooldown +
 * min-interval).
 */
export async function hubScheduleKbSync(eager: boolean = false): Promise<{ ok: boolean }> {
  return callHub('sync:schedule', { eager })
}

// ---------------------------------------------------------------------------
// Discovery-reader adapters
//
// Some SDK clients (PoolClient, side-signals ranking) accept a Discovery
// interface so they don't have to import `@smart-agent/discovery` directly.
// The web app constructs those clients with this hub-backed reader — every
// underlying read goes through hub-mcp and benefits from the cache.
// ---------------------------------------------------------------------------

export interface HubBackedDiscoveryReader {
  listAgents(opts?: AgentQueryOptions): Promise<KBAgent[]>
  getAgentDetail(agentId: string): Promise<KBAgentDetail | null>
  getOutgoingEdges(agentId: string): Promise<KBRelationshipEdge[]>
  getIncomingEdges(agentId: string): Promise<KBRelationshipEdge[]>
  listRounds(filters: RoundListFilters): Promise<RoundListItem[]>
  getRoundDetail(roundId: string, viewerAgentId: string | null): Promise<Round | null>
  listPools(filters: PoolListFilters): Promise<PoolListItem[]>
  getPoolDetail(poolId: string, viewerAgentId: string): Promise<Pool | null>
  listRecentAllocations(
    poolId: string,
    viewerAgentId: string,
    limit?: number,
  ): Promise<PoolAllocationSummary[]>
  listCandidatesForIntent(opts: {
    viewedIntentId: string
    viewedDirection: 'receive' | 'give'
    viewedKind: string
    viewedExpresser: string
    limit?: number
  }): Promise<KBCandidateIntent[]>
  listActiveInitiationsForIntent(intentId: string): Promise<KBMatchInitiationMirror[]>
  getHopDistance(addressA: string, addressB: string): Promise<number | null>
  rawQuery(sparql: string): Promise<SparqlResults>
}

/**
 * Build a hub-backed discovery reader satisfying both `PoolDiscoveryReader`
 * (from `@smart-agent/sdk/pools`) and `SideSignalsDiscovery`
 * (from `@smart-agent/sdk/matchmaker`). Use this anywhere the action layer
 * used to instantiate `DiscoveryService` solely as a reader.
 */
export function getHubDiscovery(): HubBackedDiscoveryReader {
  return {
    listAgents: hubListAgents,
    getAgentDetail: hubGetAgentDetail,
    getOutgoingEdges: hubGetOutgoingEdges,
    getIncomingEdges: hubGetIncomingEdges,
    listRounds: hubListRounds,
    getRoundDetail: hubGetRoundDetail,
    listPools: hubListPools,
    getPoolDetail: hubGetPoolDetail,
    listRecentAllocations: hubListRecentAllocations,
    listCandidatesForIntent: hubListCandidatesForIntent,
    listActiveInitiationsForIntent: hubListActiveInitiationsForIntent,
    getHopDistance: hubGetHopDistance,
    rawQuery: hubRawSparql,
  }
}
