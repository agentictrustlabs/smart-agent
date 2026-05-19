/**
 * Spec 007 Phase F.2.1 — Drizzle Kit config for a2a-agent Postgres schema.
 *
 * Generates migration SQL from `src/db/schema.pg.ts`. The SQLite schema
 * lives in `src/db/schema.ts` and is auto-created at boot via
 * `src/db/index.ts`; SQLite migrations are not under drizzle-kit because
 * the dev path is single-source-of-truth in the runtime ALTER TABLE
 * blocks. Production Postgres deploys run these migrations via
 * `runPgMigrations()` in `src/db/migrate.ts`.
 */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.pg.ts',
  out: './drizzle/pg',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.A2A_AGENT_PG_URL ??
      'postgres://devuser:devpass@127.0.0.1:5432/a2a_agent',
  },
})
