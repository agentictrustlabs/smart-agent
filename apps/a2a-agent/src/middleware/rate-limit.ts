/**
 * In-memory sliding-window per-IP rate limiter.
 *
 * Phase-1 hardening trip-wire (HARDENING-PLAN §1.5 #9). NOT
 * production-correct for multi-instance deployments — the window state
 * lives in this process's memory. The migration to Redis is tracked in
 * Phase 2; see docs/architecture/01-web-a2a-mcp-flows.md.
 *
 * Usage:
 *   app.use('*', rateLimit({ windowMs: 60_000, max: 60 }))
 *   app.use('/session/init', rateLimit({ windowMs: 60_000, max: 10 }))
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
