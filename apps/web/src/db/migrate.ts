/**
 * Spec 007 Phase F.2.1 — Postgres migration runner for web (Next.js).
 *
 * Invoked from `instrumentation.ts::register` at server boot. No-op in
 * SQLite mode (the legacy on-disk migrations in `drizzle/*.sql` are
 * applied by `db/index.ts` at module-load time for SQLite).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator'
import { resolveStorageBackend } from '@smart-agent/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_FOLDER =
  process.env.WEB_MIGRATIONS_DIR ??
  path.resolve(__dirname, '../../drizzle/pg')

export async function runPgMigrations(): Promise<{ applied: boolean; folder: string }> {
  const backend = resolveStorageBackend(process.env, 'WEB', 'local.db')
  if (backend.kind !== 'pg') {
    return { applied: false, folder: MIGRATIONS_FOLDER }
  }
  const isProd = process.env.NODE_ENV === 'production'
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
