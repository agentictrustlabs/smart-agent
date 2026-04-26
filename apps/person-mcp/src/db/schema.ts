import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// ssi_holder_wallets — one-to-one with a principal
// ---------------------------------------------------------------------------
export const ssiHolderWallets = sqliteTable('ssi_holder_wallets', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  walletContext: text('wallet_context').notNull(),
  signerEoa: text('signer_eoa').notNull(),
  holderWalletRef: text('holder_wallet_ref').notNull(),
  linkSecretRef: text('link_secret_ref').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// ssi_credential_metadata — metadata only (no attribute values, no blobs)
// ---------------------------------------------------------------------------
export const ssiCredentialMetadata = sqliteTable('ssi_credential_metadata', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  walletContext: text('wallet_context').notNull(),
  holderWalletRef: text('holder_wallet_ref').notNull(),
  issuerId: text('issuer_id').notNull(),
  schemaId: text('schema_id').notNull(),
  credDefId: text('cred_def_id').notNull(),
  credentialType: text('credential_type').notNull(),
  receivedAt: text('received_at').notNull(),
  status: text('status').notNull().default('active'),
})

// ---------------------------------------------------------------------------
// ssi_proof_audit — one row per proof attempt (ok or denied)
// ---------------------------------------------------------------------------
export const ssiProofAudit = sqliteTable('ssi_proof_audit', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  walletContext: text('wallet_context').notNull(),
  holderWalletRef: text('holder_wallet_ref').notNull(),
  verifierId: text('verifier_id').notNull(),
  purpose: text('purpose').notNull(),
  revealedAttrs: text('revealed_attrs').notNull(),
  predicates: text('predicates').notNull(),
  actionNonce: text('action_nonce').notNull(),
  pairwiseHandle: text('pairwise_handle'),
  holderBindingIncluded: integer('holder_binding_included').notNull().default(0),
  result: text('result').notNull(),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// accounts — smart account registrations per principal
// ---------------------------------------------------------------------------
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  accountAddress: text('account_address').notNull().unique(),
  chainId: integer('chain_id').notNull(),
  label: text('label'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// externalIdentities — OAuth / social / email links
// ---------------------------------------------------------------------------
export const externalIdentities = sqliteTable('external_identities', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  provider: text('provider').notNull(),
  identifier: text('identifier').notNull(),
  verified: integer('verified').notNull().default(0),
  metadata: text('metadata'), // JSON string
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// profiles — one profile per principal
// ---------------------------------------------------------------------------
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull().unique(),
  // ─── Display ─────────────────────────────────────────────────────
  displayName: text('display_name'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  // ─── PII (only accessible via delegation chain) ──────────────────
  email: text('email'),
  phone: text('phone'),
  dateOfBirth: text('date_of_birth'),        // ISO date string YYYY-MM-DD
  gender: text('gender'),                     // free text or enum (male/female/non-binary/prefer-not-to-say)
  language: text('language'),                 // ISO 639-1 (en, es, fr, etc.)
  // ─── Address ─────────────────────────────────────────────────────
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  stateProvince: text('state_province'),
  postalCode: text('postal_code'),
  country: text('country'),                   // ISO 3166-1 alpha-2 (US, GB, TG, etc.)
  // ─── Other ───────────────────────────────────────────────────────
  location: text('location'),                 // freeform location string (legacy compat)
  preferences: text('preferences'),           // JSON string
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// chatThreads — conversation threads
// ---------------------------------------------------------------------------
export const chatThreads = sqliteTable('chat_threads', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  title: text('title'),
  metadata: text('metadata'), // JSON string
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// tokenUsage — JTI tracking for delegation token usage limits
// ---------------------------------------------------------------------------
export const tokenUsage = sqliteTable('token_usage', {
  jti: text('jti').primaryKey(),
  principal: text('principal').notNull(),
  usageCount: integer('usage_count').notNull().default(1),
  usageLimit: integer('usage_limit').notNull(),
  firstUsedAt: text('first_used_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
})

// ---------------------------------------------------------------------------
// chatMessages — messages within threads
// ---------------------------------------------------------------------------
export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => chatThreads.id),
  principal: text('principal').notNull(),
  role: text('role').notNull(), // user | assistant | system | tool
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON string
  createdAt: text('created_at').notNull(),
})
