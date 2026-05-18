/**
 * Audit-deny helper for person-mcp's authority-bearing surfaces.
 *
 * Mirrors `apps/a2a-agent/src/lib/audit.ts::auditDeny()` but writes to
 * person-mcp's own `audit_log` table (the prevEntryHash-chained ledger
 * defined in `session-store/index.ts`). Used by:
 *
 *   - `requireInboundServiceAuth` middleware — every 401 reject path
 *     writes one `decision: 'denied'` row before returning.
 *   - `wallet-action-routes.ts` and `dispatch-routes.ts` — every
 *     `DelegatedActionDenied` catch site writes a denial row before
 *     returning 403 (Phase 1D parity).
 *
 * Append-only invariant matches a2a-agent: rows go in via
 * `appendAuditEntry()`, never updated or deleted. The hash chain stays
 * intact because every row (allow OR deny) extends prevEntryHash.
 *
 * Correlation ids: read from the `X-SA-Correlation-Id` header (Phase 1D
 * pattern). Stored in the `reason` field as a prefix when present so
 * we can cross-reference with a2a-agent's `executionAudit.correlationId`
 * without breaking the existing `audit_log` schema.
 */

import type { Context } from 'hono'
import { appendAuditEntry } from '../session-store/index.js'
import { randomUUID } from 'node:crypto'

export const CORRELATION_HEADER = 'x-sa-correlation-id'

export interface AuditDenyInput {
  /** Pretty route id (e.g. '/session-store/insert' or '/wallet-action/dispatch'). */
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
    console.error('[person-mcp auditDeny] failed:', err)
  }
}
