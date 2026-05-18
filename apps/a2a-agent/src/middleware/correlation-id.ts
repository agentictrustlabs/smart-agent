/**
 * Cross-service correlation-id middleware (Hardening Phase 1D #1).
 *
 * Every user-initiated action carries an `X-SA-Correlation-Id` header
 * that threads through web → a2a-agent → MCP → chain. This middleware
 * reads the header off the inbound request, exposes it via
 * `c.var.correlationId`, and echoes it back on the response so the
 * client can log/store the same id. If the header is absent (legacy
 * caller or test harness), a fresh UUID is generated.
 *
 * Audit rows written via `auditAppend` / `auditDeny` (see `lib/audit.ts`)
 * pull the id off the context and persist it on every row. The chain
 * receipt itself doesn't carry the id natively, but `executionAudit.txHash`
 * + `executionAudit.correlationId` give bidirectional lookup.
 *
 * IMPORTANT — the correlation id is intentionally NOT part of any signed
 * canonical message (HMAC envelope stays bound to `${ts}|${nonce}|${path}|
 * sha256(body)}` per K3-ext). It rides outside the MAC because it must
 * stay mutable as it crosses the trust boundary without breaking wire
 * compatibility. Treat it as observability metadata, not authentication.
 */

import { createMiddleware } from 'hono/factory'

export const CORRELATION_HEADER = 'x-sa-correlation-id'

declare module 'hono' {
  interface ContextVariableMap {
    correlationId?: string
  }
}

/**
 * Generate a fresh correlation id. Format mirrors web's helper so logs
 * across services share the same shape: `sa-cor-<32 hex chars>`.
 */
export function newCorrelationId(): string {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  let s = ''
  for (const b of buf) s += b.toString(16).padStart(2, '0')
  return `sa-cor-${s}`
}

/**
 * Hono middleware. MUST sit near the top of the stack (right after
 * `logger()` — before any route or downstream middleware that might
 * audit a denial).
 */
export const correlationId = createMiddleware(async (c, next) => {
  const incoming = c.req.header(CORRELATION_HEADER) ?? c.req.header('X-SA-Correlation-Id')
  const id = incoming && incoming.length > 0 && incoming.length <= 128 ? incoming : newCorrelationId()
  c.set('correlationId', id)
  // Echo the resolved id back so the caller can correlate the response
  // even if it generated a fresh one upstream.
  c.header(CORRELATION_HEADER, id)
  await next()
})
