/**
 * Production-safe error response helper for Next.js routes
 * (Sprint 1 S1.8).
 *
 * Web-app twin of `apps/a2a-agent/src/lib/error-response.ts`. Same
 * policy, different framework: Next.js `NextResponse.json` rather
 * than Hono's `c.json`.
 *
 * Policy:
 *
 *   - HTTP response in PRODUCTION:  generic, no internal state.
 *   - Server-side log:              always emitted, full diagnostics.
 *   - HTTP response in DEV (any
 *     `NODE_ENV !== 'production'`):  echoes structured fields back
 *     as `_debug` for developer convenience.
 *
 * The senior security review flagged several Next.js routes whose
 * 4xx responses inlined `(err as Error).message` from a contract
 * call or upstream HTTP — that message may contain calldata, an RPC
 * URL, or an upstream schema error that an attacker should not see.
 *
 * Correlation id is pulled from the `X-SA-Correlation-Id` header
 * when present, otherwise from a generated id, so the log line can
 * be joined with a2a-agent logs and the `execution_audit` table.
 */

import { NextResponse } from 'next/server'

/**
 * Generate a fresh correlation id when the inbound request didn't
 * carry one. Format mirrors the a2a-agent helper.
 */
function freshCorrelationId(): string {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  let s = ''
  for (const b of buf) s += b.toString(16).padStart(2, '0')
  return `sa-cor-${s}`
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export interface WebErrorResponseOptions {
  /** Safe-for-HTTP error string. Returned in every env. */
  publicMessage: string
  /** Log-line prefix. */
  logMessage: string
  /**
   * Structured diagnostics. Always logged; echoed back as `_debug`
   * only when NODE_ENV !== 'production'.
   */
  logFields: Record<string, unknown>
  /** HTTP status. */
  status: number
  /**
   * Optional inbound request — used to extract `X-SA-Correlation-Id`
   * so a single grep joins web log to a2a log to audit row.
   */
  request?: Request
}

/**
 * Build the structured response and emit the matching log line.
 */
export function webErrorResponse(opts: WebErrorResponseOptions): NextResponse {
  const incoming = opts.request?.headers.get('x-sa-correlation-id') ?? undefined
  const correlationId =
    incoming && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : freshCorrelationId()

  console.error(opts.logMessage, {
    correlationId,
    errorPublicMessage: opts.publicMessage,
    status: opts.status,
    ...opts.logFields,
  })

  if (isProduction()) {
    return NextResponse.json({ error: opts.publicMessage }, { status: opts.status })
  }

  return NextResponse.json(
    {
      error: opts.publicMessage,
      _debug: {
        correlationId,
        ...opts.logFields,
      },
    },
    { status: opts.status },
  )
}
