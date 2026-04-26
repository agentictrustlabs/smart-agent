import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const DB_PATH = process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.db'

const sqliteHandle: DatabaseType = new Database(DB_PATH)

// Enable WAL mode for better concurrent read performance
sqliteHandle.pragma('journal_mode = WAL')

// Schema bootstrap — single source of truth for both the drizzle-typed tables
// (PII, profile, chat, accounts) and the absorbed ssi-wallet tables
// (holder_wallets, credential_metadata, action_nonces, trust_overlap_audit).
//
// The trust-overlap audit got renamed from ssi_proof_audit because the
// presentation-audit table (legacy from when ssi-wallet-mcp + person-mcp ran
// as two services) already owned that name with a different column shape.
sqliteHandle.exec(`
  -- ─── Person identity / profile ──────────────────────────────────────
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    account_address TEXT NOT NULL UNIQUE,
    chain_id INTEGER NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS external_identities (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    provider TEXT NOT NULL,
    identifier TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL UNIQUE,
    display_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    email TEXT,
    phone TEXT,
    date_of_birth TEXT,
    gender TEXT,
    language TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state_province TEXT,
    postal_code TEXT,
    country TEXT,
    location TEXT,
    preferences TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_threads (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    title TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES chat_threads(id),
    principal TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_accounts_principal ON accounts(principal);
  CREATE INDEX IF NOT EXISTS idx_external_identities_principal ON external_identities(principal);

  CREATE TABLE IF NOT EXISTS token_usage (
    jti TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 1,
    usage_limit INTEGER NOT NULL,
    first_used_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_profiles_principal ON profiles(principal);
  CREATE INDEX IF NOT EXISTS idx_token_usage_principal ON token_usage(principal);
  CREATE INDEX IF NOT EXISTS idx_chat_threads_principal ON chat_threads(principal);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_principal ON chat_messages(principal);

  -- ─── ssi-wallet (canonical, was a separate process) ──────────────────
  CREATE TABLE IF NOT EXISTS holder_wallets (
    id TEXT PRIMARY KEY,
    person_principal TEXT NOT NULL,
    wallet_context TEXT NOT NULL,
    signer_eoa TEXT NOT NULL,
    askar_profile TEXT NOT NULL,
    link_secret_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    UNIQUE (person_principal, wallet_context)
  );
  CREATE INDEX IF NOT EXISTS idx_hw_principal ON holder_wallets(person_principal);
  CREATE INDEX IF NOT EXISTS idx_hw_signer_eoa ON holder_wallets(signer_eoa);

  CREATE TABLE IF NOT EXISTS action_nonces (
    nonce TEXT PRIMARY KEY,
    action_type TEXT NOT NULL,
    holder_wallet_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_nonce_wallet ON action_nonces(holder_wallet_id);

  CREATE TABLE IF NOT EXISTS credential_metadata (
    id TEXT PRIMARY KEY,
    holder_wallet_id TEXT NOT NULL,
    issuer_id TEXT NOT NULL,
    schema_id TEXT NOT NULL,
    cred_def_id TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    link_secret_id TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_cm_wallet ON credential_metadata(holder_wallet_id);

  -- Trust-overlap audit (renamed from ssi_proof_audit to avoid collision
  -- with the legacy presentation-audit table below).
  CREATE TABLE IF NOT EXISTS trust_overlap_audit (
    id TEXT PRIMARY KEY,
    holder_wallet_id TEXT NOT NULL,
    principal TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    block_pin TEXT NOT NULL DEFAULT '0',
    public_set_commit TEXT NOT NULL,
    evidence_commit TEXT NOT NULL,
    score REAL NOT NULL,
    shared_count INTEGER NOT NULL,
    output_kind TEXT NOT NULL DEFAULT 'score-only',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_to_audit_principal ON trust_overlap_audit(principal);
  CREATE INDEX IF NOT EXISTS idx_to_audit_wallet    ON trust_overlap_audit(holder_wallet_id);

  -- Presentation audit (one row per /proofs/present call). Legacy name
  -- predates the trust-overlap audit; keeping both lets ssi_create_presentation
  -- and ssi_match_against_public_set track distinct events.
  CREATE TABLE IF NOT EXISTS ssi_proof_audit (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    wallet_context TEXT NOT NULL,
    holder_wallet_ref TEXT NOT NULL,
    verifier_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    revealed_attrs TEXT NOT NULL,
    predicates TEXT NOT NULL,
    action_nonce TEXT NOT NULL,
    pairwise_handle TEXT,
    holder_binding_included INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ssi_audit_principal ON ssi_proof_audit(principal);
`)

/** Raw better-sqlite3 handle. Used by the absorbed ssi storage modules. */
export const sqlite: DatabaseType = sqliteHandle

/** Drizzle-typed wrapper. Used by person-mcp's profile/chat/account tools. */
export const db = drizzle(sqliteHandle, { schema })
