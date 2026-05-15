/**
 * Thin shim — the real on-chain → GraphDB sync implementation now lives in
 * hub-mcp (`apps/hub-mcp/src/lib/graphdb-sync.ts`). Phase 5 of the
 * A2A-First Routing Consolidation moved every emitter + every
 * DELETE+INSERT codepath out of the web app so the read cache (in hub-mcp)
 * sits in the same process as the writes that invalidate it.
 *
 * Existing call sites keep importing `syncOnChainToGraphDB`,
 * `syncPoolToGraphDB`, etc. — those names now route through the hub-mcp
 * `sync:*` tool surface. The web no longer holds GraphDB write
 * credentials.
 *
 * Deprecated — new code should import from `@/lib/clients/hub-client`
 * directly (`hubSyncAll`, `hubSyncPool`, `hubSyncRound`, etc.).
 */

import {
  hubSyncAll,
  hubSyncPool,
  hubSyncRound,
  hubSyncAllPools,
  hubSyncAllCommitments,
} from '@/lib/clients/hub-client'

// ---------------------------------------------------------------------------
// Sync entrypoints — every name preserved so Phase 4 files keep compiling.
// ---------------------------------------------------------------------------

export async function syncOnChainToGraphDB(): Promise<{
  success: boolean
  message: string
  agentCount?: number
}> {
  try {
    const r = await hubSyncAll()
    return { success: r.ok, message: r.message ?? '', agentCount: r.agentCount }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function syncPoolToGraphDB(
  poolAgentAddress: `0x${string}`,
  slug?: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await hubSyncPool(poolAgentAddress, slug)
    return { ok: r.ok, message: r.message ?? '' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function syncRoundToGraphDB(slug: string): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await hubSyncRound(slug)
    return { ok: r.ok, message: r.message ?? '' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function syncAllPoolsToGraphDB(): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await hubSyncAllPools()
    return { ok: r.ok, message: r.message ?? '' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function syncAllCommitmentsToGraphDB(): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await hubSyncAllCommitments()
    return { ok: r.ok, message: r.message ?? '' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Raw turtle dump for the agents named graph. Web's `/api/ontology-sync/turtle`
 * route still uses this for debug; we proxy through hub-mcp's
 * `/debug/agents-turtle` HTTP endpoint.
 */
export async function emitAgentsTurtle(): Promise<string> {
  const HUB_MCP_URL = process.env.HUB_MCP_URL ?? 'http://localhost:3900'
  try {
    const res = await fetch(`${HUB_MCP_URL}/debug/agents-turtle`)
    if (!res.ok) {
      console.warn(`[kb-sync] hub-mcp turtle dump failed: ${res.status} ${res.statusText}`)
      return ''
    }
    return await res.text()
  } catch (err) {
    console.warn('[kb-sync] hub-mcp turtle dump threw:', err instanceof Error ? err.message : err)
    return ''
  }
}
