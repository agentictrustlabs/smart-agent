/**
 * `sync:*` tools — every on-chain → GraphDB sync runs here. Web MUST
 * NOT hold GraphDB write credentials; it enqueues sync requests via
 * these tools instead.
 *
 * Phase 5 — implementation moved in-process. The DELETE+INSERT SPARQL
 * logic lives in `../lib/graphdb-sync.ts` (relocated from
 * `apps/web/src/lib/ontology/graphdb-sync.ts`). On every successful
 * write the relevant `discovery:*` cache family is invalidated so the
 * immediately-following read sees the new state.
 */

import { cacheInvalidateFamily } from '../lib/cache.js'
import {
  syncOnChainToGraphDB,
  syncPoolToGraphDB,
  syncRoundToGraphDB,
  syncAllPoolsToGraphDB,
  syncAllCommitmentsToGraphDB,
} from '../lib/graphdb-sync.js'
import { scheduleKbSync, scheduleKbSyncEager } from '../lib/kb-write-through.js'

function mcpText(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
}

function invalidateAll(): void {
  cacheInvalidateFamily('agents')
  cacheInvalidateFamily('agent_detail')
  cacheInvalidateFamily('rounds')
  cacheInvalidateFamily('round_detail')
  cacheInvalidateFamily('pools')
  cacheInvalidateFamily('pool_detail')
}

export const syncTools = {
  syncAll: {
    name: 'sync:all',
    description: 'Full on-chain → GraphDB resync. Use after a fresh-start or large batch of writes.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const result = await syncOnChainToGraphDB()
      if (result.success) invalidateAll()
      return mcpText({ ok: result.success, message: result.message, agentCount: result.agentCount })
    },
  },

  syncPool: {
    name: 'sync:pool',
    description: 'Splice a single pool\'s triples into GraphDB after on-chain create/update. Invalidates pool caches.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        poolAgentAddress: { type: 'string' },
        slug: { type: 'string' },
      },
      required: ['poolAgentAddress'],
    },
    handler: async (args: Record<string, unknown>) => {
      const poolAgentAddress = (args.poolAgentAddress as `0x${string}`) ?? (args.poolId as `0x${string}`)
      const slug = args.slug as string | undefined
      const result = await syncPoolToGraphDB(poolAgentAddress, slug)
      if (result.ok) {
        cacheInvalidateFamily('pools')
        cacheInvalidateFamily('pool_detail')
      }
      return mcpText(result)
    },
  },

  syncRound: {
    name: 'sync:round',
    description: 'Splice a single round\'s triples into GraphDB. Invalidates round caches.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        roundId: { type: 'string' },
        slug: { type: 'string' },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      const slug = (args.slug as string) ?? (args.roundId as string)
      if (!slug) return mcpText({ ok: false, message: 'roundId or slug required' })
      const result = await syncRoundToGraphDB(slug)
      if (result.ok) {
        cacheInvalidateFamily('rounds')
        cacheInvalidateFamily('round_detail')
      }
      return mcpText(result)
    },
  },

  syncAllPools: {
    name: 'sync:all_pools',
    description: 'Resync every pool aggregate (pledgedTotal, allocatedTotal, …). Cheap; replaces all sa:Pool subjects.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const result = await syncAllPoolsToGraphDB()
      if (result.ok) {
        cacheInvalidateFamily('pools')
        cacheInvalidateFamily('pool_detail')
      }
      return mcpText(result)
    },
  },

  syncAllCommitments: {
    name: 'sync:all_commitments',
    description: 'Resync every sa:Commitment subject from the on-chain registry. Called after closeRound / release / cancel.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const result = await syncAllCommitmentsToGraphDB()
      // Commitments don't have a dedicated cache family yet; rounds + pools cover the
      // typical surfaces that read commitment state. Invalidate broadly to be safe.
      if (result.ok) {
        cacheInvalidateFamily('rounds')
        cacheInvalidateFamily('round_detail')
      }
      return mcpText(result)
    },
  },

  /**
   * Schedule a debounced full-graph sync. Returns immediately — actual sync
   * runs inside the QUIET_MS window and coalesces bursts. Caches are
   * invalidated when the sync completes via the kb-write-through hook.
   */
  scheduleSync: {
    name: 'sync:schedule',
    description: 'Debounced sync schedule. Web actions call this after writes; bursts coalesce.',
    inputSchema: {
      type: 'object' as const,
      properties: { eager: { type: 'boolean' } },
    },
    handler: async (args: Record<string, unknown>) => {
      if (args.eager) scheduleKbSyncEager()
      else scheduleKbSync()
      return mcpText({ ok: true, scheduled: true, eager: !!args.eager })
    },
  },
}
