/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pledge seed for Maria.
 *
 * Inserts a pledge for Maria (person-mcp side) targeting the demo pool seeded
 * by `seed-test-pool.ts`: $100/monthly for 12 months, restrictions
 * { kinds: ['trauma-care'] }, storyPermissions: 'shareWithSupportTeam'.
 *
 *   pnpm exec tsx scripts/seed-test-pledge.ts
 *
 * Idempotent: uses INSERT OR REPLACE on a stable id.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const PLEDGE_ID = 'demo-maria-trauma-care-pledge'
// Maria's person-mcp principal. Default matches the convention used by
// proposal_submissions seed (`person_<demo-user-id>`); override via env
// if seeding into a different tenant.
const MARIA_ADDRESS = (process.env.MARIA_AGENT_ADDRESS ?? 'person_cat-user-001').toLowerCase()
const POOL_IRI = 'urn:smart-agent:pool:demo-trauma-care-pool'
const NOW = new Date().toISOString()

const RESTRICTIONS_JSON = JSON.stringify({ kinds: ['trauma-care'] })

async function seedSql(): Promise<void> {
  // MARIA_ADDRESS now has a sensible default; nothing to gate.
  const dbPath = path.join(repoRoot, 'apps/person-mcp/person-mcp.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-pledge] ${dbPath} does not exist — skipping`)
    return
  }
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => { prepare: (sql: string) => { run: (params: Record<string, unknown>) => void }; close: () => void } }).default
  const db = new Database(dbPath)
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO pool_pledges (
        id, principal, pool_agent_id, cadence, unit, amount, duration,
        restrictions, story_permissions, pledged_at, stopped_at, status,
        history, visibility, on_chain_assertion_id, created_at, updated_at
      ) VALUES (
        @id, @principal, @pool_agent_id, @cadence, @unit, @amount, @duration,
        @restrictions, @story_permissions, @pledged_at, @stopped_at, @status,
        @history, @visibility, @on_chain_assertion_id, @created_at, @updated_at
      )
    `)
    stmt.run({
      id: PLEDGE_ID,
      principal: MARIA_ADDRESS,
      pool_agent_id: POOL_IRI,
      cadence: 'monthly',
      unit: 'USD',
      amount: 100,
      duration: 12,
      restrictions: RESTRICTIONS_JSON,
      story_permissions: 'shareWithSupportTeam',
      pledged_at: NOW,
      stopped_at: null,
      status: 'active',
      history: '[]',
      visibility: 'public-coarse',
      on_chain_assertion_id: null,
      created_at: NOW,
      updated_at: NOW,
    })
    console.log(`[seed-test-pledge] SQL ok — pledge ${PLEDGE_ID} for ${MARIA_ADDRESS} in ${dbPath}`)
  } finally {
    db.close()
  }

  // Bump pool's pledgedTotal by the cadence-aware total ($100 × 12 = $1200).
  const orgDbPath = path.join(repoRoot, 'apps/org-mcp/org-mcp.db')
  if (!fs.existsSync(orgDbPath)) return
  const orgDb = new Database(orgDbPath)
  try {
    orgDb.prepare(`
      UPDATE pools SET pledged_total = pledged_total + 1200,
                       available_total = pledged_total + 1200 - allocated_total,
                       updated_at = @now
      WHERE id = @poolIri
    `).run({ poolIri: POOL_IRI, now: NOW })
    console.log(`[seed-test-pledge] org-mcp pool aggregate bumped by $1200 (12 × $100)`)
  } finally {
    orgDb.close()
  }
}

async function main(): Promise<void> {
  await seedSql()
  console.log(`\n✓ Seeded pledge '${PLEDGE_ID}' for Maria targeting demo pool.`)
  console.log(`  Visit: http://localhost:3000/h/catalyst/pledges (after Maria signs in)`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
