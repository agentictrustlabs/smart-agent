/**
 * Spec 007 Phase F.2.1 — Drizzle Kit config for org-mcp Postgres schema.
 * See companion `schema.pg.ts` for table definitions.
 */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.pg.ts',
  out: './drizzle/pg',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.ORG_MCP_PG_URL ??
      'postgres://devuser:devpass@127.0.0.1:5432/org_mcp',
  },
})
