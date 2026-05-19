import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ─── Inter-service replay-nonce cache ────────────────────────────────
// Shared across inter-service-auth (`x-a2a-service` envelope from MCPs)
// AND service-auth-web (`X-SA-Service: web` envelope from the web app).
// Both envelopes generate a fresh per-request nonce; first INSERT wins,
// duplicates fail on the UNIQUE constraint and the verifier returns
// 401 "replay detected". A periodic GC job in `src/index.ts` removes
// rows older than 2 * MAX_CLOCK_SKEW_SECONDS (Hardening §1.10).
export const interServiceNonce = sqliteTable('inter_service_nonce', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nonce: text('nonce').notNull().unique(),
  service: text('service').notNull(),
  usedAt: text('used_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Challenges ──────────────────────────────────────────────────────

export const challenges = sqliteTable('challenges', {
  id: text('id').primaryKey(),
  accountAddress: text('account_address').notNull(),
  nonce: text('nonce').notNull().unique(),
  typedDataJson: text('typed_data_json').notNull(),
  status: text('status', { enum: ['pending', 'verified', 'expired'] })
    .notNull()
    .default('pending'),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ─── Sessions ────────────────────────────────────────────────────────

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  accountAddress: text('account_address').notNull(),
  sessionKeyAddress: text('session_key_address'),
  encryptedPackage: text('encrypted_package'),
  iv: text('iv'),
  hmacSecret: text('hmac_secret'),
  status: text('status', { enum: ['pending', 'active', 'expired', 'revoked'] })
    .notNull()
    .default('pending'),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  // Phase 3 — set iff the session was bootstrapped as a stateful
  // ERC-7579 SessionAgentAccount (executionPath='session-account').
  // Null for the standard stateless EOA session principal.
  sessionAgentAccount: text('session_agent_account'),
  // ─── KMS migration K0+K1 — session envelope encryption columns ─────
  // See KMS-IMPLEMENTATION-PLAN.md §4.
  /** Base64 of the KMS-wrapped data key (aws-kms) OR the HKDF salt (local-aes). */
  encryptedDataKey: text('encrypted_data_key'),
  /** Provider tag — e.g. 'aws-kms:<uuid>' or 'local-v1'. Drives provider
   *  selection on decrypt — see auth/encryption.ts. */
  keyVersion: text('key_version').notNull().default('local-v1'),
  /** Informational; the KMS keyId/ARN (or 'local') at encryption time. Passed
   *  back into decryptSessionDataKey so the KMS knows which key to use. */
  kmsKeyId: text('kms_key_id'),
  // ─── Spec 007 Phase B — hybrid session-variant metadata ───────────
  // `variant` is 'A' (off-chain caveated delegation; default) or 'B'
  // (on-chain accepted delegation). The pre-Phase-B `/session/init`
  // route writes NULL — those rows are treated as Variant A by the
  // policy-gate (matches the existing behavior since Variant A is the
  // only thing the existing redeem path could do anyway).
  variant: text('variant', { enum: ['A', 'B'] }),
  // Classified action-risk tier (`low`|`medium`|`high`|`critical`).
  // Sessions created by the hybrid /session/hybrid-init endpoint set
  // this from `classifySessionRiskTier(scope)`. Pre-Phase-B sessions
  // have NULL (treated as 'medium' by the policy-gate).
  riskTier: text('risk_tier', {
    enum: ['low', 'medium', 'high', 'critical'],
  }),
  // Variant B only — `sessionDelegationHash` registered on chain via
  // `AgentAccount.acceptSessionDelegation(hash)` at session-init. NULL
  // for Variant A.
  sessionDelegationHash: text('session_delegation_hash'),
  // Variant B only — the userOp hash submitted at session-init time.
  // Recorded for audit join: a verifier can grep this column for the
  // session-init txHash and confirm the on-chain `_acceptedSessionDelegations`
  // mapping reflects what we persisted.
  onChainAcceptedTxHash: text('onchain_accepted_tx_hash'),
})

// ─── Handles ─────────────────────────────────────────────────────────

export const handles = sqliteTable('handles', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  accountAddress: text('account_address').notNull(),
  agentType: text('agent_type', { enum: ['person', 'org', 'ai'] }).notNull(),
  endpointUrl: text('endpoint_url'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ─── Execution audit (Phase 0 — delegation architecture) ────────────
// One row per action that flows through a2a-agent (MCP call OR on-chain
// redeem). Mirrors `ExecutionReceipt` in @smart-agent/sdk audit/types.
//
// Sprint 3 S3.1 — hash chain. Every row now carries
// `prev_entry_hash` + `entry_hash` so an external checkpoint can attest
// to the chain head without needing the full row history. Computation:
//
//   entry_hash = sha256(
//     prev_entry_hash ||
//     JSON.stringify({ ...row fields excluding entry_hash + prev_entry_hash })
//   )
//
// Mirrors person-mcp's `audit_log` ledger (see
// `apps/person-mcp/src/session-store/index.ts::computeEntryHash`). The
// columns are nullable for forward-compat with rows inserted before
// Sprint 3; new rows always populate them.
//
// P0-5 (outcome binding, two-row model) — outcome is now hash-bound by
// emitting a SEPARATE `request_finalized` (or `request_denied`) row
// rather than UPDATEing the original `request_received` row. The new
// `event_kind` column distinguishes the three row kinds; the new
// `request_received_row_id` column points the outcome row back at its
// origin so a verifier can link them. The two/three rows share the same
// `correlation_id`. See `lib/audit.ts` module doc for the trade-off
// (two-row vs dual-hash) and rationale.
export const executionAudit = sqliteTable('execution_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  rootGrantHash: text('root_grant_hash').notNull(),
  sessionId: text('session_id').notNull(),
  sessionPrincipal: text('session_principal').notNull(),
  a2aTaskId: text('a2a_task_id').notNull().default(''),
  mcpServer: text('mcp_server').notNull(),
  mcpTool: text('mcp_tool').notNull(),
  mcpCallId: text('mcp_call_id').notNull().unique(),
  // Sprint 3 S3.2 — event-type tag for non-execution audit rows.
  // Examples: `kms-decrypt`, `kms-decrypt-failed`, `kms-sign`,
  // `session-create`, `session-package`, `session-revoke`,
  // `session-epoch-bump`, `key-version-rejected`. NULL for the
  // pre-S3.2 execution rows (mcpTool already carries the family).
  eventType: text('event_type'),
  // P0-5 — row-kind tag for the two-row outcome model. NULL on
  // pre-P0-5 rows (treated as 'request_received'); new inserts always
  // populate.
  //   - 'request_received'  → original auditAppend row (request side)
  //   - 'request_finalized' → terminal outcome row written by auditFinalize
  //   - 'request_denied'    → terminal denial row written by auditDeny
  eventKind: text('event_kind', {
    enum: ['request_received', 'request_finalized', 'request_denied'],
  }),
  // P0-5 — outcome rows (`request_finalized` / `request_denied`) carry
  // the PK of the originating `request_received` row so a verifier can
  // link the two and so the outcome row's hash binding can include the
  // origin PK. NULL on `request_received` rows.
  requestReceivedRowId: integer('request_received_row_id'),
  executionPath: text('execution_path', { enum: ['mcp-only', 'stateless-redeem', 'sub-delegated', 'session-account'] }).notNull(),
  toolGrantHash: text('tool_grant_hash'),
  toolExecutor: text('tool_executor'),
  target: text('target'),
  selector: text('selector'),
  callDataHash: text('call_data_hash'),
  valueWei: text('value_wei').notNull().default('0'),
  txHash: text('tx_hash'),
  userOpHash: text('user_op_hash'),
  status: text('status', { enum: ['completed', 'reverted', 'denied', 'pending'] }).notNull(),
  errorReason: text('error_reason').notNull().default(''),
  receivedAt: text('received_at').notNull(),
  finalizedAt: text('finalized_at'),
  // ─── Hardening Phase 1D — cross-service correlation id ───────────────
  // Set at the web request edge (`apps/web/src/lib/audit/correlation-id.ts`),
  // propagated through the `X-SA-Correlation-Id` HTTP header on every
  // hop (web → a2a-agent → MCP). Persisted here so a single user action
  // can be traced across all three planes. Nullable — pre-1D rows have
  // no correlation id; the migration in `db/index.ts` adds the column
  // with NULL default.
  correlationId: text('correlation_id'),
  // ─── Sprint 3 S3.1 — append-only hash chain ─────────────────────────
  // Every row's entry_hash is sha256(prev_entry_hash || JSON of fields
  // excluding both chain columns). Tampering with any row breaks the
  // chain from that row forward; the checkpoint emitter in
  // `lib/audit-checkpoint.ts` signs the chain head over an interval so
  // an external sink can detect SQLite-level mutation.
  prevEntryHash: text('prev_entry_hash'),
  entryHash: text('entry_hash'),
})

// ─── Sprint 3 S3.1 — audit checkpoint table ─────────────────────────
// Signed periodic snapshot of the chain head. Each row asserts that at
// `timestamp` the auditor was running and the most-recent
// execution_audit row had id=`latestEntryId` and entry_hash=
// `latestEntryHash`. The signature covers
// `keccak256(latestEntryHash || timestamp || chainId)` and is produced
// by the master signer (`getMasterSigner()`).
//
// External anchor: if `AUDIT_CHECKPOINT_SINK_URL` is set, the same
// checkpoint payload is POSTed to the sink (Azure Monitor / S3 / SIEM)
// so an attacker who tampers with the local DB cannot also rewrite the
// external history.
export const auditCheckpoint = sqliteTable('audit_checkpoint', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  latestEntryId: integer('latest_entry_id').notNull(),
  latestEntryHash: text('latest_entry_hash').notNull(),
  timestamp: text('timestamp').notNull(),
  chainId: integer('chain_id').notNull(),
  signature: text('signature').notNull(),
  signerAddress: text('signer_address').notNull(),
  sinkStatus: text('sink_status').notNull().default('not-configured'),
  sinkAttempts: integer('sink_attempts').notNull().default(0),
})

// ─── Append-only invariant ──────────────────────────────────────────
//
// The `executionAudit` table is strictly append-only at the application
// layer (Hardening Phase 1D #3, tightened by P0-5). Writes go through
// `apps/a2a-agent/src/lib/audit.ts` `auditAppend()` /
// `auditFinalize()` / `auditDeny()` — every helper does an INSERT. No
// helper performs an UPDATE or DELETE on `executionAudit`.
//
// `scripts/check-no-bypass.sh` rejects ANY `db.update(executionAudit)` or
// `db.delete(executionAudit)` call site anywhere in the source tree,
// including `lib/audit.ts`. Any future schema change that adds a column
// must preserve this invariant — outcome must be encoded as a new
// hash-chained row, never as a mutation of an existing one.
