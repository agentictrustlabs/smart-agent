import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const sqlite = new Database('local.db')

// Enable WAL mode for better concurrent access
sqlite.pragma('journal_mode = WAL')

// ─── Auto-create tables ─────────────────────────────────────────────

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    account_address TEXT NOT NULL,
    nonce TEXT NOT NULL UNIQUE,
    typed_data_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    account_address TEXT NOT NULL,
    session_key_address TEXT,
    encrypted_package TEXT,
    iv TEXT,
    hmac_secret TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    -- Phase 3 — stateful session-account principal. NULL for stateless EOA sessions.
    -- When set, the redeem path routes through this SessionAgentAccount via 4337
    -- UserOps signed by the session EOA (whose private key lives in encrypted_package).
    session_agent_account TEXT
  );

  CREATE TABLE IF NOT EXISTS handles (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    account_address TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    endpoint_url TEXT,
    created_at TEXT NOT NULL
  );

  -- ─── Phase 0 — Delegation execution audit ──────────────────────────
  -- Every action (MCP-only, redeem, sub-delegated, session-account) flowing
  -- through a2a-agent writes one row here. See packages/sdk/src/audit/types.ts
  -- for the canonical ExecutionReceipt schema.
  CREATE TABLE IF NOT EXISTS execution_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- identity
    root_grant_hash TEXT NOT NULL,
    session_id TEXT NOT NULL,
    session_principal TEXT NOT NULL,
    -- task
    a2a_task_id TEXT NOT NULL DEFAULT '',
    -- tool
    mcp_server TEXT NOT NULL,
    mcp_tool TEXT NOT NULL,
    mcp_call_id TEXT NOT NULL UNIQUE,
    -- execution
    execution_path TEXT NOT NULL CHECK(execution_path IN ('mcp-only','stateless-redeem','sub-delegated','session-account')),
    tool_grant_hash TEXT,
    tool_executor TEXT,
    target TEXT,
    selector TEXT,
    call_data_hash TEXT,
    value_wei TEXT NOT NULL DEFAULT '0',
    -- outcome
    tx_hash TEXT,
    user_op_hash TEXT,
    status TEXT NOT NULL CHECK(status IN ('completed','reverted','denied','pending')),
    error_reason TEXT NOT NULL DEFAULT '',
    -- time
    received_at TEXT NOT NULL,
    finalized_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_execution_audit_session ON execution_audit(session_id);
  CREATE INDEX IF NOT EXISTS idx_execution_audit_task ON execution_audit(a2a_task_id);
  CREATE INDEX IF NOT EXISTS idx_execution_audit_tool ON execution_audit(mcp_tool);
  CREATE INDEX IF NOT EXISTS idx_execution_audit_status ON execution_audit(status);
  CREATE INDEX IF NOT EXISTS idx_execution_audit_received_at ON execution_audit(received_at);
`)

// Phase 3 — best-effort migration for older DBs that pre-date the
// `session_agent_account` column. ALTER TABLE … ADD COLUMN throws if the
// column already exists; wrap in a pragma+try so dev installs keep working.
try {
  const cols = sqlite.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>
  if (!cols.find((c) => c.name === 'session_agent_account')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN session_agent_account TEXT`)
  }
} catch { /* column already exists or table missing — both fine */ }

export const db = drizzle(sqlite, { schema })
