/**
 * Spec 007 Phase F.2.1 — A2A-agent Postgres schema (pgTable mirror).
 *
 * Parallel to `schema.ts` (sqliteTable). The two schemas describe the
 * SAME logical tables; the active one at runtime is selected by
 * `storageBackend.kind` in `db/pool.ts`. Drizzle migrations are
 * generated from THIS file via `drizzle.config.ts`. The Postgres
 * arm enforces the canonical Phase F.2 constraints:
 *
 *   - `inter_service_nonces` (plural) replaces the legacy
 *     `inter_service_nonce` (singular) SQLite table. UNIQUE
 *     `(scope, nonce)` is the load-bearing replay-protection
 *     constraint (Phase F.2 spec § Transactional semantics).
 *
 * Adding a column: edit BOTH files, then re-run
 *   `pnpm --filter @smart-agent/a2a-agent exec drizzle-kit generate`.
 */
import {
  pgTable,
  text,
  integer,
  bigserial,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// ─── Inter-service replay-nonce cache ────────────────────────────────
// Canonical Postgres table name is plural `inter_service_nonces` per
// the F.2 spec. Composite UNIQUE `(scope, nonce)` is the security
// invariant; nonces from different scopes are not allowed to collide
// either, but the practical concurrency target is per-scope replay.
//
// The Postgres ON CONFLICT DO NOTHING path lives in
// `packages/sdk/src/storage/index.ts::consumeNoncePostgres`.
export const interServiceNonces = pgTable(
  'inter_service_nonces',
  {
    scope: text('scope').notNull(),
    nonce: text('nonce').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.scope, t.nonce] }),
    usedAtIdx: index('idx_inter_service_nonces_used_at').on(t.usedAt),
  }),
)

// ─── Challenges ──────────────────────────────────────────────────────

export const challenges = pgTable('challenges', {
  id: text('id').primaryKey(),
  accountAddress: text('account_address').notNull(),
  nonce: text('nonce').notNull().unique(),
  typedDataJson: text('typed_data_json').notNull(),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Sessions ────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  accountAddress: text('account_address').notNull(),
  sessionKeyAddress: text('session_key_address'),
  encryptedPackage: text('encrypted_package'),
  iv: text('iv'),
  hmacSecret: text('hmac_secret'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sessionAgentAccount: text('session_agent_account'),
  // KMS K0+K1
  encryptedDataKey: text('encrypted_data_key'),
  keyVersion: text('key_version').notNull().default('local-v1'),
  kmsKeyId: text('kms_key_id'),
  // Phase B — hybrid session-variant metadata
  variant: text('variant'),
  riskTier: text('risk_tier'),
  sessionDelegationHash: text('session_delegation_hash'),
  onChainAcceptedTxHash: text('onchain_accepted_tx_hash'),
})

// ─── Handles ─────────────────────────────────────────────────────────

export const handles = pgTable('handles', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  accountAddress: text('account_address').notNull(),
  agentType: text('agent_type').notNull(),
  endpointUrl: text('endpoint_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Execution audit ─────────────────────────────────────────────────
// Append-only hash-chained ledger. See `lib/audit.ts` for invariant.
export const executionAudit = pgTable(
  'execution_audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rootGrantHash: text('root_grant_hash').notNull(),
    sessionId: text('session_id').notNull(),
    sessionPrincipal: text('session_principal').notNull(),
    a2aTaskId: text('a2a_task_id').notNull().default(''),
    mcpServer: text('mcp_server').notNull(),
    mcpTool: text('mcp_tool').notNull(),
    mcpCallId: text('mcp_call_id').notNull().unique(),
    eventType: text('event_type'),
    eventKind: text('event_kind'),
    requestReceivedRowId: integer('request_received_row_id'),
    executionPath: text('execution_path').notNull(),
    toolGrantHash: text('tool_grant_hash'),
    toolExecutor: text('tool_executor'),
    target: text('target'),
    selector: text('selector'),
    callDataHash: text('call_data_hash'),
    valueWei: text('value_wei').notNull().default('0'),
    txHash: text('tx_hash'),
    userOpHash: text('user_op_hash'),
    status: text('status').notNull(),
    errorReason: text('error_reason').notNull().default(''),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    correlationId: text('correlation_id'),
    prevEntryHash: text('prev_entry_hash'),
    entryHash: text('entry_hash'),
  },
  (t) => ({
    sessionIdx: index('idx_execution_audit_session').on(t.sessionId),
    taskIdx: index('idx_execution_audit_task').on(t.a2aTaskId),
    toolIdx: index('idx_execution_audit_tool').on(t.mcpTool),
    statusIdx: index('idx_execution_audit_status').on(t.status),
    receivedAtIdx: index('idx_execution_audit_received_at').on(t.receivedAt),
    correlationIdx: index('idx_execution_audit_correlation').on(t.correlationId),
    eventTypeIdx: index('idx_execution_audit_event_type').on(t.eventType),
    eventKindIdx: index('idx_execution_audit_event_kind').on(t.eventKind),
    rrRowIdx: index('idx_execution_audit_request_received_row_id').on(
      t.requestReceivedRowId,
    ),
  }),
)

// ─── Audit checkpoint ───────────────────────────────────────────────
export const auditCheckpoint = pgTable(
  'audit_checkpoint',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    latestEntryId: integer('latest_entry_id').notNull(),
    latestEntryHash: text('latest_entry_hash').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    chainId: integer('chain_id').notNull(),
    signature: text('signature').notNull(),
    signerAddress: text('signer_address').notNull(),
    sinkStatus: text('sink_status').notNull().default('not-configured'),
    sinkAttempts: integer('sink_attempts').notNull().default(0),
  },
  (t) => ({
    timestampIdx: index('idx_audit_checkpoint_timestamp').on(t.timestamp),
  }),
)

// suppress unused-import warning for uniqueIndex — kept available so
// future column additions don't need a re-import.
void uniqueIndex
