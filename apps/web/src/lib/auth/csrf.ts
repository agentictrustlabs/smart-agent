/**
 * CSRF Origin allowlist (S2.2).
 *
 * Replaces the legacy substring-based CSRF check
 *
 *   if (origin && host && !origin.includes(host.split(':')[0])) { reject }
 *
 * which had a critical flaw: `origin.includes(host)` is a substring
 * check, so `Origin: https://evil-foo.com` against `Host: foo.com`
 * SUCCEEDED — lookalike domains slipped through.
 *
 * `requireOriginAllowed()` performs a parsed-URL exact equality check
 * against an explicit allowlist sourced from the `ALLOWED_ORIGINS`
 * environment variable (comma-separated list of fully-qualified
 * origins, e.g.
 *
 *   ALLOWED_ORIGINS=http://localhost:3000,https://app.example.com
 *
 * Each route's POST/PATCH/PUT/DELETE handler should call this as the
 * FIRST check, before parsing the body:
 *
 *   const denied = requireOriginAllowed(request)
 *   if (denied) return denied
 *
 * Returns `null` (allow) or a 403 `NextResponse` (reject).
 *
 *
 * Why protocol + host (not host only)?
 * ----------------------------------------------------------------
 * `URL.host` already includes any explicit port (e.g. `localhost:3000`),
 * so the check is naturally port-aware. We additionally require the
 * scheme to match so `http://app.example.com` listed in the allowlist
 * doesn't accept a request claiming `https://app.example.com` (or
 * vice-versa) — keeps the configuration explicit.
 *
 * Vercel preview URLs:
 * ----------------------------------------------------------------
 * Preview deployments have dynamic subdomains under `*.vercel.app`,
 * which an exact-allowlist cannot cover. Two approaches if you ever
 * need them:
 *   (a) Build the per-deployment URL into `ALLOWED_ORIGINS` at deploy
 *       time via Vercel's env (`VERCEL_URL`) plumbing.
 *   (b) Add a separate `PREVIEW_ORIGIN_PATTERN` env (RegExp) handled
 *       alongside the allowlist. Not implemented today — file an issue
 *       when the need arises.
 */
import { NextResponse } from 'next/server'

/** Comma-separated env value → trimmed list. Empty string → no entries. */
function parseAllowedOrigins(raw: string | undefined): URL[] {
  if (!raw) return []
  const out: URL[] = []
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim()
    if (!trimmed) continue
    try {
      out.push(new URL(trimmed))
    } catch {
      // Drop malformed entries; we don't want to crash the route, but
      // we DO want to surface the misconfig in logs.
      console.warn(`[csrf] ignoring malformed ALLOWED_ORIGINS entry: ${trimmed}`)
    }
  }
  return out
}

/**
 * Resolve the active allowlist. Computed on every call so test cases
 * (and runtime env reloads) pick up env changes without restarting the
 * server. Falls back to `http://localhost:3000` when nothing is
 * configured so local dev works out of the box.
 */
export function getAllowedOrigins(): URL[] {
  const env = process.env.ALLOWED_ORIGINS
  if (env === undefined || env === '') {
    // Use a sensible local-dev default. Production deployments MUST set
    // this — there's no way for the helper to know your real origin.
    return parseAllowedOrigins('http://localhost:3000')
  }
  return parseAllowedOrigins(env)
}

/**
 * Pure predicate — exported for unit tests. Returns true iff the
 * `Origin` header value parses to a URL whose protocol AND host match
 * an entry in the allowlist.
 *
 * `null` / missing / unparseable Origin → `false` (reject).
 *
 * Note: empty `ALLOWED_ORIGINS` (vs. unset) yields an empty allowlist,
 * which rejects every request. This is intentional — operators can
 * "fail closed" with `ALLOWED_ORIGINS=` if they want to break all
 * state-changing routes during incident response.
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  const allow = getAllowedOrigins()
  for (const a of allow) {
    // `URL.host` covers hostname + port. Add an explicit protocol check
    // so an http allowlist entry doesn't admit an https request — keeps
    // the configuration unambiguous.
    if (parsed.protocol === a.protocol && parsed.host === a.host) {
      return true
    }
  }
  return false
}

/**
 * Route-handler guard. Call as the FIRST line of any state-changing
 * route. Returns `null` to allow; returns a 403 JSON `NextResponse` to
 * reject (matches the legacy substring-check response shape so callers
 * can swap in without behavioural surprise).
 *
 * Tolerates same-origin browsers that omit the `Origin` header on
 * top-level GET navigations — but this helper is for STATE-CHANGING
 * verbs (POST/PUT/PATCH/DELETE), where every modern browser sends
 * Origin. A missing Origin header on a write is exactly the case we
 * want to reject (it's how the old CSRF bug bit us).
 */
export function requireOriginAllowed(request: Request): NextResponse | null {
  const origin = request.headers.get('origin')
  if (isOriginAllowed(origin)) return null
  return NextResponse.json({ error: 'CSRF rejected' }, { status: 403 })
}
