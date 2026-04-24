import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { config } from '../config.js'

/**
 * ssi-wallet-mcp's SQLite holds ONLY operational state (not credential data
 * or secrets — those live in Askar).
 *
 *   - holder_wallets: lookup from personPrincipal → askar profile name + linkSecretId
 *   - action_nonces:  replay-prevention for Privy-signed WalletActions
 */
const sqlite = new Database(config.dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS holder_wallets (
    id TEXT PRIMARY KEY,
    person_principal TEXT NOT NULL UNIQUE,
    privy_eoa TEXT NOT NULL,                -- user's Privy EOA (lowercase)
    askar_profile TEXT NOT NULL,             -- profile name in Askar store
    link_secret_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',   -- active | rotating | revoked
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_hw_privy_eoa ON holder_wallets(privy_eoa);

  CREATE TABLE IF NOT EXISTS action_nonces (
    nonce TEXT PRIMARY KEY,
    action_type TEXT NOT NULL,
    holder_wallet_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_nonce_wallet ON action_nonces(holder_wallet_id);

  -- Phase 1: store credential-metadata index here too. In the target design
  -- this lives in person-mcp; for Phase 1 we carry it locally so the mock
  -- harness can drive end-to-end without a new person-mcp migration yet.
  CREATE TABLE IF NOT EXISTS credential_metadata (
    id TEXT PRIMARY KEY,
    holder_wallet_id TEXT NOT NULL,
    issuer_id TEXT NOT NULL,
    schema_id TEXT NOT NULL,
    cred_def_id TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );
  CREATE INDEX IF NOT EXISTS idx_cm_wallet ON credential_metadata(holder_wallet_id);
`)
export const db: DatabaseType = sqlite
