/**
 * Replay-nonce cache for inter-service HMAC envelopes.
 *
 * Hardening §1.10 — the existing ±60s timestamp window prevents *late*
 * replay but not within-window replay. Every signed envelope (whether
 * MCP→A2A `requireInterServiceAuth` or web→A2A `requireServiceAuth`)
 * MUST carry a fresh per-request nonce. The verifier attempts to INSERT
 * the nonce into `inter_service_nonce` and rejects on UNIQUE-constraint
 * collision.
 *
 * Cleanup: a periodic GC job (set up in `src/index.ts` startup) deletes
 * nonces older than 2 * MAX_CLOCK_SKEW_SECONDS so the table stays small.
 */

import { db } from '../db'
import { interServiceNonce } from '../db/schema'
import { sql } from 'drizzle-orm'

/**
 * Try to record a nonce. Returns `true` if accepted (first sighting),
 * `false` if it was already burned (replay attempt).
 */
export function recordNonce(nonce: string, service: string): boolean {
  if (!nonce || nonce.length < 8) {
    // Reject too-short nonces — they're not meaningfully unique and
    // would silently degrade replay protection.
    return false
  }
  try {
    db.insert(interServiceNonce)
      .values({ nonce, service, usedAt: new Date().toISOString() })
      .run()
    return true
  } catch (err) {
    // UNIQUE constraint violation on `nonce` → replay attempt.
    const msg = (err as Error).message ?? ''
    if (/UNIQUE constraint/.test(msg) || /unique/i.test(msg)) {
      return false
    }
    // Any other DB error: fail closed (treat as replay) and surface the
    // error to the caller via the false return + a log line.
    console.error('[replay-nonce] insert failed:', msg)
    return false
  }
}

/**
 * Delete nonces older than `maxAgeSeconds`. Called periodically from
 * `src/index.ts` startup. Returns the number of rows deleted (for
 * observability).
 */
export function cleanupOldNonces(maxAgeSeconds: number): number {
  const cutoff = new Date(Date.now() - maxAgeSeconds * 1000).toISOString()
  const result = db
    .delete(interServiceNonce)
    .where(sql`${interServiceNonce.usedAt} < ${cutoff}`)
    .run()
  return result.changes
}
