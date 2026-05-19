/**
 * Spec 007 Phase F.2.1 — Drizzle Kit config for person-mcp Postgres schema.
 *
 * Generates migration SQL from `src/db/schema.pg.ts`. SQLite migrations are
 * not under drizzle-kit (dev path uses CREATE TABLE IF NOT EXISTS in
 * `src/db/index.ts`). Production Postgres deploys run these migrations via
 * `runPgMigrations()` in `src/db/migrate.ts`.
 */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.pg.ts',
  out: './drizzle/pg',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.PERSON_MCP_PG_URL ??
      'postgres://devuser:devpass@127.0.0.1:5432/person_mcp',
  },
})
