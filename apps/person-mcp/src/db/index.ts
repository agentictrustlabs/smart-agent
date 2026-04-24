import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const DB_PATH = process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.db'

const sqlite = new Database(DB_PATH)

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL')

// Auto-create tables
sqlite.exec(`
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

  -- ─── SSI Wallet integration (context-scoped) ─────────────────────────
  CREATE TABLE IF NOT EXISTS ssi_holder_wallets (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    wallet_context TEXT NOT NULL,
    privy_eoa TEXT NOT NULL,
    holder_wallet_ref TEXT NOT NULL,       -- ssi-wallet-mcp's holder_wallet id
    link_secret_ref TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    UNIQUE (principal, wallet_context)
  );
  CREATE INDEX IF NOT EXISTS idx_ssi_hw_principal ON ssi_holder_wallets(principal);

  CREATE TABLE IF NOT EXISTS ssi_credential_metadata (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    wallet_context TEXT NOT NULL,
    holder_wallet_ref TEXT NOT NULL,
    issuer_id TEXT NOT NULL,
    schema_id TEXT NOT NULL,
    cred_def_id TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );
  CREATE INDEX IF NOT EXISTS idx_ssi_cred_principal ON ssi_credential_metadata(principal);
  CREATE INDEX IF NOT EXISTS idx_ssi_cred_context ON ssi_credential_metadata(principal, wallet_context);

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

export const db = drizzle(sqlite, { schema })
