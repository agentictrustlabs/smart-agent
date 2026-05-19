/**
 * Spec 007 Phase F.2.1 — Postgres migration runner for a2a-agent.
 *
 * Applies pending Drizzle migrations from `drizzle/pg/` against the
 * active Postgres database at boot, before HTTP listener binds.
 * Drizzle tracks applied migrations in `drizzle.__drizzle_migrations`
 * so this is idempotent across restarts.
 *
 * No-op in SQLite mode (the dev-time fallback uses runtime CREATE TABLE
 * IF NOT EXISTS in `db/index.ts`).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator'
import { storageBackend, getPgClient } from './pool'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// The migrations directory is workspace-relative to the app root, not
// the compiled `dist/` tree. tsx runs from src/; production runs from
// dist/db/ — both paths land at <app>/drizzle/pg after resolving `..`.
const MIGRATIONS_FOLDER =
  process.env.A2A_AGENT_MIGRATIONS_DIR ?? path.resolve(__dirname, '../../drizzle/pg')

/**
 * Run pending Postgres migrations. No-op in SQLite mode.
 *
 * Surfaces failures by throwing — the caller in `src/index.ts` exits
 * the process. We never silently swallow a migration failure: a
 * production service that didn't apply its schema is worse than one
 * that refuses to boot.
 */
export async function runPgMigrations(): Promise<{ applied: boolean; folder: string }> {
  if (storageBackend.kind !== 'pg') {
    return { applied: false, folder: MIGRATIONS_FOLDER }
  }
  const client = getPgClient()
  const db = drizzlePg(client)
  await migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return { applied: true, folder: MIGRATIONS_FOLDER }
}
