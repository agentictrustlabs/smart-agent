import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const sqlite = new Database('local.db')

// Enable WAL mode for better concurrent access
sqlite.pragma('journal_mode = WAL')
// Sprint 3 S3.1 — busy_timeout for write contention. The audit
// hash-chain `auditAppend` helper runs a SELECT-head + INSERT inside a
// transaction; under heavy parallelism (multiple test files, multiple
// concurrent requests) the second writer's `BEGIN IMMEDIATE` would
// otherwise return SQLITE_BUSY immediately. With this set the SQLite
// engine waits up to 5 s for the lock before giving up — long enough
// for typical request bursts, short enough that a genuinely-stuck DB
// surfaces as an error rather than a hang.
sqlite.pragma('busy_timeout = 5000')

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
    session_agent_account TEXT,
    -- KMS migration K0+K1 — session envelope encryption columns.
    -- encrypted_data_key: base64 of the KMS-wrapped data key (aws-kms) or
    --   the HKDF salt (local-aes).
    -- key_version: provider tag ('local-v1' or 'aws-kms:<uuid>').
    -- kms_key_id: the KMS keyId / ARN at encryption time ('local' for the dev shim).
    encrypted_data_key TEXT,
    key_version TEXT NOT NULL DEFAULT 'local-v1',
    kms_key_id TEXT
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
  --
  -- P0-5 — outcome-binding two-row model: a single user action yields
  -- TWO (or more) rows — one event_kind='request_received' written at
  -- request time and one event_kind='request_finalized' (or
  -- request_denied) written at outcome time. The outcome row's
  -- request_received_row_id points back at the origin's PK. The
  -- hash chain binds both rows; the table is strictly append-only —
  -- no UPDATE site exists.
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
    finalized_at TEXT,
    -- Hardening Phase 1D — cross-service correlation id (web→a2a→mcp→chain).
    -- Nullable: pre-1D rows have NULL; the migration block below adds the
    -- column for older DBs.
    correlation_id TEXT,
    -- P0-5 — row-kind tag and origin-row link for the two-row outcome
    -- model. Nullable so pre-P0-5 rows are treated as request_received.
    event_kind TEXT,
    request_received_row_id INTEGER
  );
  -- idx_execution_audit_correlation is created in the migration block
  -- below (after ALTER TABLE adds the column for older DBs). Creating
  -- the index here in the main SQL block would fail on an existing DB
  -- that has the table but not yet the column.
  CREATE INDEX IF NOT EXISTS idx_execution_audit_session ON execution_audit(session_id);
  CREATE INDEX IF NOT EXISTS idx_execution_audit_task ON execution_audit(a2a_task_id);
  CREATE INDEX IF NOT EXISTS idx_execution_audit_tool ON execution_audit(mcp_tool);
  CREATE INDEX IF NOT EXISTS idx_execution_audit_status ON execution_audit(status);
  CREATE INDEX IF NOT EXISTS idx_execution_audit_received_at ON execution_audit(received_at);

  -- ─── Hardening §1.10 — Inter-service replay-nonce cache ──────────
  -- Shared by both the MCP-side requireInterServiceAuth envelope and
  -- the web-side requireServiceAuth(web) envelope. Same nonce replayed
  -- across either path is rejected by the UNIQUE constraint.
  CREATE TABLE IF NOT EXISTS inter_service_nonce (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nonce     TEXT NOT NULL UNIQUE,
    service   TEXT NOT NULL,
    used_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inter_service_nonce_used_at ON inter_service_nonce(used_at);
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

// KMS migration K0+K1 — best-effort migration for older DBs that pre-date
// the envelope-encryption columns. See KMS-IMPLEMENTATION-PLAN.md §4.
try {
  const cols = sqlite.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>
  const colNames = new Set(cols.map((c) => c.name))
  if (!colNames.has('encrypted_data_key')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN encrypted_data_key TEXT`)
  }
  if (!colNames.has('key_version')) {
    // SQLite cannot add a NOT NULL column without a default; the literal
    // default 'local-v1' tags every new row with the active dev provider.
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN key_version TEXT NOT NULL DEFAULT 'local-v1'`)
  }
  if (!colNames.has('kms_key_id')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN kms_key_id TEXT`)
  }
} catch { /* columns already exist or table missing — both fine */ }

// Spec 007 Phase B — best-effort migration for hybrid session-variant
// columns (variant, risk_tier, session_delegation_hash,
// onchain_accepted_tx_hash). All nullable so pre-Phase-B sessions
// retain backward-compat semantics; the policy-gate treats NULL
// variant as 'A' and NULL risk_tier as 'medium'.
try {
  const cols = sqlite.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>
  const colNames = new Set(cols.map((c) => c.name))
  if (!colNames.has('variant')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN variant TEXT`)
  }
  if (!colNames.has('risk_tier')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN risk_tier TEXT`)
  }
  if (!colNames.has('session_delegation_hash')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN session_delegation_hash TEXT`)
  }
  if (!colNames.has('onchain_accepted_tx_hash')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN onchain_accepted_tx_hash TEXT`)
  }
} catch { /* columns already exist or table missing — both fine */ }

// Hardening Phase 1D — best-effort migration for older DBs that pre-date
// the cross-service `correlation_id` column on `execution_audit`. The
// column is nullable so pre-existing rows keep their NULL value; new
// inserts always carry the id set by the web edge. The index is also
// created here (not in the main CREATE-TABLE block) so it can be safely
// applied AFTER the ALTER on older DBs.
try {
  const cols = sqlite.prepare(`PRAGMA table_info(execution_audit)`).all() as Array<{ name: string }>
  const colNames = new Set(cols.map((c) => c.name))
  if (!colNames.has('correlation_id')) {
    sqlite.exec(`ALTER TABLE execution_audit ADD COLUMN correlation_id TEXT`)
  }
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_execution_audit_correlation ON execution_audit(correlation_id)`)
} catch { /* column already exists or table missing — both fine */ }

// Sprint 3 S3.1 + S3.2 — best-effort migration for the hash-chain
// columns (`prev_entry_hash`, `entry_hash`) and the event-type tag
// (`event_type`) on `execution_audit`. All three are nullable for
// forward-compat with pre-S3 rows; new inserts always populate them.
//
// P0-5 — outcome-binding two-row model adds two more columns:
//   `event_kind`              ('request_received' | 'request_finalized' | 'request_denied')
//   `request_received_row_id` (FK-by-value back to the origin row's PK; NULL on origin rows)
// Both are nullable on pre-P0-5 rows (treated as `request_received`).
try {
  const cols = sqlite.prepare(`PRAGMA table_info(execution_audit)`).all() as Array<{ name: string }>
  const colNames = new Set(cols.map((c) => c.name))
  if (!colNames.has('event_type')) {
    sqlite.exec(`ALTER TABLE execution_audit ADD COLUMN event_type TEXT`)
  }
  if (!colNames.has('prev_entry_hash')) {
    sqlite.exec(`ALTER TABLE execution_audit ADD COLUMN prev_entry_hash TEXT`)
  }
  if (!colNames.has('entry_hash')) {
    sqlite.exec(`ALTER TABLE execution_audit ADD COLUMN entry_hash TEXT`)
  }
  if (!colNames.has('event_kind')) {
    sqlite.exec(`ALTER TABLE execution_audit ADD COLUMN event_kind TEXT`)
  }
  if (!colNames.has('request_received_row_id')) {
    sqlite.exec(`ALTER TABLE execution_audit ADD COLUMN request_received_row_id INTEGER`)
  }
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_execution_audit_event_type ON execution_audit(event_type)`)
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_execution_audit_event_kind ON execution_audit(event_kind)`)
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_execution_audit_request_received_row_id ON execution_audit(request_received_row_id)`)
} catch { /* column already exists or table missing — both fine */ }

// Sprint 3 S3.1 — audit-checkpoint ledger. Signed periodic snapshots of
// the executionAudit chain head. Trimmed to the last 30 days by the
// periodic GC in `src/index.ts` (the chain itself lives in
// executionAudit; we only need recent checkpoints to anchor it).
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS audit_checkpoint (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    latest_entry_id INTEGER NOT NULL,
    latest_entry_hash TEXT NOT NULL,
    timestamp       TEXT NOT NULL,
    chain_id        INTEGER NOT NULL,
    signature       TEXT NOT NULL,
    signer_address  TEXT NOT NULL,
    sink_status     TEXT NOT NULL DEFAULT 'not-configured',
    sink_attempts   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_audit_checkpoint_timestamp ON audit_checkpoint(timestamp);
`)

export const db = drizzle(sqlite, { schema })

/**
 * Raw better-sqlite3 handle. Exposed for the audit hash-chain helper
 * (`lib/audit.ts::auditAppend`) which needs `sqlite.transaction` for
 * the atomic SELECT-head-and-INSERT pattern. Drizzle's async wrapper
 * doesn't expose transactions at this layer.
 *
 * DO NOT introduce new call sites without coordinating with the
 * `execution_audit` append-only invariant — direct mutation of the
 * audit table from anywhere except `lib/audit.ts` is forbidden (see
 * `scripts/check-no-bypass.sh`).
 */
export const sqliteHandle: DatabaseType = sqlite
