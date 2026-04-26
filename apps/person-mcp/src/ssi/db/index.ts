/**
 * Re-export of the raw better-sqlite3 handle used by person-mcp's main DB.
 *
 * The absorbed ssi storage modules (wallets/cred-metadata/proof-audit/
 * nonces) interact with SQLite through the better-sqlite3 prepare/run API
 * directly — they never go through drizzle. Sharing the same handle keeps
 * everything in one DB file and eliminates the dual-DB consistency hazards
 * the pre-merge architecture had.
 *
 * The raw `sqlite` handle is created by `apps/person-mcp/src/db/index.ts`
 * and re-exported as `db` here so the moved files keep their original
 * `import { db } from '../db/index.js'` paths intact.
 */
export { sqlite as db } from '../../db/index.js'
