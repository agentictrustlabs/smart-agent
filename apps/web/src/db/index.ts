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
      if (cleaned && (cleaned.includes('CREATE') || cleaned.includes('ALTER'))) {
        const safe = cleaned.replace(/CREATE TABLE `/g, 'CREATE TABLE IF NOT EXISTS `')
          .replace(/CREATE UNIQUE INDEX `/g, 'CREATE UNIQUE INDEX IF NOT EXISTS `')
          .replace(/CREATE INDEX `/g, 'CREATE INDEX IF NOT EXISTS `')
        try { sqlite.prepare(safe).run() } catch { /* already exists, parse error, or other */ }
      }
    }
  }
}

export const db = drizzle(sqlite, { schema })
export { schema }
