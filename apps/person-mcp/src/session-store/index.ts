/**
 * SessionRecord + revocation-epoch + nonce + audit storage for the
 * passkey-rooted delegated session signing system.
 *
 * Owner: person-mcp. Web app writes via /audit/append; person-mcp's
 * verifier reads SessionRecord directly.
 *
 * Tables (all on the existing person-mcp sqlite handle):
 *   sessions             — SessionRecord
 *   revocation_epochs    — per-account epoch counter
 *   action_nonces_v2     — per-action nonce uniqueness
 *   audit_log            — append-only with prevEntryHash chain
 */

import type {
  SessionGrantV1,
  SessionRecord,
  AuditLogEntry,
} from '@smart-agent/privacy-creds/session-grant'
import { sqlite } from '../db/index.js'
import { createHash } from 'node:crypto'

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id                 TEXT PRIMARY KEY,
    session_id_hash            TEXT NOT NULL UNIQUE,
    smart_account_address      TEXT NOT NULL,
    session_signer_address     TEXT NOT NULL,
    verified_passkey_pubkey_x  TEXT NOT NULL,
    verified_passkey_pubkey_y  TEXT NOT NULL,
    grant_json                 TEXT NOT NULL,
    grant_hash                 TEXT NOT NULL,
    idle_expires_at_ms         INTEGER NOT NULL,
    expires_at_ms              INTEGER NOT NULL,
    created_at_ms              INTEGER NOT NULL,
    revoked_at_ms              INTEGER,
    revocation_epoch           INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(smart_account_address);

  CREATE TABLE IF NOT EXISTS revocation_epochs (
    smart_account_address TEXT PRIMARY KEY,
    epoch                 INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS action_nonces_v2 (
    nonce_key       TEXT PRIMARY KEY,   -- accountAddr || ':' || actionNonce
    consumed_at_ms  INTEGER NOT NULL,
    expires_at_ms   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_action_nonces_v2_exp ON action_nonces_v2(expires_at_ms);

  CREATE TABLE IF NOT EXISTS audit_log (
    seq                    INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms                  INTEGER NOT NULL,
    smart_account_address  TEXT NOT NULL,
    session_id             TEXT NOT NULL,
    grant_hash             TEXT NOT NULL,
    action_id              TEXT NOT NULL,
    action_type            TEXT NOT NULL,
    action_hash            TEXT NOT NULL,
    decision               TEXT NOT NULL,
    reason                 TEXT,
    audience               TEXT,
    verifier               TEXT,
    prev_entry_hash        TEXT,
    entry_hash             TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log(smart_account_address, seq);

  -- Sprint 2 S2.1 — per-session action-counter state. Enforces
  -- grant.scope.maxActions (total) + grant.scope.maxActionsPerMinute
  -- (sliding 60-second window).
  --
  -- total_actions      monotonic count of successful verifies
  -- recent_timestamps  JSON array of action-accept timestamps (ms);
  --                    trimmed to last 60s on every update so the row
  --                    stays bounded.
  -- updated_at_ms      last write; informational, indexed for GC.
  CREATE TABLE IF NOT EXISTS session_action_count (
    session_id         TEXT PRIMARY KEY,
    total_actions      INTEGER NOT NULL DEFAULT 0,
    recent_timestamps  TEXT NOT NULL DEFAULT '[]',
    updated_at_ms      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_session_action_count_updated
    ON session_action_count(updated_at_ms);
`)

// ─── SessionRecord ──────────────────────────────────────────────────

export function insertSession(record: SessionRecord): void {
  sqlite.prepare(
    `INSERT INTO sessions (
       session_id, session_id_hash, smart_account_address,
       session_signer_address, verified_passkey_pubkey_x, verified_passkey_pubkey_y,
       grant_json, grant_hash, idle_expires_at_ms, expires_at_ms,
       created_at_ms, revocation_epoch
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.sessionId,
    record.sessionIdHash,
    record.smartAccountAddress.toLowerCase(),
    record.sessionSignerAddress.toLowerCase(),
    record.verifiedPasskeyPubkey.x,
    record.verifiedPasskeyPubkey.y,
    JSON.stringify(record.grant),
    record.grantHash,
    record.idleExpiresAt.getTime(),
    record.expiresAt.getTime(),
    record.createdAt.getTime(),
    record.revocationEpoch,
  )
}

export function getSessionByCookieValue(cookieValue: string): SessionRecord | null {
  const sessionIdHash = sha256Hex(cookieValue)
  const row = sqlite.prepare(
    `SELECT * FROM sessions WHERE session_id_hash = ?`,
  ).get(sessionIdHash) as Record<string, unknown> | undefined
  return row ? rowToSession(row) : null
}

export function getSessionById(sessionId: string): SessionRecord | null {
  const row = sqlite.prepare(
    `SELECT * FROM sessions WHERE session_id = ?`,
  ).get(sessionId) as Record<string, unknown> | undefined
  return row ? rowToSession(row) : null
}

export function listActiveSessionsForAccount(account: `0x${string}`): SessionRecord[] {
  const rows = sqlite.prepare(
    `SELECT * FROM sessions
       WHERE smart_account_address = ?
         AND (revoked_at_ms IS NULL)
         AND expires_at_ms > ?
       ORDER BY created_at_ms DESC`,
  ).all(account.toLowerCase(), Date.now()) as Record<string, unknown>[]
  return rows.map(rowToSession)
}

export function bumpIdleDeadline(sessionId: string, idleExpiresAt: Date): void {
  sqlite.prepare(
    `UPDATE sessions SET idle_expires_at_ms = ? WHERE session_id = ?`,
  ).run(idleExpiresAt.getTime(), sessionId)
}

export function revokeSession(sessionId: string): void {
  sqlite.prepare(
    `UPDATE sessions SET revoked_at_ms = ? WHERE session_id = ? AND revoked_at_ms IS NULL`,
  ).run(Date.now(), sessionId)
}

function rowToSession(row: Record<string, unknown>): SessionRecord {
  return {
    sessionId: row.session_id as string,
    sessionIdHash: row.session_id_hash as string,
    smartAccountAddress: row.smart_account_address as `0x${string}`,
    sessionSignerAddress: row.session_signer_address as `0x${string}`,
    verifiedPasskeyPubkey: {
      x: row.verified_passkey_pubkey_x as string,
      y: row.verified_passkey_pubkey_y as string,
    },
    grant: JSON.parse(row.grant_json as string) as SessionGrantV1,
    grantHash: row.grant_hash as string,
    idleExpiresAt: new Date(row.idle_expires_at_ms as number),
    expiresAt: new Date(row.expires_at_ms as number),
    createdAt: new Date(row.created_at_ms as number),
    revokedAt: row.revoked_at_ms ? new Date(row.revoked_at_ms as number) : null,
    revocationEpoch: row.revocation_epoch as number,
  }
}

// ─── Revocation epoch ───────────────────────────────────────────────

export function getRevocationEpoch(smartAccountAddress: `0x${string}`): number {
  const row = sqlite.prepare(
    `SELECT epoch FROM revocation_epochs WHERE smart_account_address = ?`,
  ).get(smartAccountAddress.toLowerCase()) as { epoch: number } | undefined
  return row?.epoch ?? 0
}

export function bumpRevocationEpoch(smartAccountAddress: `0x${string}`): number {
  // Atomic bump-or-init: tries to increment, falls back to INSERT.
  const lc = smartAccountAddress.toLowerCase()
  const upd = sqlite.prepare(
    `UPDATE revocation_epochs SET epoch = epoch + 1 WHERE smart_account_address = ?`,
  ).run(lc)
  if (upd.changes === 0) {
    sqlite.prepare(
      `INSERT INTO revocation_epochs (smart_account_address, epoch) VALUES (?, 1)`,
    ).run(lc)
    return 1
  }
  const row = sqlite.prepare(
    `SELECT epoch FROM revocation_epochs WHERE smart_account_address = ?`,
  ).get(lc) as { epoch: number }
  return row.epoch
}

// ─── Action-nonce uniqueness ────────────────────────────────────────

const NONCE_TTL_MS = 10 * 60 * 1000   // 10 minutes hot, then GC.

export function consumeActionNonce(
  smartAccountAddress: `0x${string}`,
  actionNonce: string,
): void {
  const key = `${smartAccountAddress.toLowerCase()}:${actionNonce}`
  const now = Date.now()
  try {
    sqlite.prepare(
      `INSERT INTO action_nonces_v2 (nonce_key, consumed_at_ms, expires_at_ms) VALUES (?, ?, ?)`,
    ).run(key, now, now + NONCE_TTL_MS)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (/UNIQUE constraint/.test(msg)) throw new Error('action nonce already consumed (replay rejected)')
    throw err
  }
  // Opportunistic GC.
  sqlite.prepare(`DELETE FROM action_nonces_v2 WHERE expires_at_ms < ?`).run(now)
}

// ─── Action counter (Sprint 2 S2.1) ─────────────────────────────────
//
// Enforces grant.scope.maxActions + grant.scope.maxActionsPerMinute. The
// counter row is created lazily on first consume; missing == count 0.
//
// `consumeAction` is the single sanctioned mutator: it runs SELECT +
// UPDATE inside a `better-sqlite3` synchronous transaction so the
// check-and-increment is atomic. Two concurrent verifies for the same
// session serialize on the sqlite write lock — the second sees the
// first's increment before deciding, closing the TOCTOU race.

const RECENT_WINDOW_MS = 60 * 1000

export interface ActionCounterDecision {
  /** Whether the increment succeeded (false = limit hit, no row update). */
  allowed: boolean
  /** Total actions consumed (after increment if allowed, else current). */
  totalActions: number
  /** Actions in the last 60s (after increment if allowed, else projected). */
  windowCount: number
  /** Limit that was tripped when allowed=false. */
  exceeded?: 'total' | 'rate'
  /** The cap that was tripped (the effective limit, after defaults). */
  cap?: number
}

export interface ConsumeActionInput {
  sessionId: string
  maxActions: number
  maxActionsPerMinute: number
  /** Wall clock at the moment of the decision (ms since epoch). */
  now: number
}

/**
 * Atomically check-and-increment the action counter for a session.
 *
 * Behavior:
 *   - Row is created on demand (count=0, empty window).
 *   - Reads recent_timestamps, drops anything older than now-60s.
 *   - If incrementing would exceed either cap, the transaction is a no-op
 *     and `allowed: false` is returned with the offending counter.
 *   - Otherwise total_actions += 1 and current timestamp is appended.
 *
 * Caller-supplied caps win when present; defense-in-depth defaults live
 * in `apps/person-mcp/src/config.ts` and are passed in by the verifier.
 */
export function consumeAction(input: ConsumeActionInput): ActionCounterDecision {
  const tx = sqlite.transaction((args: ConsumeActionInput): ActionCounterDecision => {
    const row = sqlite.prepare(
      `SELECT total_actions, recent_timestamps FROM session_action_count WHERE session_id = ?`,
    ).get(args.sessionId) as { total_actions: number; recent_timestamps: string } | undefined

    const total = row?.total_actions ?? 0
    let recent: number[] = []
    if (row?.recent_timestamps) {
      try {
        const parsed = JSON.parse(row.recent_timestamps) as unknown
        if (Array.isArray(parsed)) {
          recent = parsed.filter((v): v is number => typeof v === 'number')
        }
      } catch { /* corrupt JSON → treat as empty */ }
    }
    // Trim to the live window before any decision.
    const cutoff = args.now - RECENT_WINDOW_MS
    recent = recent.filter(ts => ts > cutoff)

    const nextTotal = total + 1
    const nextWindow = recent.length + 1

    if (nextTotal > args.maxActions) {
      return {
        allowed: false,
        totalActions: total,
        windowCount: recent.length,
        exceeded: 'total',
        cap: args.maxActions,
      }
    }
    if (nextWindow > args.maxActionsPerMinute) {
      return {
        allowed: false,
        totalActions: total,
        windowCount: recent.length,
        exceeded: 'rate',
        cap: args.maxActionsPerMinute,
      }
    }

    recent.push(args.now)
    const recentJson = JSON.stringify(recent)
    if (row === undefined) {
      sqlite.prepare(
        `INSERT INTO session_action_count
           (session_id, total_actions, recent_timestamps, updated_at_ms)
         VALUES (?, ?, ?, ?)`,
      ).run(args.sessionId, nextTotal, recentJson, args.now)
    } else {
      sqlite.prepare(
        `UPDATE session_action_count
            SET total_actions = ?, recent_timestamps = ?, updated_at_ms = ?
          WHERE session_id = ?`,
      ).run(nextTotal, recentJson, args.now, args.sessionId)
    }

    return {
      allowed: true,
      totalActions: nextTotal,
      windowCount: nextWindow,
    }
  })

  return tx(input)
}

/** Inspector for tests + diagnostics. Read-only; does not increment. */
export function getActionCounter(sessionId: string, now: number = Date.now()): {
  totalActions: number
  windowCount: number
} {
  const row = sqlite.prepare(
    `SELECT total_actions, recent_timestamps FROM session_action_count WHERE session_id = ?`,
  ).get(sessionId) as { total_actions: number; recent_timestamps: string } | undefined
  if (!row) return { totalActions: 0, windowCount: 0 }
  let recent: number[] = []
  try {
    const parsed = JSON.parse(row.recent_timestamps) as unknown
    if (Array.isArray(parsed)) {
      recent = parsed.filter((v): v is number => typeof v === 'number')
    }
  } catch { /* ignore */ }
  const cutoff = now - RECENT_WINDOW_MS
  recent = recent.filter(ts => ts > cutoff)
  return { totalActions: row.total_actions, windowCount: recent.length }
}

// ─── Audit log (append-only with prevEntryHash chain) ───────────────

export function appendAuditEntry(input: Omit<AuditLogEntry, 'prevEntryHash' | 'entryHash'>): AuditLogEntry {
  const last = sqlite.prepare(
    `SELECT entry_hash FROM audit_log
       WHERE smart_account_address = ?
       ORDER BY seq DESC LIMIT 1`,
  ).get(input.smartAccountAddress.toLowerCase()) as { entry_hash: string } | undefined

  const prevEntryHash = last?.entry_hash ?? null
  const entryHash = computeEntryHash({ ...input, prevEntryHash })

  sqlite.prepare(
    `INSERT INTO audit_log (
       ts_ms, smart_account_address, session_id, grant_hash,
       action_id, action_type, action_hash,
       decision, reason, audience, verifier,
       prev_entry_hash, entry_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.ts.getTime(),
    input.smartAccountAddress.toLowerCase(),
    input.sessionId,
    input.grantHash,
    input.actionId,
    input.actionType,
    input.actionHash,
    input.decision,
    input.reason ?? null,
    input.audience ?? null,
    input.verifier ?? null,
    prevEntryHash,
    entryHash,
  )

  return { ...input, prevEntryHash, entryHash }
}

export function listAuditLogForAccount(
  smartAccountAddress: `0x${string}`,
  limit = 100,
): AuditLogEntry[] {
  const rows = sqlite.prepare(
    `SELECT * FROM audit_log
       WHERE smart_account_address = ?
       ORDER BY seq DESC LIMIT ?`,
  ).all(smartAccountAddress.toLowerCase(), limit) as Record<string, unknown>[]
  return rows.map(r => ({
    ts: new Date(r.ts_ms as number),
    smartAccountAddress: r.smart_account_address as `0x${string}`,
    sessionId: r.session_id as string,
    grantHash: r.grant_hash as string,
    actionId: r.action_id as string,
    actionType: r.action_type as string,
    actionHash: r.action_hash as string,
    decision: r.decision as AuditLogEntry['decision'],
    reason: (r.reason as string | null) ?? undefined,
    audience: (r.audience as string | null) ?? undefined,
    verifier: (r.verifier as string | null) ?? undefined,
    prevEntryHash: r.prev_entry_hash as string | null,
    entryHash: r.entry_hash as string,
  }))
}

function computeEntryHash(e: Omit<AuditLogEntry, 'entryHash'>): string {
  const h = createHash('sha256')
  h.update(String(e.ts.getTime())); h.update('|')
  h.update(e.smartAccountAddress.toLowerCase()); h.update('|')
  h.update(e.sessionId); h.update('|')
  h.update(e.grantHash); h.update('|')
  h.update(e.actionId); h.update('|')
  h.update(e.actionType); h.update('|')
  h.update(e.actionHash); h.update('|')
  h.update(e.decision); h.update('|')
  h.update(e.reason ?? ''); h.update('|')
  h.update(e.audience ?? ''); h.update('|')
  h.update(e.verifier ?? ''); h.update('|')
  h.update(e.prevEntryHash ?? '')
  return h.digest('hex')
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}
