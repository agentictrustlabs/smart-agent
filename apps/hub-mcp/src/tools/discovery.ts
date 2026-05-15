/**
 * `discovery:*` tools — every public knowledge-base read in the system
 * passes through these tools so caching, query batching, and read-after-
 * write fencing happen in one place.
 *
 * Web app + other MCPs MUST NOT instantiate `DiscoveryService` directly;
 * they call hub-mcp via the A2A proxy.
 */

import { DiscoveryService } from '@smart-agent/discovery'
import { cacheGet, cacheSet, cacheKey } from '../lib/cache.js'

const discovery = DiscoveryService.fromEnv()

function mcpText(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
}

/** Wrap a discovery method so its result is cached under `family` by the
 *  tool args. Mutations through hub-mcp invalidate by family. */
async function cached<T>(family: string, args: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const key = cacheKey(family, args)
  const hit = cacheGet<T>(key)
  if (hit !== undefined) return hit
  const value = await run()
  cacheSet(key, value)
  return value
}

export const discoveryTools = {
  listAgents: {
    name: 'discovery:list_agents',
    description: 'List agents in the knowledge graph. Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentType: { type: 'string' },
        search: { type: 'string' },
        capability: { type: 'string' },
        templateId: { type: 'string' },
        sortBy: { type: 'string' },
        sortDir: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('agents', args, () =>
        discovery.listAgents(args as Parameters<typeof discovery.listAgents>[0]),
      )
      return mcpText({ agents: result })
    },
  },

  getAgentDetail: {
    name: 'discovery:get_agent_detail',
    description: 'Get a single agent\'s detail. Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: { agentId: { type: 'string' } },
      required: ['agentId'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('agent_detail', args, () =>
        discovery.getAgentDetail(args.agentId as string),
      )
      return mcpText({ agent: result })
    },
  },

  listRounds: {
    name: 'discovery:list_rounds',
    description: 'List grant rounds (filters: hubId, fundId, status). Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hubId: { type: 'string' },
        fundId: { type: 'string' },
        status: { type: 'string' },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('rounds', args, () =>
        discovery.listRounds(args as unknown as Parameters<typeof discovery.listRounds>[0]),
      )
      return mcpText({ rounds: result })
    },
  },

  getRoundDetail: {
    name: 'discovery:get_round_detail',
    description: 'Get a round\'s detail (mandate, deadlines, voting config). Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        roundId: { type: 'string' },
        viewerAgentId: { type: 'string' },
      },
      required: ['roundId'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('round_detail', args, () =>
        discovery.getRoundDetail(args.roundId as string, (args.viewerAgentId as string) ?? null),
      )
      return mcpText({ round: result })
    },
  },

  listPools: {
    name: 'discovery:list_pools',
    description: 'List pools (filters: hubId, viewerAgentId, search). Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hubId: { type: 'string' },
        viewerAgentId: { type: 'string' },
        search: { type: 'string' },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('pools', args, () =>
        discovery.listPools(args as unknown as Parameters<typeof discovery.listPools>[0]),
      )
      return mcpText({ pools: result })
    },
  },

  getPoolDetail: {
    name: 'discovery:get_pool_detail',
    description: 'Get a pool\'s detail. Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        poolId: { type: 'string' },
        viewerAgentId: { type: 'string' },
      },
      required: ['poolId', 'viewerAgentId'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('pool_detail', args, () =>
        discovery.getPoolDetail(args.poolId as string, args.viewerAgentId as string),
      )
      return mcpText({ pool: result })
    },
  },

  getOutgoingEdges: {
    name: 'discovery:get_outgoing_edges',
    description: 'Outgoing relationship edges from an agent. Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: { agentId: { type: 'string' } },
      required: ['agentId'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('out_edges', args, () =>
        discovery.getOutgoingEdges(args.agentId as string),
      )
      return mcpText({ edges: result })
    },
  },

  getIncomingEdges: {
    name: 'discovery:get_incoming_edges',
    description: 'Incoming relationship edges to an agent. Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: { agentId: { type: 'string' } },
      required: ['agentId'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('in_edges', args, () =>
        discovery.getIncomingEdges(args.agentId as string),
      )
      return mcpText({ edges: result })
    },
  },

  getHopDistance: {
    name: 'discovery:get_hop_distance',
    description: 'Minimum hop distance between two agents in the relationship graph (null when unreachable). Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        addressA: { type: 'string' },
        addressB: { type: 'string' },
      },
      required: ['addressA', 'addressB'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('hops', args, () =>
        discovery.getHopDistance(args.addressA as string, args.addressB as string),
      )
      return mcpText({ hops: result })
    },
  },

  listRecentAllocations: {
    name: 'discovery:list_recent_allocations',
    description: 'Recent allocations for a pool (story-permissions aware). Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        poolId: { type: 'string' },
        viewerAgentId: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['poolId', 'viewerAgentId'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('pool_allocations', args, () =>
        discovery.listRecentAllocations(
          args.poolId as string,
          args.viewerAgentId as string,
          (args.limit as number) ?? 5,
        ),
      )
      return mcpText({ allocations: result })
    },
  },

  rawSparql: {
    name: 'discovery:raw_sparql',
    description: 'Escape hatch — run a raw SPARQL SELECT query. Use only when no typed tool exists. Cached by query string.',
    inputSchema: {
      type: 'object' as const,
      properties: { sparql: { type: 'string' } },
      required: ['sparql'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('raw_sparql', args, () =>
        discovery.rawQuery(args.sparql as string),
      )
      return mcpText({ results: result })
    },
  },

  listCandidatesForIntent: {
    name: 'discovery:list_candidates_for_intent',
    description: 'Spec 001 — public-tier candidate intents for a viewed intent. Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        viewedIntentId: { type: 'string' },
        viewedDirection: { type: 'string' },
        viewedKind: { type: 'string' },
        viewedExpresser: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['viewedIntentId', 'viewedDirection', 'viewedKind', 'viewedExpresser'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('candidates', args, () =>
        discovery.listCandidatesForIntent(args as Parameters<typeof discovery.listCandidatesForIntent>[0]),
      )
      return mcpText({ candidates: result })
    },
  },

  listActiveInitiationsForIntent: {
    name: 'discovery:list_active_initiations_for_intent',
    description: 'Spec 001 — active (pending) MatchInitiations referencing an intent. Cached.',
    inputSchema: {
      type: 'object' as const,
      properties: { intentId: { type: 'string' } },
      required: ['intentId'],
    },
    handler: async (args: Record<string, unknown>) => {
      const result = await cached('initiations', args, () =>
        discovery.listActiveInitiationsForIntent(args.intentId as string),
      )
      return mcpText({ initiations: result })
    },
  },

  countAgentsByType: {
    name: 'discovery:count_agents_by_type',
    description: 'Counts of agents grouped by type (person/org/ai/hub). Cached.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const result = await cached('agent_counts', {}, () => discovery.countAgentsByType())
      return mcpText({ counts: result })
    },
  },

  countEdges: {
    name: 'discovery:count_edges',
    description: 'Total relationship edges in the KB. Cached.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const result = await cached('edge_count', {}, () => discovery.countEdges())
      return mcpText({ count: result })
    },
  },
}
