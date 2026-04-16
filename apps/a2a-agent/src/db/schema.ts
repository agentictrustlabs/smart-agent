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
})

// ─── Data Access Delegations (cross-principal grants) ────────────────

export const dataDelegations = sqliteTable('data_delegations', {
  id: text('id').primaryKey(),
  /** Person agent address of the data owner (delegator) */
  grantor: text('grantor').notNull(),
  /** Person agent address of the reader (delegate) */
  grantee: text('grantee').notNull(),
  /** Full delegation struct as JSON (includes caveats, salt, signature) */
  delegationJson: text('delegation_json').notNull(),
  /** EIP-712 delegation hash (for revocation tracking) */
  delegationHash: text('delegation_hash').notNull().unique(),
  /** active | revoked */
  status: text('status', { enum: ['active', 'revoked'] })
    .notNull()
    .default('active'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
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
