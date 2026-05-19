/**
 * Spec 007 Phase F.2.1 — Postgres migration runner for person-mcp.
 *
 * Applies pending Drizzle migrations from `drizzle/pg/` against the
 * active Postgres database at boot, before HTTP listener binds.
 * No-op in SQLite mode (the dev-time fallback uses CREATE TABLE IF
 * NOT EXISTS at module-load time in `db/index.ts`).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator'
import { resolveStorageBackend } from '@smart-agent/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_FOLDER =
  process.env.PERSON_MCP_MIGRATIONS_DIR ??
  path.resolve(__dirname, '../../drizzle/pg')

export async function runPgMigrations(): Promise<{ applied: boolean; folder: string }> {
  const backend = resolveStorageBackend(process.env, 'PERSON_MCP', 'person-mcp.db')
  if (backend.kind !== 'pg') {
    return { applied: false, folder: MIGRATIONS_FOLDER }
  }
  const isProd = process.env.NODE_ENV === 'production'
  // postgres-js client used only for migrations; runtime queries continue
  // through the existing better-sqlite3 path until the per-call cutover.
  const client = postgres(backend.url, {
    max: 2,
    idle_timeout: 30,
    connect_timeout: 5,
    prepare: isProd,
  })
  try {
    const db = drizzlePg(client)
    await migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await client.end({ timeout: 5 })
  }
  return { applied: true, folder: MIGRATIONS_FOLDER }
}
