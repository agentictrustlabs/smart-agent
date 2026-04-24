/**
 * Consumed-nonce tracking — closes race-replay windows against the
 * family-mcp verifier. Any presentation_request nonce can only be redeemed
 * once; a second submission with the same nonce is rejected as a replay.
 *
 * Request nonces TTL to 10 min; rows tombstone after that.
 */

import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

const DB_PATH = process.env.FAMILY_NONCE_DB_PATH ?? './family-nonces.db'
mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS consumed_nonces (
    nonce       TEXT PRIMARY KEY,
    request_id  TEXT,
    consumed_at INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_nonce_exp ON consumed_nonces(expires_at);
`)

const TTL_SEC = 600 // 10 min

/** Atomic consume. Throws on replay. */
export function consumeNonce(nonce: string, requestId?: string): void {
  if (!nonce) throw new Error('missing nonce')
  const now = Math.floor(Date.now() / 1000)
  try {
    db.prepare(
      `INSERT INTO consumed_nonces (nonce, request_id, consumed_at, expires_at) VALUES (?, ?, ?, ?)`,
    ).run(nonce, requestId ?? null, now, now + TTL_SEC)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (/UNIQUE constraint/.test(msg)) throw new Error('nonce already consumed (replay rejected)')
    throw err
  }
  // Opportunistic GC — cheap.
  db.prepare(`DELETE FROM consumed_nonces WHERE expires_at < ?`).run(now)
}
