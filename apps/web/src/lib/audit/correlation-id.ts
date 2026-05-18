/**
 * Cross-service correlation id (Hardening Phase 1D #1).
 *
 * The web edge generates one correlation id per user-initiated request
 * and propagates it via the `X-SA-Correlation-Id` header through:
 *
 *   browser → next.js server action → a2aFetch → a2a-agent
 *   a2a-agent → MCP /tools/*
 *   a2a-agent → chain (recorded on the executionAudit row)
 *
 * `getCorrelationId()` reads the id from the current request's
 * `x-sa-correlation-id` header (set by the inbound middleware) or
 * generates a fresh one. `propagateCorrelationId(headers)` mutates a
 * `Headers`/plain-object map in place to add the header for outbound
 * fetches.
 *
 * IMPORTANT — the correlation id is NOT part of any signed canonical.
 * It rides outside the MAC envelope as observability metadata so it can
 * be regenerated/relayed without breaking wire compatibility. Don't use
 * it as authentication.
 */

import { randomUUID, randomBytes } from 'node:crypto'

export const CORRELATION_HEADER = 'x-sa-correlation-id'

/** Generate a fresh correlation id. Format: `sa-cor-<32 hex chars>`. */
export function newCorrelationId(): string {
  try {
    return `sa-cor-${randomBytes(16).toString('hex')}`
  } catch {
    // Edge runtime fallback — randomUUID is always available.
    return `sa-cor-${randomUUID().replace(/-/g, '')}`
  }
}

/**
 * Pull the correlation id from a Next.js request's headers if present,
 * else generate a fresh one. Safe to call from server components, route
 * handlers, and server actions.
 */
export function getCorrelationId(requestHeaders?: Headers | Record<string, string | undefined>): string {
  if (requestHeaders) {
    const existing =
      requestHeaders instanceof Headers
        ? requestHeaders.get(CORRELATION_HEADER) ?? requestHeaders.get('X-SA-Correlation-Id')
        : requestHeaders[CORRELATION_HEADER] ?? requestHeaders['X-SA-Correlation-Id']
    if (existing && existing.length > 0 && existing.length <= 128) {
      return existing
    }
  }
  return newCorrelationId()
}

/**
 * Add the correlation id to an outbound request's headers in place.
 * Accepts both `Headers` and plain `Record<string, string>` shapes so it
 * works with `fetch` init objects, undici, and Next.js shims.
 *
 * If `id` is omitted, a fresh id is generated.
 */
export function propagateCorrelationId(
  headers: Headers | Record<string, string>,
  id?: string,
): string {
  const correlationId = id ?? newCorrelationId()
  if (headers instanceof Headers) {
    headers.set(CORRELATION_HEADER, correlationId)
  } else {
    headers[CORRELATION_HEADER] = correlationId
  }
  return correlationId
}

/**
 * Build a Headers object pre-populated with the correlation header.
 * Convenience for callers that don't already hold a `headers` instance.
 */
export function withCorrelationHeader(
  extra?: Record<string, string>,
  id?: string,
): Record<string, string> {
  const out: Record<string, string> = { ...(extra ?? {}) }
  propagateCorrelationId(out, id)
  return out
}
