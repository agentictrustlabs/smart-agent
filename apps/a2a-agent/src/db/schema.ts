import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

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
export const executionAudit = sqliteTable('execution_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  rootGrantHash: text('root_grant_hash').notNull(),
  sessionId: text('session_id').notNull(),
  sessionPrincipal: text('session_principal').notNull(),
  a2aTaskId: text('a2a_task_id').notNull().default(''),
  mcpServer: text('mcp_server').notNull(),
  mcpTool: text('mcp_tool').notNull(),
  mcpCallId: text('mcp_call_id').notNull().unique(),
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
})
