/**
 * In-memory sliding-window per-IP rate limiter.
 *
 * Phase-1 hardening trip-wire (HARDENING-PLAN §1.5 #9). NOT
 * production-correct for multi-instance deployments — the window state
 * lives in this process's memory. The migration to Redis is tracked in
 * Phase 2; see docs/architecture/01-web-a2a-mcp-flows.md.
 *
 * Usage:
 *   app.use('*', rateLimit(resolveRateLimit('GENERAL', { max: 60, windowMs: 60_000 }, { max: 300, windowMs: 60_000 })))
 *   app.use('/session/init', rateLimit(resolveRateLimit('SESSION_INIT', { max: 10, windowMs: 60_000 }, { max: 60, windowMs: 60_000 })))
 *
 * Env-tunable thresholds (per HARDENING tweak — raises dev ceiling so
 * the Playwright demos don't trip 429 on tight sign-in loops). Each
 * named call site reads its own `RATE_LIMIT_<PREFIX>_MAX` and
 * `RATE_LIMIT_<PREFIX>_WINDOW_MS` env var with a documented default.
 * Defaults are shipping-tight for production; the dev defaults raise
 * the ceiling ~5x. Set in `apps/a2a-agent/.env.example`.
 *
 * Recognised prefixes (canonical list — keep .env.example in sync):
 *   GENERAL        — global per-IP limiter (default: prod 60, dev 300)
 *   SESSION_INIT   — /session/init bootstrap (default: prod 10, dev 60)
 *   AUTH           — /auth/* surface (default: prod 10, dev 60)
 *   MCP_PROXY      — /mcp/* passthrough (default: prod 60, dev 300)
 *
 * All windows default to 60_000 ms.
 */
import type { Context, MiddlewareHandler } from 'hono'

interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number
  /** Max requests per IP per window. */
  max: number
  /** Optional key fn — defaults to IP from x-forwarded-for / remote address. */
  keyFn?: (c: Context) => string
}

interface WindowState {
  /** Timestamps (ms) of recent hits in the current window. */
  hits: number[]
}

const STORES = new WeakMap<RateLimitOptions, Map<string, WindowState>>()

function getIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown'
  const xreal = c.req.header('x-real-ip')
  if (xreal) return xreal.trim()
  // hono/node-server stores raw socket on c.env.incoming
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  const remote = env?.incoming?.socket?.remoteAddress
  return remote ?? 'unknown'
}

/**
 * Build a sliding-window rate-limit middleware. Each call creates an
 * independent store, so a per-route stricter limiter is separate from
 * the global one (the global limiter still counts the same hit).
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  if (!STORES.has(options)) STORES.set(options, new Map())
  const store = STORES.get(options)!

  return async function rateLimitMiddleware(c, next) {
    const key = (options.keyFn ?? getIp)(c)
    const now = Date.now()
    const cutoff = now - options.windowMs

    let entry = store.get(key)
    if (!entry) {
      entry = { hits: [] }
      store.set(key, entry)
    }

    // Drop hits outside the window.
    while (entry.hits.length > 0 && entry.hits[0]! < cutoff) {
      entry.hits.shift()
    }

    if (entry.hits.length >= options.max) {
      const retryMs = entry.hits[0]! + options.windowMs - now
      c.header('Retry-After', Math.ceil(Math.max(retryMs, 0) / 1000).toString())
      return c.json({ error: 'Too Many Requests' }, 429)
    }

    entry.hits.push(now)
    return next()
  }
}

/**
 * Test-only: reset the rate-limit store for a given options ref.
 * Not exported through index.ts — internal to tests.
 */
export function _resetRateLimitStore(options: RateLimitOptions): void {
  STORES.get(options)?.clear()
}

/**
 * Defaults for a rate-limit call site. `max` is requests per window,
 * `windowMs` is window length in milliseconds.
 */
export interface RateLimitDefaults {
  max: number
  windowMs: number
}

/**
 * Resolve a `{ max, windowMs }` pair for a named rate-limit call site
 * from env vars + shipping defaults.
 *
 * Lookup order per field:
 *   1. `RATE_LIMIT_<envPrefix>_MAX` / `_WINDOW_MS` if set + valid.
 *   2. `devDefault` if `NODE_ENV !== 'production'` AND `devDefault` provided.
 *   3. `prodDefault` (the shipping tight ceiling).
 *
 * Throws on a non-finite or non-positive override — fail-fast at boot
 * rather than silently degrading the limiter to "off" on a typo.
 *
 * @param envPrefix    SHOUTY_SNAKE token, e.g. 'SESSION_INIT'. The env
 *                     vars `RATE_LIMIT_<envPrefix>_MAX` and
 *                     `RATE_LIMIT_<envPrefix>_WINDOW_MS` are consulted.
 * @param prodDefault  Required shipping default (used in prod + when
 *                     `devDefault` is omitted in non-prod).
 * @param devDefault   Optional non-prod default — raises the ceiling
 *                     for local + CI demos.
 * @param envIn        Injectable for tests. Defaults to `process.env`.
 */
export function resolveRateLimit(
  envPrefix: string,
  prodDefault: RateLimitDefaults,
  devDefault?: RateLimitDefaults,
  envIn: NodeJS.ProcessEnv = process.env,
): RateLimitDefaults {
  const isDev = envIn.NODE_ENV !== 'production'
  const fallback = isDev && devDefault ? devDefault : prodDefault

  const maxKey = `RATE_LIMIT_${envPrefix}_MAX`
  const windowKey = `RATE_LIMIT_${envPrefix}_WINDOW_MS`
  const maxRaw = envIn[maxKey]
  const windowRaw = envIn[windowKey]

  const max = maxRaw === undefined ? fallback.max : Number(maxRaw)
  const windowMs = windowRaw === undefined ? fallback.windowMs : Number(windowRaw)

  if (!Number.isFinite(max) || max <= 0) {
    throw new Error(`Invalid ${maxKey}: ${maxRaw}`)
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`Invalid ${windowKey}: ${windowRaw}`)
  }
  return { max, windowMs }
}
