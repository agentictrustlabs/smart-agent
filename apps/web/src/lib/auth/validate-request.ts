/**
 * Request body size + shape validator (Sprint 3 S3.4).
 *
 * Every state-changing `/api/*` route must:
 *   1. Cap the request body at a known maximum (defaults to 64 KiB).
 *   2. Validate the parsed JSON against a Zod schema.
 *   3. Return a clean, generic 4xx — never leak Zod issue paths,
 *      schema names, or upstream contract revert text (S1.8 invariant).
 *
 * This module is the single chokepoint for all three concerns so route
 * handlers stay short and reviewable. A route guard is:
 *
 *   const denied = requireOriginAllowed(request)
 *   if (denied) return denied
 *   const parsed = await validateRequest(request, { schema: MySchema })
 *   if (!parsed.ok) return parsed.response
 *   const body = parsed.data
 *
 * Why size limits matter
 * ----------------------
 * Next.js's default request body cap (1 MiB for API routes) is too
 * permissive for routes that only accept a handful of fields. A
 * malicious caller can flood the JSON parser with megabytes of
 * deeply-nested junk and burn CPU before the handler ever sees the
 * payload. Cap at the smallest size that fits the legitimate shape,
 * and reject with 413 BEFORE parsing.
 *
 * The defaults below cover every route in `apps/web/src/app/api/**`:
 *
 *   DEFAULT_BODY_LIMIT_BYTES (64 KiB) — every "normal" JSON form.
 *   DELEGATION_BODY_LIMIT_BYTES (1 MiB) — routes that carry an
 *     `SessionGrant` envelope, a WebAuthn assertion, or a delegation
 *     packet with caveat blobs (`/api/auth/session-grant/finalize`,
 *     `/api/a2a/bootstrap/complete`).
 *
 * Why the 400 response is generic
 * -------------------------------
 * Zod's `.safeParse()` returns issue objects with full schema paths
 * and human-readable messages. Echoing them back to the caller leaks
 * the route's data shape and any internal field names — exactly the
 * sort of detail S1.8 (`webErrorResponse`) was built to suppress.
 * Instead we always return `{ error: 'Invalid request body' }` with
 * status 400 and log the Zod issues server-side.
 *
 * Why 413 distinct from 400
 * -------------------------
 * RFC 9110 §15.5.14 — "Content Too Large". Clients (and load
 * balancers) treat the two cases differently. A 413 also signals to
 * an attacker that we never parsed the payload, so probing for size
 * limits doesn't return any signal about the JSON shape.
 */

import { NextResponse } from 'next/server'
import type { ZodSchema, ZodIssue } from 'zod'

/** Default request body cap (64 KiB) — applies when a route doesn't override it. */
export const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024

/**
 * Larger cap for routes that carry a SessionGrant envelope, a WebAuthn
 * assertion, or a delegation packet with caveat blobs. Still bounded —
 * 1 MiB is enough for ~20 caveats and a 4 KiB WebAuthn signature.
 */
export const DELEGATION_BODY_LIMIT_BYTES = 1024 * 1024

/** Options for `validateRequest`. */
export interface ValidateOptions<T> {
  /** Zod schema the body must conform to. */
  schema: ZodSchema<T>
  /** Maximum body size in bytes. Defaults to `DEFAULT_BODY_LIMIT_BYTES`. */
  maxBytes?: number
}

/**
 * Successful parse — the body matched the schema and was within the
 * size cap.
 */
export interface ValidateOk<T> {
  ok: true
  data: T
}

/**
 * Rejection — the body exceeded the cap, was not valid JSON, or did
 * not match the schema. The pre-built `NextResponse` is the response
 * the route handler should return immediately.
 */
export interface ValidateErr {
  ok: false
  response: NextResponse
}

export type ValidateResult<T> = ValidateOk<T> | ValidateErr

// ─── helpers ───────────────────────────────────────────────────────────

/**
 * Build a 413 response. We log the over-the-wire content-length (when
 * the client supplied one) so operators can see whether a route is
 * being probed with deliberately oversized payloads. We do NOT log
 * the payload body — by definition we never read past `maxBytes`.
 */
function bodyTooLarge(declaredBytes: number | null, maxBytes: number): NextResponse {
  console.warn('[validate-request] body too large', {
    declaredBytes,
    maxBytes,
  })
  return NextResponse.json(
    { error: 'Request body too large' },
    { status: 413 },
  )
}

/**
 * Build the generic 400 for malformed JSON. Distinct error code from
 * the schema-rejection 400 so server logs can tell the two apart,
 * but the HTTP body is identical (no shape leak).
 */
function invalidJson(): NextResponse {
  return NextResponse.json(
    { error: 'Invalid request body' },
    { status: 400 },
  )
}

/**
 * Build the generic 400 for schema rejection. The Zod issues are
 * logged server-side but never returned — that's the S1.8 invariant.
 */
function invalidShape(issues: readonly ZodIssue[]): NextResponse {
  console.warn('[validate-request] schema rejection', {
    issueCount: issues.length,
    // Path + code only — value strings could include secrets the caller sent.
    issues: issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
  })
  return NextResponse.json(
    { error: 'Invalid request body' },
    { status: 400 },
  )
}

/**
 * Read the request body as a string, refusing to allocate more than
 * `maxBytes` no matter what `Content-Length` advertised. Streams
 * through the underlying ReadableStream and short-circuits as soon as
 * the running total exceeds the cap, so a malicious caller cannot
 * lie in the Content-Length header to slip a large body past us.
 *
 * Returns `null` when the body would exceed the cap; otherwise the
 * decoded UTF-8 string.
 */
async function readBodyCapped(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    // Sequential read — Web Streams reader has at most one outstanding
    // read per consumer. The cap check runs after every chunk so we
    // stop pulling bytes off the wire as soon as we know the body is
    // too large.
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        // Best-effort cancel — releases the underlying stream so the
        // server isn't stuck pulling bytes for a request we're about
        // to reject.
        try { await reader.cancel() } catch { /* ignore */ }
        return null
      }
      chunks.push(value)
    }
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }
  // Concat and decode once at the end — avoids repeated TextDecoder calls.
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

// ─── public API ────────────────────────────────────────────────────────

/**
 * Enforce body-size + schema validation on a state-changing route.
 *
 * Flow:
 *   1. If the `Content-Length` header advertises a size larger than
 *      `maxBytes`, reject immediately with 413. This is an
 *      optimisation — a well-behaved client won't ship the bytes if
 *      the server has already refused them.
 *   2. Read the body, refusing to buffer more than `maxBytes`. If the
 *      body exceeds the cap (regardless of what Content-Length said),
 *      reject with 413.
 *   3. Parse as JSON; on `SyntaxError`, reject with 400.
 *   4. Run the Zod schema; on failure, reject with 400.
 *   5. Otherwise return the parsed-and-typed data.
 *
 * The returned response body never carries Zod issue details — only
 * a generic `{ error: 'Invalid request body' }`. Server logs carry
 * the issue paths + codes for debugging.
 */
export async function validateRequest<T>(
  request: Request,
  opts: ValidateOptions<T>,
): Promise<ValidateResult<T>> {
  const maxBytes = opts.maxBytes ?? DEFAULT_BODY_LIMIT_BYTES

  // 1. Pre-flight: trust the advertised content-length as a fast reject.
  //    Untrusted (the streaming reader below is the source of truth) but
  //    avoids buffering bytes a misbehaved client streams at us.
  const declared = request.headers.get('content-length')
  let declaredBytes: number | null = null
  if (declared !== null) {
    const n = Number.parseInt(declared, 10)
    if (Number.isFinite(n) && n >= 0) {
      declaredBytes = n
      if (n > maxBytes) {
        return { ok: false, response: bodyTooLarge(declaredBytes, maxBytes) }
      }
    }
  }

  // 2. Read with a hard cap on bytes actually consumed.
  let raw: string | null
  try {
    raw = await readBodyCapped(request, maxBytes)
  } catch (err) {
    // Stream error (e.g. client disconnect) — treat as invalid body.
    console.warn('[validate-request] read failed', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, response: invalidJson() }
  }
  if (raw === null) {
    return { ok: false, response: bodyTooLarge(declaredBytes, maxBytes) }
  }

  // Empty body counts as `{}` for routes that only have optional fields.
  // Routes that require a field will fail the schema check, which is the
  // correct behaviour.
  const text = raw.length === 0 ? '{}' : raw

  // 3. JSON parse.
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, response: invalidJson() }
  }

  // 4. Schema check.
  const result = opts.schema.safeParse(parsed)
  if (!result.success) {
    return { ok: false, response: invalidShape(result.error.issues) }
  }

  // 5. Done.
  return { ok: true, data: result.data }
}
