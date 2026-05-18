/**
 * Production-safe error response helper (Sprint 1 S1.8).
 *
 * The senior security review flagged several routes whose 4xx/5xx
 * responses leaked internal cryptographic / contract / upstream state
 * back to the caller (clientDataJSON slices, credentialDigests,
 * delegationHashes, raw `err.message` from contract calls that may
 * include calldata or upstream URLs). Those diagnostics are valuable
 * for operators tracing failed flows, but they MUST NOT be shipped to
 * unauthenticated callers in production — they hand an attacker a
 * partial oracle on internal account state.
 *
 * Policy:
 *
 *   - HTTP response in PRODUCTION:  generic operator-friendly error,
 *     no internal state. Just `{ error: <publicMessage> }`.
 *   - Server-side log:              always emitted, full structured
 *     diagnostics. Joins to the audit row via correlation id.
 *   - HTTP response in DEV (any
 *     `NODE_ENV !== 'production'`):  echoes the structured fields back
 *     as `_debug` for developer convenience. Never used in prod — the
 *     `_debug` key is unconditionally stripped when NODE_ENV ===
 *     'production'.
 *
 * Correlation id is read off `c.var.correlationId` (set by the
 * cross-service correlation-id middleware) so a single grep across
 * `a2a-agent.log` + `execution_audit` reconstructs the full request
 * trace from a user-visible error.
 *
 * Hashes (`accountAddressHash`, `delegationHash`, `credentialDigest`)
 * stay in logs because they're already pre-image-resistant identifiers
 * — they let an operator pivot to the right account/passkey row
 * without exposing the secret material itself.
 *
 * Raw `clientDataJSON` is NEVER logged. Although base64url/utf8 by
 * spec, the field is operator-controlled (the browser builds it) and
 * including it verbatim in our server logs would push attacker-chosen
 * bytes into log indexers — a low-grade log injection risk and a PII
 * leak surface (some authenticators embed origin / device hints).
 */

import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Mask: NODE_ENV exactly equal to 'production' enables the prod
 * response shape. Anything else (development, test, undefined) returns
 * the verbose dev shape so engineers see diagnostics locally and CI
 * tests can assert on them.
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export interface ErrorResponseOptions {
  /** Safe-for-HTTP error string. Returned to the caller in every env. */
  publicMessage: string
  /**
   * Internal log-line prefix. Pairs with `logFields` to give operators
   * a grep-able tag (e.g. `'[session/package] ERC-1271 rejected'`).
   */
  logMessage: string
  /**
   * Structured diagnostic fields. Always logged (server-side); echoed
   * back to the caller as `_debug` only when NODE_ENV !== 'production'.
   *
   * MUST NOT include raw secrets (private keys, decrypted bodies,
   * unbroken WebAuthn `clientDataJSON`). Hashes and short identifiers
   * are fine — they exist to let an operator pivot to the right row.
   */
  logFields: Record<string, unknown>
  /** HTTP status code on the response. */
  status: ContentfulStatusCode
}

/**
 * Build the structured error response and emit the matching
 * server-side log line.
 *
 * Caller pattern:
 *
 *   return errorResponse(c, {
 *     publicMessage: 'Delegation signature invalid',
 *     logMessage: '[session/package] ERC-1271 rejected',
 *     logFields: { sessionId, accountAddressHash, ... },
 *     status: 401,
 *   })
 */
export function errorResponse(c: Context, opts: ErrorResponseOptions): Response {
  // Pull the correlation id off the context (set by correlationId
  // middleware). Fall back to 'unknown' so a misconfigured route still
  // logs a row — better to log without correlation than to suppress.
  const correlationId =
    (c.get('correlationId' as never) as string | undefined) ?? 'unknown'

  // Always emit the structured log. `console.error` is what the rest
  // of the codebase uses for operator-visible failures.
  console.error(opts.logMessage, {
    correlationId,
    errorPublicMessage: opts.publicMessage,
    status: opts.status,
    ...opts.logFields,
  })

  // PRODUCTION: respond with only the safe surface.
  if (isProduction()) {
    return c.json({ error: opts.publicMessage }, opts.status)
  }

  // DEV/TEST: include the structured diagnostics so the developer can
  // see _why_ at the network tab without trawling stdout. `_debug` is
  // an intentional sentinel — code that reads it should also key off
  // `NODE_ENV !== 'production'` to make the dependency explicit.
  return c.json(
    {
      error: opts.publicMessage,
      _debug: {
        correlationId,
        ...opts.logFields,
      },
    },
    opts.status,
  )
}
