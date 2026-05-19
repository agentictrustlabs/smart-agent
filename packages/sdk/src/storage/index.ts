/**
 * Spec 007 Phase F.2 — Storage abstraction for the Postgres migration.
 *
 * Each backend service (a2a-agent, person-mcp, org-mcp, web, people-group-mcp,
 * verifier-mcp, family-mcp, skill-mcp, geo-mcp, hub-mcp) chooses Postgres or
 * SQLite by reading its `<SERVICE>_PG_URL` env var. When set, Postgres is
 * used; when unset and `NODE_ENV !== 'production'`, SQLite is the dev
 * fallback. In production, refusing to start when `*_PG_URL` is unset is
 * the responsibility of the service's `assertProductionStorageBackend()`
 * call at boot.
 *
 * This module exports:
 *   - `resolveStorageBackend(envIn, serviceKey)` — pure helper that
 *     returns the active backend kind + connection URL.
 *   - `assertProductionStorageBackend(envIn, serviceKey)` — startup
 *     guard that throws in production when no Postgres URL is set or the
 *     URL points at a SQLite file.
 *   - `StorageBackend` type — discriminated union for the two arms.
 *   - `consumeNonceSqlite(db, table, scope, nonce)` — transactional
 *     consume-nonce helper using SQLite UNIQUE constraint.
 *   - `consumeNoncePostgres(sql, table, scope, nonce)` — transactional
 *     consume-nonce helper using Postgres `INSERT ... ON CONFLICT
 *     DO NOTHING RETURNING`.
 *
 * The consume-nonce helpers replace the legacy "SELECT then INSERT"
 * pattern that is racy under concurrent load. Both return `true` iff the
 * insert succeeded (the nonce was fresh) and `false` iff the unique
 * constraint rejected (the nonce was a replay).
 */

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Discriminated union for the active storage backend. `'pg'` is the
 * production target; `'sqlite'` is the dev fallback (refused in prod by
 * `assertProductionStorageBackend`).
 */
export type StorageBackend =
  | { kind: 'pg'; url: string }
  | { kind: 'sqlite'; path: string }

/**
 * Each service has its own env-var prefix and Postgres database name.
 * Adding a new service: add an entry here + update `fresh-start.sh`'s
 * `PG_DATABASES` array + add a per-service `pool.ts` that calls
 * `resolveStorageBackend(process.env, '<service>')`.
 */
export const SERVICE_KEYS = {
  a2aAgent: 'A2A_AGENT',
  personMcp: 'PERSON_MCP',
  orgMcp: 'ORG_MCP',
  peopleGroupMcp: 'PEOPLE_GROUP_MCP',
  familyMcp: 'FAMILY_MCP',
  geoMcp: 'GEO_MCP',
  verifierMcp: 'VERIFIER_MCP',
  skillMcp: 'SKILL_MCP',
  hubMcp: 'HUB_MCP',
  web: 'WEB',
} as const
export type ServiceKey = (typeof SERVICE_KEYS)[keyof typeof SERVICE_KEYS]

export interface StorageBackendEnv {
  NODE_ENV?: string
  /** Generic fallback so existing dev `.env` files keep working. */
  DATABASE_URL?: string
  /** Per-service Postgres URL — the canonical Phase F.2 env var. */
  [k: string]: string | undefined
}

// ─── Pure resolver ────────────────────────────────────────────────────

/**
 * Resolve the storage backend for a given service. Pure: takes env map,
 * returns the backend descriptor. Caller wires the actual database
 * client (drizzle + `postgres` or drizzle + `better-sqlite3`).
 *
 * Priority order:
 *   1. `<SERVICE>_PG_URL` if set — use Postgres.
 *   2. `DATABASE_URL` if it begins with `postgres://` or `postgresql://`.
 *   3. SQLite fallback. In production this is refused by
 *      `assertProductionStorageBackend`.
 *
 * @param envIn       Injectable env (defaults to `process.env`).
 * @param serviceKey  One of `SERVICE_KEYS` values (the env-prefix).
 * @param sqlitePath  Dev-fallback path; e.g. `'local.db'` or `'person-mcp.db'`.
 */
export function resolveStorageBackend(
  envIn: StorageBackendEnv,
  serviceKey: ServiceKey,
  sqlitePath: string,
): StorageBackend {
  const pgKey = `${serviceKey}_PG_URL`
  const pgUrl = envIn[pgKey]
  if (pgUrl && pgUrl.length > 0) {
    return { kind: 'pg', url: pgUrl }
  }
  const generic = envIn.DATABASE_URL
  if (generic && /^postgres(ql)?:\/\//.test(generic)) {
    return { kind: 'pg', url: generic }
  }
  return { kind: 'sqlite', path: sqlitePath }
}

/**
 * Production startup guard. Throws when:
 *   - `NODE_ENV='production'` AND
 *   - the resolved backend is SQLite OR
 *   - the resolved backend URL has the `sqlite:` / `file:` scheme.
 *
 * Call this from each service's `src/index.ts` BEFORE the HTTP listener
 * binds. The guard is silent in dev — SQLite fallback is permitted there.
 *
 * `ALLOW_SQLITE_FOR_TESTS=true` lifts the guard for the explicit
 * integration-test path. Setting it in production exits immediately
 * (a misconfigured deploy that opts in to SQLite must scream).
 */
export function assertProductionStorageBackend(
  envIn: StorageBackendEnv,
  serviceKey: ServiceKey,
  sqlitePath: string,
): StorageBackend {
  const backend = resolveStorageBackend(envIn, serviceKey, sqlitePath)
  const isProd = envIn.NODE_ENV === 'production'
  if (!isProd) return backend

  const allowSqliteForTests = envIn.ALLOW_SQLITE_FOR_TESTS === 'true'
  if (allowSqliteForTests) {
    throw new Error(
      `assertProductionStorageBackend: ALLOW_SQLITE_FOR_TESTS=true is set in ` +
        `NODE_ENV='production'. SQLite is never permitted in production. ` +
        `Unset ALLOW_SQLITE_FOR_TESTS and configure ${serviceKey}_PG_URL.`,
    )
  }

  if (backend.kind === 'sqlite') {
    throw new Error(
      `assertProductionStorageBackend: ${serviceKey} has no Postgres URL ` +
        `configured (looked for ${serviceKey}_PG_URL and DATABASE_URL). ` +
        `Production refuses to start without Postgres — SQLite is single-instance ` +
        `and cannot back a production deployment. Set ${serviceKey}_PG_URL ` +
        `to a postgres:// connection string. See specs/007-architecture-hardening/phase-F-storage-layer.md.`,
    )
  }

  // Belt-and-suspenders: refuse a Postgres URL that's been pointed at a file.
  if (backend.kind === 'pg' && /^(sqlite|file):/.test(backend.url)) {
    throw new Error(
      `assertProductionStorageBackend: ${serviceKey}_PG_URL='${backend.url}' ` +
        `has a non-Postgres scheme. Required: postgres:// or postgresql://.`,
    )
  }

  return backend
}

// ─── Transactional nonce consumption — SQLite arm ────────────────────

/**
 * Minimum better-sqlite3 surface this helper needs. Typed structurally
 * so the SDK does not have to depend on `better-sqlite3` directly.
 */
export interface SqliteHandleLike {
  prepare(sql: string): {
    run(...args: unknown[]): unknown
    get(...args: unknown[]): unknown
  }
}

/**
 * Atomically consume a nonce in SQLite. Returns `true` iff the row was
 * inserted (nonce was fresh); `false` iff the UNIQUE constraint rejected
 * (nonce was a replay).
 *
 * The table must have a UNIQUE constraint over `(scope, nonce)` OR
 * `(nonce)` alone — pass `scopeColumn: null` for the latter shape
 * (matches the legacy verifier-mcp / family-mcp `consumed_nonces` table).
 *
 * @param sqliteHandle  The better-sqlite3 handle.
 * @param table         The nonce table name.
 * @param scopeColumn   `'scope' | 'service'` for compound-key tables, OR
 *                      `null` for nonce-only-unique tables.
 * @param scope         The scope value (ignored when scopeColumn is null).
 * @param nonce         The nonce value.
 * @param now           UTC timestamp (ISO-8601). Defaults to now().
 */
export function consumeNonceSqlite(opts: {
  sqliteHandle: SqliteHandleLike
  table: string
  scopeColumn: 'scope' | 'service' | null
  scope: string
  nonce: string
  now?: string
}): boolean {
  if (!opts.nonce || opts.nonce.length === 0) {
    throw new Error('consumeNonceSqlite: nonce must be non-empty')
  }
  const usedAt = opts.now ?? new Date().toISOString()

  // OR IGNORE — INSERT becomes a no-op on UNIQUE conflict instead of
  // throwing. We then check `changes` on the result to know which arm fired.
  let sql: string
  let params: unknown[]
  if (opts.scopeColumn !== null) {
    sql = `INSERT OR IGNORE INTO ${opts.table} (${opts.scopeColumn}, nonce, used_at) VALUES (?, ?, ?)`
    params = [opts.scope, opts.nonce, usedAt]
  } else {
    sql = `INSERT OR IGNORE INTO ${opts.table} (nonce, used_at) VALUES (?, ?)`
    params = [opts.nonce, usedAt]
  }

  const result = opts.sqliteHandle.prepare(sql).run(...params) as { changes: number }
  return result.changes === 1
}

// ─── Transactional nonce consumption — Postgres arm ──────────────────

/**
 * Minimum `postgres` (porsager/postgres) surface this helper needs.
 * Typed structurally so the SDK does not have to import `postgres`.
 * The `sql` tagged template returns a thenable; we use the `await sql`...
 * form and read `length` (returned-rows count, 0 = conflict, 1 = inserted).
 */
export interface PgSqlLike {
  /** Tagged-template that returns a promise resolving to a row array. */
  <T = unknown>(template: TemplateStringsArray, ...values: unknown[]): Promise<T[]>
  /** unsafe variant for dynamic SQL */
  unsafe<T = unknown>(query: string, values?: unknown[]): Promise<T[]>
}

/**
 * Atomically consume a nonce in Postgres. Returns `true` iff the row was
 * inserted (nonce was fresh); `false` iff the ON CONFLICT clause fired
 * (nonce was a replay).
 *
 * The table must have a UNIQUE constraint over `(scope, nonce)` OR over
 * `(nonce)` alone — pass `scopeColumn: null` for the latter shape.
 *
 * This is the canonical post-Phase-F.2 nonce-consumption primitive.
 * Replaces the SQLite SELECT-then-INSERT pattern which is racy.
 */
export async function consumeNoncePostgres(opts: {
  sql: PgSqlLike
  table: string
  scopeColumn: 'scope' | 'service' | null
  scope: string
  nonce: string
  now?: Date
}): Promise<boolean> {
  if (!opts.nonce || opts.nonce.length === 0) {
    throw new Error('consumeNoncePostgres: nonce must be non-empty')
  }
  const usedAt = opts.now ?? new Date()

  // Identifier validation — table + scopeColumn flow from server-side
  // configuration but we still defensively reject anything outside the
  // identifier alphabet. Belt-and-suspenders against accidental injection.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opts.table)) {
    throw new Error(`consumeNoncePostgres: invalid table name '${opts.table}'`)
  }
  if (opts.scopeColumn !== null && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opts.scopeColumn)) {
    throw new Error(`consumeNoncePostgres: invalid scope column '${opts.scopeColumn}'`)
  }

  let query: string
  let values: unknown[]
  if (opts.scopeColumn !== null) {
    query =
      `INSERT INTO ${opts.table} (${opts.scopeColumn}, nonce, used_at) ` +
      `VALUES ($1, $2, $3) ` +
      `ON CONFLICT (${opts.scopeColumn}, nonce) DO NOTHING ` +
      `RETURNING used_at`
    values = [opts.scope, opts.nonce, usedAt]
  } else {
    query =
      `INSERT INTO ${opts.table} (nonce, used_at) ` +
      `VALUES ($1, $2) ` +
      `ON CONFLICT (nonce) DO NOTHING ` +
      `RETURNING used_at`
    values = [opts.nonce, usedAt]
  }

  const rows = await opts.sql.unsafe(query, values)
  return rows.length === 1
}

// ─── Backend-agnostic consume helper ──────────────────────────────────

/**
 * Adapter for code paths that want a single call that picks the right
 * backend at runtime. The caller has already resolved the backend; this
 * helper just dispatches.
 */
export type ConsumeNonceClient =
  | { kind: 'sqlite'; handle: SqliteHandleLike }
  | { kind: 'pg'; sql: PgSqlLike }

export async function consumeNonce(opts: {
  client: ConsumeNonceClient
  table: string
  scopeColumn: 'scope' | 'service' | null
  scope: string
  nonce: string
}): Promise<boolean> {
  if (opts.client.kind === 'sqlite') {
    return consumeNonceSqlite({
      sqliteHandle: opts.client.handle,
      table: opts.table,
      scopeColumn: opts.scopeColumn,
      scope: opts.scope,
      nonce: opts.nonce,
    })
  }
  return consumeNoncePostgres({
    sql: opts.client.sql,
    table: opts.table,
    scopeColumn: opts.scopeColumn,
    scope: opts.scope,
    nonce: opts.nonce,
  })
}
