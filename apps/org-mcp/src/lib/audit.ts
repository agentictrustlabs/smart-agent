/**
 * Audit log + audit-deny helper for org-mcp's authority-bearing surfaces
 * (Sprint 4 A.1 — mirrors `apps/person-mcp/src/lib/audit.ts`).
 *
 * Org-mcp had no append-only audit table prior to A.1. This module
 * creates one — `audit_log`, schema-aligned with person-mcp's — and
 * provides the `appendAuditEntry` + `auditDeny` helpers that the
 * inbound-service-auth middleware and the cross-delegation verifier
 * write to on every denial.
 *
 * Append-only invariant: rows go in via `appendAuditEntry()`, never
 * updated or deleted. The hash chain (`prev_entry_hash` → `entry_hash`)
 * stays intact because every row (allow OR deny) extends the previous
 * entry hash per smart-account.
 *
 * Correlation ids: read from the `X-SA-Correlation-Id` header.
 * Stored in the `reason` field as a suffix so we can cross-reference
 * with a2a-agent's `executionAudit.correlationId` without breaking
 * the schema.
 */

import type { Context } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { sqlite } from '../db/index.js'

// Idempotent table create — kept colocated so the helpers never
// reference a table that doesn't exist yet. Schema matches person-mcp's
// audit_log (apps/person-mcp/src/session-store/index.ts), so audit
// tooling that already understands the person-mcp shape works here too.
sqlite.exec(`
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
`)

// Defensive `ALTER TABLE ... ADD COLUMN` for environments that had a
// pre-A.1 partial schema. Each statement is wrapped so re-runs don't
// fail on "duplicate column".
function addColumnIfMissing(table: string, column: string, type: string): void {
  try {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!cols.some(c => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    }
  } catch (err) {
    console.error(`[org-mcp audit] failed to ensure ${table}.${column}:`, err)
  }
}
addColumnIfMissing('audit_log', 'prev_entry_hash', 'TEXT')
addColumnIfMissing('audit_log', 'entry_hash', "TEXT NOT NULL DEFAULT ''")

export const CORRELATION_HEADER = 'x-sa-correlation-id'

export interface AuditEntryInput {
  ts: Date
  smartAccountAddress: `0x${string}`
  sessionId: string
  grantHash: string
  actionId: string
  actionType: string
  actionHash: string
  decision: 'allowed' | 'denied' | 'high-risk-passthrough' | 'session_revoked' | 'grant_minted'
  reason?: string
  audience?: string
  verifier?: string
}

export interface AuditEntry extends AuditEntryInput {
  prevEntryHash: string | null
  entryHash: string
}

/**
 * Append an audit row to the chain. Computes `prev_entry_hash` by
 * looking up the most recent entry for the same smart-account, then
 * computes `entry_hash` by hashing the row plus the prev hash.
 */
export function appendAuditEntry(input: AuditEntryInput): AuditEntry {
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

function computeEntryHash(e: AuditEntryInput & { prevEntryHash: string | null }): string {
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

export interface AuditDenyInput {
  /** Pretty route id (e.g. '/tools/list_proposals'). */
  route: string
  /** Short reason string for diagnostics. */
  reason: string
  /** Optional service caller name (e.g. 'a2a-agent', 'unknown'). */
  mcpServer?: string
  /** Optional smart-account when known. */
  smartAccountAddress?: `0x${string}`
  /** Optional session id when known. */
  sessionId?: string
  /** Optional grant hash when known. */
  grantHash?: string
  /** Optional action id/type from the original request when known. */
  actionId?: string
  actionType?: string
  actionHash?: string
}

/**
 * Read the correlation id from the inbound request, falling back to ''.
 */
export function readCorrelationId(c: Context): string {
  const incoming = c.req.header(CORRELATION_HEADER) ?? c.req.header('X-SA-Correlation-Id')
  return incoming && incoming.length > 0 && incoming.length <= 128 ? incoming : ''
}

/**
 * Convenience wrapper for middleware / route denial paths. Builds a
 * denial audit entry from the request context and writes it. Never
 * throws — audit best-effort so a failing audit cannot mask the
 * authority decision.
 */
export function auditDeny(c: Context, info: AuditDenyInput): void {
  try {
    const correlationId = readCorrelationId(c)
    // Pack mcpServer + correlationId into the reason string so we
    // preserve cross-service traceability without expanding the
    // audit_log schema.
    const prefix = info.mcpServer ? `[${info.mcpServer}]` : '[unknown]'
    const corSuffix = correlationId ? ` cor=${correlationId}` : ''
    const reason = `${prefix} ${info.reason}${corSuffix}`.slice(0, 1000)

    // Placeholder fields default to the empty/zero values when unknown
    // — auth-denial rows often arrive before we can resolve a session.
    appendAuditEntry({
      ts: new Date(),
      smartAccountAddress: (info.smartAccountAddress ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      sessionId: info.sessionId ?? '',
      grantHash: info.grantHash ?? '',
      actionId: info.actionId ?? `auth-deny-${randomUUID()}`,
      actionType: info.actionType ?? `route:${info.route}`,
      actionHash: info.actionHash ?? '',
      decision: 'denied',
      reason,
      audience: undefined,
      verifier: undefined,
    })
  } catch (err) {
    // Best-effort: a failed audit write must not block the deny path.
    console.error('[org-mcp auditDeny] failed:', err)
  }
}
