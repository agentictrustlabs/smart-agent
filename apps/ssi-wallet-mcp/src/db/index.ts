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
    person_principal TEXT NOT NULL,
    wallet_context TEXT NOT NULL,              -- 'default' | 'professional' | 'personal' | 'ai-delegate' | ...
    privy_eoa TEXT NOT NULL,
    askar_profile TEXT NOT NULL,
    link_secret_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',     -- active | rotating | revoked
    created_at TEXT NOT NULL,
    UNIQUE (person_principal, wallet_context)
  );
  CREATE INDEX IF NOT EXISTS idx_hw_principal ON holder_wallets(person_principal);
  CREATE INDEX IF NOT EXISTS idx_hw_privy_eoa ON holder_wallets(privy_eoa);

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
    link_secret_id TEXT NOT NULL DEFAULT ''    -- which link secret this cred is bound to (for rotation)
  );
  CREATE INDEX IF NOT EXISTS idx_cm_wallet ON credential_metadata(holder_wallet_id);
`)
export const db: DatabaseType = sqlite
