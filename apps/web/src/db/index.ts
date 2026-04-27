import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import path from 'path'
import fs from 'fs'

const sqlite = new Database(process.env.DATABASE_URL ?? 'local.db')

// Auto-run migrations on startup to ensure all tables exist
const migrationsDir = path.resolve(process.cwd(), 'drizzle')
if (fs.existsSync(migrationsDir)) {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    for (const stmt of sql.split('--> statement-breakpoint')) {
      // Strip SQL comments and find the CREATE statement
      const lines = stmt.split('\n').filter(l => !l.trimStart().startsWith('--'))
      const cleaned = lines.join('\n').trim()
      if (cleaned && (cleaned.includes('CREATE') || cleaned.includes('ALTER') || cleaned.includes('DROP'))) {
        const safe = cleaned.replace(/CREATE TABLE `/g, 'CREATE TABLE IF NOT EXISTS `')
          .replace(/CREATE UNIQUE INDEX `/g, 'CREATE UNIQUE INDEX IF NOT EXISTS `')
          .replace(/CREATE INDEX `/g, 'CREATE INDEX IF NOT EXISTS `')
        try { sqlite.prepare(safe).run() } catch { /* already exists, parse error, or other */ }
      }
    }
  }
}

// Add new columns not in original migrations
try { sqlite.prepare('ALTER TABLE users ADD COLUMN person_agent_address TEXT').run() } catch { /* already exists */ }
try { sqlite.prepare('ALTER TABLE users ADD COLUMN agent_name TEXT').run() } catch { /* already exists */ }
try { sqlite.prepare('ALTER TABLE users ADD COLUMN onboarded_at TEXT').run() } catch { /* already exists */ }
try { sqlite.prepare('ALTER TABLE users ADD COLUMN account_salt_rotation INTEGER NOT NULL DEFAULT 0').run() } catch { /* already exists */ }

// Drop legacy passkeys table — login is now name-based via the .agent
// registry, and the OS picker is hinted by browser-side localStorage. No
// server-side credentialId mapping is kept anymore.
try { sqlite.prepare('DROP TABLE IF EXISTS passkeys').run() } catch { /* */ }
try {
  sqlite.prepare(`CREATE TABLE IF NOT EXISTS recovery_delegations (
    id TEXT PRIMARY KEY NOT NULL,
    account_address TEXT NOT NULL UNIQUE,
    delegation_json TEXT NOT NULL,
    delegation_hash TEXT NOT NULL,
    recovery_config_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).run()
} catch { /* already exists */ }
try {
  sqlite.prepare(`CREATE TABLE IF NOT EXISTS recovery_intents (
    id TEXT PRIMARY KEY NOT NULL,
    account_address TEXT NOT NULL,
    intent_hash TEXT NOT NULL UNIQUE,
    new_credential_id TEXT NOT NULL,
    new_pub_key_x TEXT NOT NULL,
    new_pub_key_y TEXT NOT NULL,
    ready_at INTEGER NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`).run()
} catch { /* already exists */ }

export const db = drizzle(sqlite, { schema })
export { schema }
