/**
 * Spec 002 — Pledge seed for Maria + Pastor David across multiple pools.
 *
 * Three pledges that exercise pool-lane variety:
 *   - Maria: $100 monthly × 12 → trauma-care pool ($1200 total)
 *   - David: $50 monthly × 12 → spanish-bibles pool ($600 total)
 *   - Maria: 10 prayer-minutes daily × 365 → prayer-chain pool (3650 min)
 *
 *   pnpm exec tsx scripts/seed-test-pledge.ts
 *
 * Idempotent: INSERT OR REPLACE on stable ids; org-mcp aggregates are
 * recomputed instead of additively bumped so re-runs don't double count.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const NOW = new Date().toISOString()

interface PledgeSeed {
  id: string
  /** person-mcp principal that owns the pledge body. */
  principal: string
  poolId: string
  cadence: 'one-time' | 'monthly' | 'annual'
  unit: string
  amount: number
  duration: number
  restrictions: { kinds?: string[]; geoRoots?: string[] } | null
  storyPermissions: 'public' | 'shareWithSupportTeam' | 'anonymous'
}

const PLEDGES: PledgeSeed[] = [
  {
    id: 'demo-maria-trauma-care-pledge',
    principal: 'person_cat-user-001',
    poolId: 'demo-trauma-care-pool',
    cadence: 'monthly',
    unit: 'USD',
    amount: 100,
    duration: 12,
    restrictions: { kinds: ['trauma-care', 'CompassionMinistry'] },
    storyPermissions: 'shareWithSupportTeam',
  },
  {
    id: 'demo-david-spanish-bibles-pledge',
    principal: 'person_cat-user-002',
    poolId: 'demo-spanish-bibles-pool',
    cadence: 'monthly',
    unit: 'USD',
    amount: 50,
    duration: 12,
    restrictions: { kinds: ['HeartLanguageScripture', 'BibleStudy'] },
    storyPermissions: 'public',
  },
  {
    id: 'demo-maria-prayer-chain-pledge',
    principal: 'person_cat-user-001',
    poolId: 'demo-prayer-chain-pool',
    cadence: 'monthly',
    unit: 'prayer-minutes',
    amount: 300, // 10 minutes × 30 days/mo
    duration: 12,
    restrictions: { kinds: ['DailyPrayer', 'Intercession'] },
    storyPermissions: 'anonymous',
  },
]

interface SqliteStmt {
  run: (params: Record<string, unknown>) => void
  all?: (params?: Record<string, unknown>) => unknown[]
}
interface SqliteHandle {
  prepare: (sql: string) => SqliteStmt
  close: () => void
}

async function openSqlite(dbPath: string): Promise<SqliteHandle> {
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => SqliteHandle }).default
  return new Database(dbPath)
}

async function seedSql(): Promise<void> {
  const dbPath = path.join(repoRoot, 'apps/person-mcp/person-mcp.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-pledge] ${dbPath} does not exist — skipping`)
    return
  }
  const db = await openSqlite(dbPath)
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
    for (const p of PLEDGES) {
      stmt.run({
        id: p.id,
        principal: p.principal,
        pool_agent_id: `urn:smart-agent:pool:${p.poolId}`,
        cadence: p.cadence,
        unit: p.unit,
        amount: p.amount,
        duration: p.duration,
        restrictions: p.restrictions ? JSON.stringify(p.restrictions) : null,
        story_permissions: p.storyPermissions,
        pledged_at: NOW,
        stopped_at: null,
        status: 'active',
        history: '[]',
        visibility: p.storyPermissions === 'anonymous' ? 'public-coarse' : 'public',
        on_chain_assertion_id: null,
        created_at: NOW,
        updated_at: NOW,
      })
      console.log(`[seed-test-pledge] SQL ok — ${p.id} (${p.principal} → ${p.poolId})`)
    }
  } finally {
    db.close()
  }

  // Recompute pool aggregates (pledged_total / available_total) from the
  // pledges we just seeded. Idempotent: per-pool totals are summed once
  // from this script's PLEDGES array, then written. Re-runs converge on
  // the same number instead of double-counting.
  const orgDbPath = path.join(repoRoot, 'apps/org-mcp/org-mcp.db')
  if (!fs.existsSync(orgDbPath)) return
  const orgDb = await openSqlite(orgDbPath)
  try {
    const totalsByPool = new Map<string, number>()
    for (const p of PLEDGES) {
      const iri = `urn:smart-agent:pool:${p.poolId}`
      totalsByPool.set(iri, (totalsByPool.get(iri) ?? 0) + p.amount * p.duration)
    }
    const update = orgDb.prepare(`
      UPDATE pools SET
        pledged_total = @total,
        available_total = @total - allocated_total,
        updated_at = @now
      WHERE id = @poolIri
    `)
    for (const [poolIri, total] of totalsByPool) {
      update.run({ poolIri, total, now: NOW })
      console.log(`[seed-test-pledge] org-mcp aggregate set: ${poolIri} → ${total}`)
    }
  } finally {
    orgDb.close()
  }
}

async function main(): Promise<void> {
  await seedSql()
  console.log(`\n✓ Seeded ${PLEDGES.length} pledges across the catalyst pools:`)
  for (const p of PLEDGES) {
    const total = p.amount * p.duration
    console.log(`    · ${p.id} — ${p.principal}: ${total} ${p.unit} via ${p.poolId}`)
  }
  console.log(`  Visit: http://localhost:3000/h/catalyst/pledges (after Maria signs in)`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
