/**
 * Spec 007 Phase F.2.1 — Drizzle Kit config for web's Postgres schema.
 *
 * The legacy `drizzle.config.ts` continues to drive the SQLite migration
 * generation (kept so the existing /drizzle/0000…0019 history stays
 * editable). This config generates the Postgres-side migrations under
 * `/drizzle/pg/`.
 *
 * Run via:
 *   pnpm --filter @smart-agent/web exec drizzle-kit generate \
 *     --config drizzle.pg.config.ts
 */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.pg.ts',
  out: './drizzle/pg',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.WEB_PG_URL ??
      'postgres://devuser:devpass@127.0.0.1:5432/web',
  },
})
