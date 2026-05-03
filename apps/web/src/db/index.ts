import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import path from 'path'
import fs from 'fs'

const sqlite = new Database(process.env.DATABASE_URL ?? 'local.db')

// Auto-run migrations on startup to ensure all tables exist
const migrationsDir = path.resolve(process.cwd(), 'drizzle')
if (fs.existsSync(migrationsDir)) {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    for (const stmt of sql.split('--> statement-breakpoint')) {
      // Strip SQL comments and find the CREATE statement
      const lines = stmt.split('\n').filter(l => !l.trimStart().startsWith('--'))
      const cleaned = lines.join('\n').trim()
      if (cleaned && (cleaned.includes('CREATE') || cleaned.includes('ALTER') || cleaned.includes('DROP'))) {
        const safe = cleaned.replace(/CREATE TABLE `/g, 'CREATE TABLE IF NOT EXISTS `')
          .replace(/CREATE UNIQUE INDEX `/g, 'CREATE UNIQUE INDEX IF NOT EXISTS `')
          .replace(/CREATE INDEX `/g, 'CREATE INDEX IF NOT EXISTS `')
        try { sqlite.prepare(safe).run() } catch { /* already exists, parse error, or other */ }
      }
    }
  }
}

// Add new columns not in original migrations
try { sqlite.prepare('ALTER TABLE users ADD COLUMN person_agent_address TEXT').run() } catch { /* already exists */ }
try { sqlite.prepare('ALTER TABLE users ADD COLUMN agent_name TEXT').run() } catch { /* already exists */ }
try { sqlite.prepare('ALTER TABLE users ADD COLUMN onboarded_at TEXT').run() } catch { /* already exists */ }
try { sqlite.prepare('ALTER TABLE users ADD COLUMN account_salt_rotation INTEGER NOT NULL DEFAULT 0').run() } catch { /* already exists */ }

// Drop legacy passkeys table — login is now name-based via the .agent
// registry, and the OS picker is hinted by browser-side localStorage. No
// server-side credentialId mapping is kept anymore.
try { sqlite.prepare('DROP TABLE IF EXISTS passkeys').run() } catch { /* */ }

// Drop orphan tables left behind by older drizzle migrations. Each is no
// longer referenced from schema.ts; the data either moved to person-mcp /
// org-mcp during the data-store consolidation, was anchored on-chain, or
// was always dead code. Runs idempotently on every boot.
const DROPPED_TABLES = [
  // Moved to person-mcp / org-mcp this session:
  'circles',                  // → person-mcp.oikos_contacts
  'prayers',                  // → person-mcp.prayers
  'training_progress',        // → person-mcp.training_progress
  'user_preferences',         // → person-mcp.user_preferences
  'coach_relationships',      // → on-chain COACHING_MENTORSHIP edge + cross-delegation
  'pinned_items',             // → person-mcp.pinned_items
  'revenue_reports',          // → org-mcp.revenue_reports
  'proposals',                // → org-mcp.proposals
  // Pre-existing dead migrations:
  'agent_index',              // superseded by on-chain agent registry / GraphDB
  'ai_agents',                // superseded by on-chain agent registry
  'org_agents',               // superseded by on-chain agent registry
  'person_agents',            // superseded by on-chain agent registry
  'capital_movements',        // never wired
  'demo_edges',               // on-chain edges are canonical
  'gen_map_nodes',            // computed on demand
  'review_delegations',       // on-chain DelegationManager + AgentAssertion
  'review_records',           // superseded by agent_review_records
  'training_completions',     // superseded by training_progress (now in person-mcp)
  'votes',                    // on-chain AgentControl proposals/votes
  // Phase-4/5 cleanup — moved to MCPs / on-chain canonical:
  'detached_members',         // → org-mcp.detached_members (already in agent-resolver too)
  'messages',                 // → person-mcp.notifications / org-mcp.org_notifications
  'intents',                  // → person-mcp.intents / org-mcp.org_intents (owner-routed)
  'needs',                    // → person-mcp.needs / org-mcp.org_needs
  'resource_offerings',       // → person-mcp.offerings / org-mcp.org_offerings
  'outcomes',                 // → person-mcp.outcomes / org-mcp.org_outcomes
  'beliefs',                  // → person-mcp.beliefs / org-mcp.org_beliefs
  'orchestration_plans',      // → org-mcp.orchestration_plans
  'need_resource_matches',    // → on-chain canonical, GraphDB mirror
  // Engagement cluster — on-chain backbone + per-side MCP state:
  'entitlements',             // on-chain canonical + each side's MCP
  'fulfillment_work_items',   // → assignee's MCP (person-mcp.work_items / org-mcp.org_work_items)
  'commitment_thread_entries',// on-chain audit log
  'role_assignments',         // on-chain
  'engagement_sessions',      // → org-mcp.engagement_sessions (provider-side)
  'engagement_tranches',      // → org-mcp.engagement_tranches (provider-side)
  'engagement_policies',      // → org-mcp.engagement_policies (provider-side)
  'policy_signers',           // → org-mcp.policy_signers
  // Trust deposit caches — on-chain canonical, GraphDB aggregates:
  'agent_assertions',
  'agent_review_records',
  'agent_skill_claims',
  'agent_validation_profiles',
  // Activity logs — canonical record now lives on-chain in the org agent's
  // metadata JSON property (`getActivityLog`/`setActivityLog`); the web SQL
  // cache used to duplicate that and held PII (names + locations).
  'activity_logs',
]
for (const t of DROPPED_TABLES) {
  try { sqlite.prepare(`DROP TABLE IF EXISTS ${t}`).run() } catch { /* ignore */ }
}
try {
  sqlite.prepare(`CREATE TABLE IF NOT EXISTS recovery_delegations (
    id TEXT PRIMARY KEY NOT NULL,
    account_address TEXT NOT NULL UNIQUE,
    delegation_json TEXT NOT NULL,
    delegation_hash TEXT NOT NULL,
    recovery_config_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).run()
} catch { /* already exists */ }
try {
  sqlite.prepare(`CREATE TABLE IF NOT EXISTS recovery_intents (
    id TEXT PRIMARY KEY NOT NULL,
    account_address TEXT NOT NULL,
    intent_hash TEXT NOT NULL UNIQUE,
    new_credential_id TEXT NOT NULL,
    new_pub_key_x TEXT NOT NULL,
    new_pub_key_y TEXT NOT NULL,
    ready_at INTEGER NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`).run()
} catch { /* already exists */ }

export const db = drizzle(sqlite, { schema })
export { schema }
