/**
 * Spec 007 Phase F.2 — A2A Agent storage pool.
 *
 * Resolves the active backend (Postgres in production, SQLite in dev when
 * `A2A_AGENT_PG_URL` is unset) and exposes a unified `consumeInterServiceNonce`
 * primitive used by every inter-service auth middleware. This is the
 * load-bearing replay-protection surface — the previous SQLite SELECT-then-INSERT
 * pattern was racy under concurrent load; the new path uses
 * `ON CONFLICT DO NOTHING` (Postgres) or `INSERT OR IGNORE` (SQLite) so
 * exactly one of two concurrent identical inserts wins by construction.
 *
 * This module also exposes the production startup guard the service's
 * `index.ts` calls before binding the HTTP listener.
 */
import postgres from 'postgres'
import {
  assertProductionStorageBackend,
  consumeNonce,
  resolveStorageBackend,
  type ConsumeNonceClient,
  type PgSqlLike,
  type StorageBackend,
} from '@smart-agent/sdk'
import { sqliteHandle } from './index'

// ─── Backend resolution ───────────────────────────────────────────────

const SQLITE_FALLBACK_PATH = 'local.db'

/**
 * Resolved at module load. The service's `assertProductionStorageBackend()`
 * call in `index.ts` already errored out if production is misconfigured;
 * by the time we get here in dev or after the guard passes in prod, this
 * resolution is safe.
 */
export const storageBackend: StorageBackend = resolveStorageBackend(
  process.env,
  'A2A_AGENT',
  SQLITE_FALLBACK_PATH,
)

// ─── Postgres pool (lazy) ─────────────────────────────────────────────

/**
 * `postgres-js` connection pool. Lazily initialised so the SQLite-only
 * dev path doesn't pay for an unused connection slot. Pool settings
 * match the Phase F.2 spec defaults:
 *   - `max` connections: 10 (dev), 25 (prod default)
 *   - `idle_timeout`: 30s
 *   - `connect_timeout`: 5s
 *   - `prepare`: false in dev, true in prod
 */
let _pgClient: ReturnType<typeof postgres> | null = null

export function getPgClient(): ReturnType<typeof postgres> {
  if (storageBackend.kind !== 'pg') {
    throw new Error('getPgClient: storage backend is not Postgres')
  }
  if (_pgClient) return _pgClient
  const isProd = process.env.NODE_ENV === 'production'
  _pgClient = postgres(storageBackend.url, {
    max: isProd ? 25 : 10,
    idle_timeout: 30,
    connect_timeout: 5,
    prepare: isProd,
  })
  return _pgClient
}

/**
 * Best-effort pool teardown for tests + graceful shutdown.
 */
export async function closePgClient(): Promise<void> {
  if (_pgClient) {
    await _pgClient.end({ timeout: 5 })
    _pgClient = null
  }
}

// ─── Nonce-consume primitive ─────────────────────────────────────────

/**
 * Active consume-nonce client. The `inter_service_nonces` table is the
 * Phase F.2 canonical name (UNIQUE `(scope, nonce)`); the legacy
 * `inter_service_nonce` (singular) SQLite table is also supported via the
 * `tableOverride` argument so the SQLite arm keeps working until the
 * service cuts over fully.
 */
function getConsumeClient(): ConsumeNonceClient {
  if (storageBackend.kind === 'pg') {
    // postgres-js's default export is callable + has `.unsafe` — the
    // structural `PgSqlLike` shape in the SDK matches.
    const pg = getPgClient() as unknown as PgSqlLike
    return { kind: 'pg', sql: pg }
  }
  return { kind: 'sqlite', handle: sqliteHandle }
}

/**
 * Consume a fresh inter-service-auth nonce. Returns true if the nonce
 * was successfully claimed (fresh); false if the nonce was already
 * present (replay rejected).
 *
 * The middleware caller maps a `false` return to a 401 "replay detected"
 * response.
 *
 * In SQLite mode the table is the legacy `inter_service_nonce` (note:
 * singular). In Postgres mode it is `inter_service_nonces` (plural)
 * with the canonical `(scope, nonce)` UNIQUE.
 */
export async function consumeInterServiceNonce(opts: {
  service: string
  nonce: string
}): Promise<boolean> {
  if (storageBackend.kind === 'pg') {
    return consumeNonce({
      client: getConsumeClient(),
      table: 'inter_service_nonces',
      scopeColumn: 'scope',
      scope: opts.service,
      nonce: opts.nonce,
    })
  }
  // SQLite legacy table — preserves existing schema during transition.
  return consumeNonce({
    client: getConsumeClient(),
    table: 'inter_service_nonce',
    scopeColumn: 'service',
    scope: opts.service,
    nonce: opts.nonce,
  })
}

// ─── Re-export the production startup guard for convenience ──────────
export { assertProductionStorageBackend }
