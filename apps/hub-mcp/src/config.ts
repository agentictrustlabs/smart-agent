/**
 * hub-mcp config — aggregate knowledge-base service.
 *
 * Owns:
 *   - All DiscoveryService reads (GraphDB SPARQL) for the web app + other
 *     MCPs. Web app MUST NOT import `@smart-agent/discovery` directly.
 *     All KB reads pass through this MCP so we can cache aggressively in
 *     one place.
 *   - All GraphDB writes / on-chain → KB sync. Web MUST NOT hold GraphDB
 *     write credentials. Per-mutation read-after-write fences live here.
 *
 * See: docs/architecture/principles.md + the A2A-First Routing
 *      Consolidation plan (Phase 5).
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env. Try app-local first (apps/hub-mcp/.env), then apps/web/.env,
// then repo root .env. Web's .env is the canonical source for shared infra
// (GraphDB credentials, contract addresses) — hub-mcp piggybacks on it
// rather than maintaining its own copy.
const envCandidates = [
  '.env',
  resolve(__dirname, '../../web/.env'),
  resolve(__dirname, '../../../apps/web/.env'),
  resolve(__dirname, '../../../.env'),
]
for (const path of envCandidates) {
  try {
    const envFile = readFileSync(path, 'utf-8')
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx)
        const val = trimmed.slice(eqIdx + 1)
        if (!process.env[key]) process.env[key] = val
      }
    }
    break // first hit wins
  } catch { /* try next */ }
}

function num(name: string, def: number): number {
  const v = process.env[name]
  return v && /^\d+$/.test(v) ? parseInt(v, 10) : def
}

export const config = {
  PORT: num('HUB_MCP_PORT', 3900),

  // GraphDB endpoint — hub-mcp owns reads+writes against this. Other
  // services should not connect directly. The DiscoveryService SDK reads
  // these same env names (GRAPHDB_BASE_URL / GRAPHDB_REPOSITORY) so a
  // single source-of-truth governs both. Old aliases kept for transition.
  GRAPHDB_URL: process.env.GRAPHDB_BASE_URL ?? process.env.GRAPHDB_URL ?? 'https://graphdb.agentkg.io',
  GRAPHDB_REPO: process.env.GRAPHDB_REPOSITORY ?? process.env.GRAPHDB_REPO ?? 'SmartAgents',

  // Cache tuning. The hub-mcp keeps an in-process LRU per tool family so
  // every web read doesn't round-trip to GraphDB. Invalidated by writes
  // through the same process (see lib/cache.ts).
  CACHE_TTL_MS: num('HUB_CACHE_TTL_MS', 5_000),
  CACHE_MAX_ENTRIES: num('HUB_CACHE_MAX_ENTRIES', 2_000),
} as const
