/**
 * Replay-nonce cache for the a2a-agent → org-mcp inbound service-auth
 * envelope (Sprint 4 A.1 — mirrors person-mcp's W2.1 implementation).
 *
 * Every authenticated inbound request carries a fresh per-request nonce;
 * the verifier attempts to INSERT it into `inter_service_nonce` and
 * rejects on UNIQUE-constraint collision so a captured envelope can't
 * be replayed within the ±60s timestamp window.
 *
 * Cleanup is wired up in `apps/org-mcp/src/index.ts` at startup
 * (5-minute setInterval, .unref()). Rows older than 2×MAX_CLOCK_SKEW are
 * deleted so the table stays small under load.
 */

import { sqlite } from '../db/index.js'

// Initialize the table once at module load. Idempotent — `CREATE TABLE
// IF NOT EXISTS`. Kept colocated with the helper so the table can never
// be referenced before it exists.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS inter_service_nonce (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    nonce    TEXT NOT NULL UNIQUE,
    service  TEXT NOT NULL,
    used_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inter_service_nonce_used_at
    ON inter_service_nonce(used_at);
`)

/**
 * Try to record a nonce. Returns `true` if accepted (first sighting),
 * `false` if it was already burned (replay attempt) or invalid (too
 * short — defends against the silently-empty-default footgun).
 */
export function recordNonce(nonce: string, service: string): boolean {
  if (!nonce || nonce.length < 8) {
    return false
  }
  try {
    sqlite
      .prepare(
        `INSERT INTO inter_service_nonce (nonce, service, used_at) VALUES (?, ?, ?)`,
      )
      .run(nonce, service, new Date().toISOString())
    return true
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (/UNIQUE constraint/.test(msg) || /unique/i.test(msg)) {
      return false
    }
    // Any other DB error: fail closed (treat as replay) and surface
    // the error to the caller via the false return + a log line.
    console.error('[org-mcp replay-nonce] insert failed:', msg)
    return false
  }
}

/**
 * Delete nonces older than `maxAgeSeconds`. Called periodically from
 * `src/index.ts` startup. Returns the number of rows deleted.
 */
export function cleanupOldNonces(maxAgeSeconds: number): number {
  const cutoff = new Date(Date.now() - maxAgeSeconds * 1000).toISOString()
  const result = sqlite
    .prepare(`DELETE FROM inter_service_nonce WHERE used_at < ?`)
    .run(cutoff)
  return result.changes
}
