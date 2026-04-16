import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const sqlite = new Database('local.db')

// Enable WAL mode for better concurrent access
sqlite.pragma('journal_mode = WAL')

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
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS handles (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    account_address TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    endpoint_url TEXT,
    created_at TEXT NOT NULL
  );
`)

export const db = drizzle(sqlite, { schema })
