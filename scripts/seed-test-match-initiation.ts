/**
 * One-shot demo seed — creates a MatchInitiation pair for Maria so
 * /h/catalyst/intents/<id> shows the spec-001 candidates section in action.
 *
 *   pnpm exec tsx scripts/seed-test-match-initiation.ts
 *
 * What it does:
 *
 *   1. Ensures TWO complementary intents exist in apps/web/local.db:
 *      - A receive-shaped intent expressed by Maria (for trauma-care).
 *      - A give-shaped counter-intent on the same object expressed by another
 *        seeded agent (so Maria can see + propose a match).
 *      Both intents are inserted with the canonical web `intents` table shape
 *      and `status = 'expressed'`. Existing rows are left alone (idempotent
 *      via INSERT OR IGNORE on `id`).
 *
 *   2. Inserts a `match_initiations` row into apps/person-mcp/person-mcp.db
 *      with Maria as initiator (self mode — Maria is one of the two
 *      expressers). status='pending'. Visibility derived as the strictest of
 *      the two source intents' visibilities.
 *
 *   3. Optionally seeds a *connector-mode* MatchInitiation: a third party
 *      initiator who expressed neither of the two intents. Disabled by
 *      default; enable with --connector to add.
 *
 * Round body validation in the MCP `match_initiation:create` tool is
 * skipped here (we INSERT directly into SQLite). The real MCP tool runs
 * full validation.
 *
 * Re-running is safe: INSERT OR IGNORE on intents; the `match_initiations`
 * row is INSERT OR REPLACE on the deterministic id below.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// Load env from apps/web/.env (for DATABASE_URL etc.).
const envFile = path.join(repoRoot, 'apps/web/.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = value
  }
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

// Canonical Maria principal in person-mcp (mirrors seed-test-proposal.ts).
const MARIA_PRINCIPAL = 'person_cat-user-001'
// Approximate Maria agent address used in seeded data — keep aligned with
// the rest of the demo seed scripts.
const MARIA_AGENT_PLACEHOLDER = '0x6F669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()
let MARIA_AGENT_ADDRESS = MARIA_AGENT_PLACEHOLDER
// Counter-party (a coach who can offer trauma-care training).
const COACH_AGENT_ADDRESS = '0x1A669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()
// Connector (agent who expressed neither intent — for connector-mode demo).
const CONNECTOR_AGENT_ADDRESS = '0x2B669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()

const HUB_ID = 'catalyst'

// Intent IDs (URNs).
const MARIA_INTENT_ID = 'urn:smart-agent:intent:maria-need-trauma-coaching'
const COACH_INTENT_ID = 'urn:smart-agent:intent:coach-offer-trauma-coaching'
const NOW = new Date().toISOString()

// MatchInitiation IDs (deterministic so re-running is idempotent).
const SELF_INITIATION_ID = 'urn:smart-agent:match-initiation:maria-self-trauma-q2'
const CONNECTOR_INITIATION_ID = 'urn:smart-agent:match-initiation:connector-trauma-q2'

const BASIS_SELF = JSON.stringify({
  proximityHops: 1,
  proximityScore: 1 / 2,
  priorOutcomes: { fulfilled: 4, abandoned: 0 },
  outcomeScore: 5 / 6,
  composite: 0.6 * 0.5 + 0.4 * (5 / 6),
  isColdStart: false,
})

const BASIS_CONNECTOR = JSON.stringify({
  proximityHops: 2,
  proximityScore: 1 / 3,
  priorOutcomes: { fulfilled: 0, abandoned: 0 },
  outcomeScore: 0.5,
  composite: 0.6 * (1 / 3) + 0.4 * 0.5,
  isColdStart: true,
})

// ────────────────────────────────────────────────────────────────────────
// better-sqlite3 loader (lazy through pnpm store; matches seed-test-proposal)
// ────────────────────────────────────────────────────────────────────────

async function openSqlite(dbPath: string): Promise<{
  prepare: (sql: string) => { run: (params?: Record<string, unknown>) => void; get: (params?: Record<string, unknown>) => unknown }
  close: () => void
}> {
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => {
    prepare: (sql: string) => { run: (params?: Record<string, unknown>) => void; get: (params?: Record<string, unknown>) => unknown }
    close: () => void
  } }).default
  return new Database(dbPath)
}

// ────────────────────────────────────────────────────────────────────────
// 1. Seed two complementary intents in apps/web/local.db
// ────────────────────────────────────────────────────────────────────────

async function seedIntents(): Promise<void> {
  const dbPath = path.join(repoRoot, 'apps/web/local.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-match-initiation] web db not found at ${dbPath} — skipping intent seed`)
    return
  }
  const db = await openSqlite(dbPath)
  try {
    // Look up Maria's real on-chain agent (set by demo-login). Falls back to
    // the placeholder if she hasn't signed in yet — re-run after first sign-in.
    try {
      const row = (db.prepare(`SELECT lower(person_agent_address) AS addr FROM users WHERE id = 'cat-user-001'`) as { get: () => { addr?: string } | undefined }).get()
      if (row?.addr) MARIA_AGENT_ADDRESS = row.addr
    } catch { /* users table may not exist yet — keep placeholder */ }
    if (MARIA_AGENT_ADDRESS !== MARIA_AGENT_PLACEHOLDER) {
      console.log(`[seed-test-match-initiation] resolved Maria agent → ${MARIA_AGENT_ADDRESS}`)
    }
    // Local alias to keep the literal usages below stable.
    const resolvedMariaAgent = MARIA_AGENT_ADDRESS
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO intents (
        id, direction, object, topic, intent_type, intent_type_label,
        expressed_by_agent, expressed_by_user_id, addressed_to, hub_id,
        title, detail, payload, status, priority, visibility,
        expected_outcome, projection_ref, valid_until, created_at, updated_at
      ) VALUES (
        @id, @direction, @object, @topic, @intent_type, @intent_type_label,
        @expressed_by_agent, @expressed_by_user_id, @addressed_to, @hub_id,
        @title, @detail, @payload, @status, @priority, @visibility,
        @expected_outcome, @projection_ref, @valid_until, @created_at, @updated_at
      )
    `)

    // Maria's need.
    stmt.run({
      id: MARIA_INTENT_ID,
      direction: 'receive',
      object: 'resourceType:Worker',
      topic: 'Trauma-care training in Northern Colorado',
      intent_type: 'intentType:NeedCoaching',
      intent_type_label: 'Need: Coaching',
      expressed_by_agent: resolvedMariaAgent,
      expressed_by_user_id: 'cat-user-001',
      addressed_to: `hub:${HUB_ID}`,
      hub_id: HUB_ID,
      title: 'Need: Trauma-care coaching for NoCo cohort',
      detail: 'Looking for an experienced coach to support our NoCo trauma-care leadership cohort over 6 months.',
      payload: JSON.stringify({ geo: 'us/colorado', beneficiaryAgent: resolvedMariaAgent }),
      status: 'expressed',
      priority: 'high',
      visibility: 'public',
      expected_outcome: null,
      projection_ref: null,
      valid_until: null,
      created_at: NOW,
      updated_at: NOW,
    })

    // Coach's offer (counter-intent on the same object).
    stmt.run({
      id: COACH_INTENT_ID,
      direction: 'give',
      object: 'resourceType:Worker',
      topic: 'Coaching for trauma-care leaders',
      intent_type: 'intentType:OfferTeaching',
      intent_type_label: 'Offer: Teaching',
      expressed_by_agent: COACH_AGENT_ADDRESS,
      expressed_by_user_id: null,
      addressed_to: `hub:${HUB_ID}`,
      hub_id: HUB_ID,
      title: 'Offer: Trauma-care coach available for NoCo',
      detail: 'Certified trauma-care trainer offering coaching cohorts in Northern Colorado.',
      payload: JSON.stringify({ geo: 'us/colorado' }),
      status: 'expressed',
      priority: 'normal',
      visibility: 'public',
      expected_outcome: null,
      projection_ref: null,
      valid_until: null,
      created_at: NOW,
      updated_at: NOW,
    })

    console.log('[seed-test-match-initiation] inserted (or skipped) Maria-need + Coach-offer intents in web-app.db')
  } finally {
    db.close()
  }
}

// ────────────────────────────────────────────────────────────────────────
// 2. Seed MatchInitiation in apps/person-mcp/person-mcp.db
// ────────────────────────────────────────────────────────────────────────

async function seedInitiation(opts: { connector: boolean }): Promise<void> {
  const dbPath = path.join(repoRoot, 'apps/person-mcp/person-mcp.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-match-initiation] person-mcp db not found at ${dbPath} — skipping`)
    return
  }
  const db = await openSqlite(dbPath)
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO match_initiations (
        id, principal, viewed_intent_id, candidate_intent_id, initiator_agent_id,
        initiation_kind, proposed_at, basis, status, visibility, on_chain_assertion_id,
        created_at, updated_at
      ) VALUES (
        @id, @principal, @viewed_intent_id, @candidate_intent_id, @initiator_agent_id,
        @initiation_kind, @proposed_at, @basis, @status, @visibility, @on_chain_assertion_id,
        @created_at, @updated_at
      )
    `)

    // Self-mode initiation (Maria initiates between her own and the coach's intent).
    stmt.run({
      id: SELF_INITIATION_ID,
      principal: MARIA_PRINCIPAL,
      viewed_intent_id: MARIA_INTENT_ID,
      candidate_intent_id: COACH_INTENT_ID,
      initiator_agent_id: MARIA_AGENT_ADDRESS,
      initiation_kind: 'self',
      proposed_at: NOW,
      basis: BASIS_SELF,
      status: 'pending',
      visibility: 'public',
      on_chain_assertion_id: null,
      created_at: NOW,
      updated_at: NOW,
    })
    console.log('[seed-test-match-initiation] inserted self-mode MatchInitiation for Maria')

    if (opts.connector) {
      // Connector-mode: a third party initiates between two intents they
      // didn't express. The principal is still Maria for v1 (the demo only
      // surfaces her MCP); a real connector would have their own MCP row.
      // Documented limitation.
      stmt.run({
        id: CONNECTOR_INITIATION_ID,
        principal: MARIA_PRINCIPAL,
        viewed_intent_id: MARIA_INTENT_ID,
        candidate_intent_id: COACH_INTENT_ID,
        initiator_agent_id: CONNECTOR_AGENT_ADDRESS,
        initiation_kind: 'connector',
        proposed_at: NOW,
        basis: BASIS_CONNECTOR,
        status: 'pending',
        visibility: 'public',
        on_chain_assertion_id: null,
        created_at: NOW,
        updated_at: NOW,
      })
      console.log('[seed-test-match-initiation] inserted connector-mode MatchInitiation (third-party initiator)')
    }
  } finally {
    db.close()
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const seedConnector = argv.includes('--connector')
  await seedIntents()
  await seedInitiation({ connector: seedConnector })
  console.log('\n✓ Seeded MatchInitiation demo for Maria.')
  console.log('  Sign in as Maria, visit:')
  console.log(`    http://localhost:3000/h/${HUB_ID}/intents`)
  console.log(`    http://localhost:3000/h/${HUB_ID}/intents/${encodeURIComponent(MARIA_INTENT_ID)}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
