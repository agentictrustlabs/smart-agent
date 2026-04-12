import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

/**
 * Ensure all migration tables exist. Strips comments, adds IF NOT EXISTS.
 * Safe to call repeatedly.
 */
export function ensureTablesExist() {
  const dbPath = process.env.DATABASE_URL ?? 'local.db'
  const sqlite = new Database(dbPath)

  const migrationsDir = path.resolve(process.cwd(), 'drizzle')
  if (!fs.existsSync(migrationsDir)) return

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const lines = stmt.split('\n').filter(l => !l.trimStart().startsWith('--'))
      const cleaned = lines.join('\n').trim()
      if (cleaned && (cleaned.includes('CREATE') || cleaned.includes('ALTER'))) {
        const safe = cleaned.replace(/CREATE TABLE `/g, 'CREATE TABLE IF NOT EXISTS `')
          .replace(/CREATE UNIQUE INDEX `/g, 'CREATE UNIQUE INDEX IF NOT EXISTS `')
          .replace(/CREATE INDEX `/g, 'CREATE INDEX IF NOT EXISTS `')
        try { sqlite.prepare(safe).run() } catch { /* parse error */ }
      }
    }
  }
}
