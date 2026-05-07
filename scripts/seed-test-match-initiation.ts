/**
 * Spec 001 — Direct lane demo seed. Multiple complementary intent pairs
 * with one MatchInitiation primer for Maria's coaching need.
 *
 *   pnpm exec tsx scripts/seed-test-match-initiation.ts
 *
 * What it does:
 *
 *   1. INSERT OR IGNORE three faith-themed intent pairs into apps/web/local.db
 *      (`intents` table). Each pair has a receive intent and a give counter-
 *      offering on the same object so the candidate ranker has live data.
 *
 *   2. INSERT OR REPLACE one MatchInitiation in person-mcp.db so Maria's
 *      trauma-care intent detail page already shows a pending pair (used by
 *      the Playwright suite).
 *
 *   3. Optionally adds a connector-mode initiation when called with
 *      `--connector` for the third-party variant.
 *
 * Idempotent: stable ids; INSERT OR IGNORE on intents (preserves any user
 * edits), INSERT OR REPLACE on the initiation.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

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
// Constants — placeholders re-bound at runtime when the catalyst seed has
// already provisioned Maria + Pastor David's person agents.
// ────────────────────────────────────────────────────────────────────────

const MARIA_PRINCIPAL = 'person_cat-user-001'
const DAVID_PRINCIPAL = 'person_cat-user-002'

const MARIA_AGENT_PLACEHOLDER = '0x6F669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()
const DAVID_AGENT_PLACEHOLDER = '0x1A669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()
let MARIA_AGENT_ADDRESS = MARIA_AGENT_PLACEHOLDER
let DAVID_AGENT_ADDRESS = DAVID_AGENT_PLACEHOLDER
// Connector for the optional connector-mode initiation (a third party who
// expressed neither side of the pair).
const CONNECTOR_AGENT_ADDRESS = '0x2B669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()

const HUB_ID = 'catalyst'
const NOW = new Date().toISOString()

// ────────────────────────────────────────────────────────────────────────
// Intent pairs — each entry produces a receive + give pair with a stable
// id so the candidates list on the receive intent's detail page lights up.
// Stored as functions so we can substitute resolved agent addresses at
// runtime (the catalyst seed deploys the person agents whose addresses we
// reference here).
// ────────────────────────────────────────────────────────────────────────

interface IntentRow {
  id: string
  direction: 'receive' | 'give'
  object: string
  topic: string
  intentType: string
  intentTypeLabel: string
  expressedByAgent: string
  expressedByUserId: string | null
  title: string
  detail: string
  payload: Record<string, unknown>
  priority: 'critical' | 'high' | 'normal' | 'low'
}

function buildIntentPairs(): IntentRow[] {
  return [
    // ── Pair 1: trauma-care training (Maria → coach) ──────────────
    // Slug-style ids — Next.js routes URN-style ids with colons to 404.
    {
      id: 'demo-maria-need-trauma-coaching',
      direction: 'receive',
      object: 'resourceType:Worker',
      topic: 'Trauma-care training for migrant-family ministries',
      intentType: 'intentType:NeedCoaching',
      intentTypeLabel: 'Need: Coaching',
      expressedByAgent: MARIA_AGENT_ADDRESS,
      expressedByUserId: 'cat-user-001',
      title: 'Need: Trauma-Care coach for NoCo migrant-family cohort',
      detail: 'Looking for an experienced compassion-ministry coach to support our 6-month trauma-care training cohort serving migrant families across Wellington and Loveland.',
      payload: { geo: 'us/colorado', beneficiaryAgent: MARIA_AGENT_ADDRESS },
      priority: 'high',
    },
    {
      id: 'demo-david-offer-trauma-coaching',
      direction: 'give',
      object: 'resourceType:Worker',
      topic: 'Compassion-ministry trauma-care coaching',
      intentType: 'intentType:OfferTeaching',
      intentTypeLabel: 'Offer: Teaching',
      expressedByAgent: DAVID_AGENT_ADDRESS,
      expressedByUserId: 'cat-user-002',
      title: 'Offer: Compassion-trauma trainer available for NoCo cohorts',
      detail: 'Certified trauma-care trainer with 8 years coaching bilingual ministry leaders. Available for one 6-month cohort starting Q3.',
      payload: { geo: 'us/colorado' },
      priority: 'normal',
    },
    // ── Pair 2: Spanish heart-language scripture (Maria → David) ───
    {
      id: 'demo-maria-need-spanish-bible-leader',
      direction: 'receive',
      object: 'resourceType:Worker',
      topic: 'Bilingual Spanish Bible study facilitator for new families',
      intentType: 'intentType:NeedTeacher',
      intentTypeLabel: 'Need: Teacher',
      expressedByAgent: MARIA_AGENT_ADDRESS,
      expressedByUserId: 'cat-user-001',
      title: 'Need: Bilingual Spanish Bible study leader for new families',
      detail: 'Seeking a bilingual facilitator for an 8-week introductory Bible study for first-generation Spanish-speaking families across the Wellington and Loveland circles.',
      payload: { geo: 'us/colorado', beneficiaryAgent: MARIA_AGENT_ADDRESS, language: 'es' },
      priority: 'normal',
    },
    {
      id: 'demo-david-offer-spanish-bible-leader',
      direction: 'give',
      object: 'resourceType:Worker',
      topic: 'Bilingual Spanish Bible study facilitation',
      intentType: 'intentType:OfferTeaching',
      intentTypeLabel: 'Offer: Teaching',
      expressedByAgent: DAVID_AGENT_ADDRESS,
      expressedByUserId: 'cat-user-002',
      title: 'Offer: Bilingual Bible study facilitator (Spanish/English)',
      detail: 'Pastor David Chen, fluent Spanish/English, offers to lead introductory and discipleship Bible studies in NoCo Hispanic communities. 5 years prior experience.',
      payload: { geo: 'us/colorado', language: 'es' },
      priority: 'normal',
    },
    // ── Pair 3: prayer partners for church-plant discernment ───────
    // David is the receiver here so the demo shows direction in both ways.
    {
      id: 'demo-david-need-prayer-partners',
      direction: 'receive',
      object: 'resourceType:Prayer',
      topic: 'Daily prayer partners for church-plant discernment',
      intentType: 'intentType:NeedPrayerPartner',
      intentTypeLabel: 'Need: Prayer Partner',
      expressedByAgent: DAVID_AGENT_ADDRESS,
      expressedByUserId: 'cat-user-002',
      title: 'Need: Daily prayer partners for Loveland church-plant discernment',
      detail: 'Standing prayer partners for the next 90 days as our team discerns location and timing for a Loveland Spanish-speaking house-church plant.',
      payload: { geo: 'us/colorado', beneficiaryAgent: DAVID_AGENT_ADDRESS },
      priority: 'high',
    },
    {
      id: 'demo-maria-offer-prayer-commitment',
      direction: 'give',
      object: 'resourceType:Prayer',
      topic: 'Daily intercessory prayer for NoCo church planters',
      intentType: 'intentType:OfferPrayer',
      intentTypeLabel: 'Offer: Prayer',
      expressedByAgent: MARIA_AGENT_ADDRESS,
      expressedByUserId: 'cat-user-001',
      title: 'Offer: Daily intercessory prayer for NoCo church planters',
      detail: 'Standing daily prayer commitment for any NoCo church-plant discernment process. 10 minutes per day, anonymous attribution unless requested otherwise.',
      payload: { geo: 'us/colorado' },
      priority: 'normal',
    },
  ]
}

// ────────────────────────────────────────────────────────────────────────
// Match initiation — primer for the Playwright assertion that Maria's
// trauma-care detail page renders a pending pair on first paint.
// ────────────────────────────────────────────────────────────────────────

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

interface SqliteHandle {
  prepare: (sql: string) => {
    run: (params?: Record<string, unknown> | string | number) => void
    get: (...args: unknown[]) => unknown
  }
  close: () => void
}

async function openSqlite(dbPath: string): Promise<SqliteHandle> {
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => SqliteHandle }).default
  return new Database(dbPath)
}

async function seedIntents(): Promise<IntentRow[]> {
  const dbPath = path.join(repoRoot, 'apps/web/local.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-match-initiation] web db not found at ${dbPath} — skipping intent seed`)
    return []
  }
  const db = await openSqlite(dbPath)
  try {
    // Resolve Maria + Pastor David's real on-chain agents (provisioned by
    // the catalyst seed). Falls back to the placeholders if either user
    // isn't seeded yet — in that case re-run after fresh-start finishes.
    try {
      const row = (db.prepare(`SELECT lower(person_agent_address) AS addr FROM users WHERE id = 'cat-user-001'`)).get() as { addr?: string } | undefined
      if (row?.addr) MARIA_AGENT_ADDRESS = row.addr
    } catch { /* users table may not exist yet */ }
    try {
      const row = (db.prepare(`SELECT lower(person_agent_address) AS addr FROM users WHERE id = 'cat-user-002'`)).get() as { addr?: string } | undefined
      if (row?.addr) DAVID_AGENT_ADDRESS = row.addr
    } catch { /* users table may not exist yet */ }
    if (MARIA_AGENT_ADDRESS !== MARIA_AGENT_PLACEHOLDER) {
      console.log(`[seed-test-match-initiation] resolved Maria agent → ${MARIA_AGENT_ADDRESS}`)
    }
    if (DAVID_AGENT_ADDRESS !== DAVID_AGENT_PLACEHOLDER) {
      console.log(`[seed-test-match-initiation] resolved Pastor David agent → ${DAVID_AGENT_ADDRESS}`)
    }
    const pairs = buildIntentPairs()
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
    for (const p of pairs) {
      stmt.run({
        id: p.id,
        direction: p.direction,
        object: p.object,
        topic: p.topic,
        intent_type: p.intentType,
        intent_type_label: p.intentTypeLabel,
        expressed_by_agent: p.expressedByAgent,
        expressed_by_user_id: p.expressedByUserId,
        addressed_to: `hub:${HUB_ID}`,
        hub_id: HUB_ID,
        title: p.title,
        detail: p.detail,
        payload: JSON.stringify(p.payload),
        status: 'expressed',
        priority: p.priority,
        visibility: 'public',
        expected_outcome: null,
        projection_ref: null,
        valid_until: null,
        created_at: NOW,
        updated_at: NOW,
      })
    }
    type CountRow = { n: number }
    const seededRow = (db.prepare(`SELECT COUNT(*) AS n FROM intents WHERE id LIKE 'demo-%'`)).get() as CountRow | undefined
    const seeded = seededRow?.n ?? 0
    if (seeded < pairs.length) {
      throw new Error(
        `[seed-test-match-initiation] expected ${pairs.length} demo intents, found ${seeded} — ` +
        `the web app's intents table may not exist (auto-migration hasn't run). ` +
        `Visit http://localhost:3000/ once to trigger migration, then re-run this script.`,
      )
    }
    console.log(`[seed-test-match-initiation] verified ${seeded} demo intents in local.db`)
    return pairs
  } finally {
    db.close()
  }
}

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
    stmt.run({
      id: SELF_INITIATION_ID,
      principal: MARIA_PRINCIPAL,
      viewed_intent_id: 'demo-maria-need-trauma-coaching',
      candidate_intent_id: 'demo-david-offer-trauma-coaching',
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
      stmt.run({
        id: CONNECTOR_INITIATION_ID,
        principal: MARIA_PRINCIPAL,
        viewed_intent_id: 'demo-maria-need-trauma-coaching',
        candidate_intent_id: 'demo-david-offer-trauma-coaching',
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
  const pairs = await seedIntents()
  await seedInitiation({ connector: seedConnector })
  console.log(`\n✓ Seeded ${pairs.length} intents (${pairs.length / 2} faith-themed pairs):`)
  for (const p of pairs) {
    const arrow = p.direction === 'receive' ? '←' : '→'
    console.log(`    ${arrow} ${p.id} — ${p.title}`)
  }
  console.log('  Sign in as Maria, visit:')
  console.log(`    http://localhost:3000/h/${HUB_ID}/intents`)
  console.log(`    http://localhost:3000/h/${HUB_ID}/intents/demo-maria-need-trauma-coaching`)
  console.log(`    http://localhost:3000/h/${HUB_ID}/intents/demo-maria-need-spanish-bible-leader`)
  console.log(`    http://localhost:3000/h/${HUB_ID}/intents/demo-david-need-prayer-partners`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
