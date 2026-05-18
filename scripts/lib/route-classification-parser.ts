/**
 * Route classification parser (Sprint 2 S2.7).
 *
 * Parses `@sa-*` JSDoc tags off Next.js `app/api/**` route handlers.
 *
 * Why this exists
 * ---------------
 * The Next.js middleware in `apps/web/src/middleware.ts` explicitly passes
 * every `/api/*` path through unauthenticated — each route is expected to
 * mint or check its own auth. That means route auth coverage is
 * per-handler, and there is no single chokepoint a reviewer can read to
 * answer "which of these need a session, which are dev-only, which are
 * unauthenticated by design?".
 *
 * This parser pairs with `scripts/check-route-classification.ts` (lint)
 * and `scripts/generate-route-inventory.ts` (doc generator) to make the
 * answer to that question executable. Every API route MUST carry a
 * JSDoc block with the tags below — missing or malformed blocks fail
 * CI; the generator emits a markdown table grouped by classification.
 *
 * Tag set (source of truth: `output/tester-guardrails-framework.md` §
 * "Route Classification Comment Specification"):
 *
 *   @sa-route        public | web-auth | service-only | admin-only |
 *                    dev-only | bootstrap                          REQUIRED
 *   @sa-auth         none | session-cookie | grant-cookie |
 *                    service-hmac | kms-token | none-with-csrf     REQUIRED
 *   @sa-rate-limit   <N>/<window>   e.g. "10/min" or "60/min"      optional
 *   @sa-audit-event  <event-name>                                  optional
 *   @sa-risk-tier    low | medium | high | sensitive               optional
 *   @sa-owner        <team-or-person>                              optional
 *   @sa-prod-gate    <function-name>                  REQUIRED when @sa-route=dev-only
 *   @sa-validation   zod | none-no-body | none-path-params       REQUIRED for POST/PUT/PATCH/DELETE
 *                                                  (Sprint 3 S3.4)
 *
 * Implementation note: we use a JSDoc-tolerant regex rather than `ts-morph`.
 * The spec says "AST walk with `ts-morph` or a JSDoc-tolerant regex"; the
 * regex path keeps the script zero-install (no transitive dep we don't
 * already ship) and runs in <1s across the whole `app/api` tree.
 */

import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Methods Next.js route handlers may export. */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/** Allowed values for `@sa-route`. */
export const ROUTE_KINDS = [
  'public',
  'web-auth',
  'service-only',
  'admin-only',
  'dev-only',
  'bootstrap',
] as const
export type RouteKind = (typeof ROUTE_KINDS)[number]

/** Allowed values for `@sa-auth`. */
export const AUTH_KINDS = [
  'none',
  'session-cookie',
  'grant-cookie',
  'service-hmac',
  'kms-token',
  'none-with-csrf',
] as const
export type AuthKind = (typeof AUTH_KINDS)[number]

/** Allowed values for `@sa-risk-tier`. */
export const RISK_TIERS = ['low', 'medium', 'high', 'sensitive'] as const
export type RiskTier = (typeof RISK_TIERS)[number]

/**
 * Allowed values for `@sa-validation` (Sprint 3 S3.4). Required for any
 * handler that mutates state (POST/PUT/PATCH/DELETE):
 *
 *   - `zod`              — handler imports `validateRequest` from
 *                          `@/lib/auth/validate-request` and runs a Zod
 *                          schema against the JSON body. This is the
 *                          default; anything else needs justification.
 *   - `none-no-body`     — handler reads no body (e.g. `/logout`,
 *                          `/revoke`). The empty-body case still goes
 *                          through size capping via the helper if the
 *                          author wants it, but doesn't need a schema.
 *   - `none-path-params` — handler only reads URL path / query params
 *                          (no body parse at all).
 */
export const VALIDATION_KINDS = ['zod', 'none-no-body', 'none-path-params'] as const
export type ValidationKind = (typeof VALIDATION_KINDS)[number]

/** HTTP methods that MUST declare `@sa-validation` (Sprint 3 S3.4). */
export const STATE_CHANGING_METHODS = new Set<HttpMethod>([
  'POST', 'PUT', 'PATCH', 'DELETE',
])

/** Structured form of a route's `@sa-*` tags. */
export interface RouteTags {
  route: RouteKind
  auth: AuthKind
  rateLimit?: string
  auditEvent?: string
  riskTier?: RiskTier
  owner?: string
  prodGate?: string
  /** Sprint 3 S3.4 — only present once a handler is annotated. */
  validation?: ValidationKind
}

/** Per-handler parse result. */
export interface RouteHandlerRecord {
  /** Repo-relative path, e.g. `apps/web/src/app/api/foo/route.ts`. */
  filePath: string
  /** HTTP method this handler exports. */
  method: HttpMethod
  /** Tags parsed off the route- or handler-level JSDoc. */
  tags: RouteTags
  /** Public URL path derived from the file path (e.g. `/api/auth/session`). */
  apiPath: string
}

/** Either a record (ok) or a list of error strings. */
export type ParseResult =
  | { ok: true; record: RouteHandlerRecord }
  | { ok: false; filePath: string; method: HttpMethod | null; errors: string[] }

// ─── tag parsing ────────────────────────────────────────────────────────

/** Extract every `@sa-foo bar` style tag from a single JSDoc block body. */
function parseTagBlock(blockBody: string): Map<string, string> {
  const out = new Map<string, string>()
  // Match: `@sa-<key> <value>`, value runs to end of line / next @-tag.
  // Strip the leading ` * ` JSDoc gutter from each line before scanning.
  const cleaned = blockBody
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, ''))
    .join('\n')
  const re = /@sa-([a-z-]+)\s+([^\n@]+?)(?=\s*(?:@sa-|$))/gms
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const key = m[1].trim()
    const value = m[2].trim()
    if (key && value) out.set(key, value)
  }
  return out
}

/** Validate a tag map → strongly typed RouteTags. Returns [tags, errors]. */
export function validateTags(tagMap: Map<string, string>): {
  tags: RouteTags | null
  errors: string[]
} {
  const errors: string[] = []

  const routeRaw = tagMap.get('route')
  const authRaw = tagMap.get('auth')

  if (!routeRaw) {
    errors.push('missing required tag: @sa-route')
  } else if (!ROUTE_KINDS.includes(routeRaw as RouteKind)) {
    errors.push(
      `invalid @sa-route value "${routeRaw}" — must be one of: ${ROUTE_KINDS.join(', ')}`,
    )
  }

  if (!authRaw) {
    errors.push('missing required tag: @sa-auth')
  } else if (!AUTH_KINDS.includes(authRaw as AuthKind)) {
    errors.push(
      `invalid @sa-auth value "${authRaw}" — must be one of: ${AUTH_KINDS.join(', ')}`,
    )
  }

  const riskTier = tagMap.get('risk-tier')
  if (riskTier && !RISK_TIERS.includes(riskTier as RiskTier)) {
    errors.push(
      `invalid @sa-risk-tier value "${riskTier}" — must be one of: ${RISK_TIERS.join(', ')}`,
    )
  }

  const rateLimit = tagMap.get('rate-limit')
  if (rateLimit && !/^\d+\/(s|sec|min|hour|day)$/.test(rateLimit)) {
    errors.push(
      `invalid @sa-rate-limit value "${rateLimit}" — expected "<N>/<window>" (e.g. "10/min")`,
    )
  }

  // Cross-tag validity rules.
  if (routeRaw === 'dev-only' && !tagMap.get('prod-gate')) {
    errors.push('@sa-route=dev-only requires @sa-prod-gate (names the production-404 guard)')
  }

  // Sprint 3 S3.4 — validation tag is REQUIRED for state-changing routes;
  // we accept it at parse time (validity check is per-method elsewhere).
  const validation = tagMap.get('validation')
  if (validation && !VALIDATION_KINDS.includes(validation as ValidationKind)) {
    errors.push(
      `invalid @sa-validation value "${validation}" — must be one of: ${VALIDATION_KINDS.join(', ')}`,
    )
  }

  if (errors.length > 0 || !routeRaw || !authRaw) {
    return { tags: null, errors }
  }

  return {
    tags: {
      route: routeRaw as RouteKind,
      auth: authRaw as AuthKind,
      rateLimit: rateLimit,
      auditEvent: tagMap.get('audit-event'),
      riskTier: riskTier as RiskTier | undefined,
      owner: tagMap.get('owner'),
      prodGate: tagMap.get('prod-gate'),
      validation: validation as ValidationKind | undefined,
    },
    errors: [],
  }
}

// ─── file scanning ──────────────────────────────────────────────────────

interface ExportedHandler {
  method: HttpMethod
  /** Character offset where the handler declaration begins in the source. */
  startOffset: number
}

/** Find every `export ... function <METHOD>(` and `export const <METHOD> =`. */
function findExportedHandlers(src: string): ExportedHandler[] {
  const found: ExportedHandler[] = []
  // Match `export async function GET(` or `export function GET(`
  const fnRe = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/g
  // Match `export const GET = ` (less common but Next supports it).
  const constRe = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*[:=]/g
  for (const re of [fnRe, constRe]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      // De-duplicate when the same method is found by both regexes.
      const existing = found.find((f) => f.method === m![1])
      if (!existing) {
        found.push({ method: m[1] as HttpMethod, startOffset: m.index })
      }
    }
  }
  return found.sort((a, b) => a.startOffset - b.startOffset)
}

/**
 * Return the JSDoc block immediately preceding `offset` in `src`, or null
 * if no JSDoc block is adjacent (only whitespace + line comments allowed
 * between the block and the handler).
 */
function findLeadingJsDoc(src: string, offset: number): string | null {
  // Walk backward from offset, skipping whitespace and `//`-line comments,
  // until we hit either a `*/` (start of a JSDoc) or non-whitespace.
  let i = offset - 1
  while (i >= 0) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i--
      continue
    }
    // Could be the close of a JSDoc.
    if (src[i] === '/' && src[i - 1] === '*') {
      const closeAt = i + 1 // index just past `/`
      // Find the matching `/**` opening.
      let j = i - 2
      while (j >= 0) {
        if (src[j] === '*' && src[j - 1] === '*' && src[j - 2] === '/') {
          // `j` points to second `*` of `/**`. Block body starts at j+1.
          return src.slice(j + 1, closeAt - 2)
        }
        j--
      }
      return null
    }
    // Line comment? Walk past it (start of `//...\n`).
    if (ch === '\n') {
      i--
      continue
    }
    // Hit a non-comment, non-whitespace token before any JSDoc.
    return null
  }
  return null
}

/** Find the top-of-file JSDoc block (first `/** ... *\/` at file head). */
function findFileLevelJsDoc(src: string): string | null {
  // Skip leading shebang, BOM, and whitespace.
  let i = 0
  if (src.charCodeAt(0) === 0xfeff) i = 1
  while (i < src.length && /\s/.test(src[i])) i++
  if (src.startsWith('/**', i)) {
    const end = src.indexOf('*/', i + 3)
    if (end !== -1) return src.slice(i + 3, end)
  }
  // Allow a single-line block `/** … */` followed by an import.
  const headerMatch = src.match(/^\s*\/\*\*([\s\S]*?)\*\//)
  if (headerMatch) return headerMatch[1]
  return null
}

/**
 * Derive the API path (`/api/...`) from a route.ts file path.
 *
 * Example: `apps/web/src/app/api/auth/session/route.ts` → `/api/auth/session`.
 * Bracketed segments (`[id]`) are preserved as-is to keep the URL pattern
 * unambiguous in the generated inventory.
 */
export function deriveApiPath(filePath: string): string {
  const m = filePath.match(/\/app(\/api\/.*?)\/route\.ts$/)
  if (!m) return '(unknown)'
  return m[1]
}

// ─── public API ─────────────────────────────────────────────────────────

/**
 * Parse one `route.ts` source file. Yields one ParseResult per exported
 * HTTP method handler. If the same JSDoc block is shared by multiple
 * methods (e.g. a file-header `/** @sa-route ... *\/`) it applies to all
 * handlers below it that have no closer JSDoc.
 */
export function parseRouteFileSource(
  filePath: string,
  src: string,
): ParseResult[] {
  const handlers = findExportedHandlers(src)
  if (handlers.length === 0) {
    return [
      {
        ok: false,
        filePath,
        method: null,
        errors: ['no exported HTTP handler (GET/POST/PUT/PATCH/DELETE) found in route.ts'],
      },
    ]
  }
  const fileLevel = findFileLevelJsDoc(src)

  const out: ParseResult[] = []
  for (const h of handlers) {
    let block = findLeadingJsDoc(src, h.startOffset)
    let usedFileLevel = false
    if (!block || !/@sa-route\b/.test(block)) {
      // Fall back to file-level header if the local JSDoc lacks @sa-route.
      if (fileLevel && /@sa-route\b/.test(fileLevel)) {
        block = fileLevel
        usedFileLevel = true
      }
    }
    if (!block) {
      out.push({
        ok: false,
        filePath,
        method: h.method,
        errors: [`${h.method}: no JSDoc classification block found`],
      })
      continue
    }
    const tagMap = parseTagBlock(block)
    const { tags, errors } = validateTags(tagMap)
    if (!tags) {
      out.push({
        ok: false,
        filePath,
        method: h.method,
        errors: errors.map((e) => `${h.method}${usedFileLevel ? ' (file-level block)' : ''}: ${e}`),
      })
      continue
    }
    // Sprint 3 S3.4 — state-changing methods MUST declare @sa-validation,
    // and when the declaration is `zod` the route file MUST import the
    // shared validateRequest helper (the lint that grants us body-size
    // + schema discipline in one chokepoint).
    const methodErrors: string[] = []
    if (STATE_CHANGING_METHODS.has(h.method) && !tags.validation) {
      methodErrors.push(
        `${h.method}: missing @sa-validation tag (Sprint 3 S3.4) — must be one of: ${VALIDATION_KINDS.join(', ')}`,
      )
    }
    if (tags.validation === 'zod' && !/from\s+['"][^'"]*validate-request['"]/.test(src)) {
      methodErrors.push(
        `${h.method}: @sa-validation=zod requires importing validateRequest from '@/lib/auth/validate-request'`,
      )
    }
    if (methodErrors.length > 0) {
      out.push({ ok: false, filePath, method: h.method, errors: methodErrors })
      continue
    }
    out.push({
      ok: true,
      record: {
        filePath,
        method: h.method,
        tags,
        apiPath: deriveApiPath(filePath),
      },
    })
  }
  return out
}

/** Read a route file from disk and parse it. */
export function parseRouteFile(absPath: string, repoRoot: string): ParseResult[] {
  const src = readFileSync(absPath, 'utf-8')
  const rel = relative(repoRoot, absPath)
  return parseRouteFileSource(rel, src)
}

/** Recursively list every `route.ts` under `dir`. */
export function findRouteFiles(dir: string): string[] {
  const out: string[] = []
  function walk(d: string): void {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(d, e)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
      } else if (e === 'route.ts') {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out.sort()
}

/**
 * Parse every `route.ts` under `webApiDir` (e.g. `apps/web/src/app/api`).
 * Returns the flattened list of parse results — caller decides whether
 * to fail-fast or report all errors.
 */
export function parseAllRoutes(
  webApiDir: string,
  repoRoot: string,
): ParseResult[] {
  const files = findRouteFiles(webApiDir)
  return files.flatMap((f) => parseRouteFile(f, repoRoot))
}
