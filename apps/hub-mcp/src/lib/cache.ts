/**
 * In-process LRU + TTL cache used by every hub-mcp read tool.
 *
 * Two design rules:
 *   1. Reads are cached by `(toolName, normalized-args)` key.
 *   2. Writes through hub-mcp invalidate the cache for affected
 *      tool families BEFORE returning to the caller. Read-after-write
 *      is therefore consistent for clients that route through us.
 *
 * The cache is intentionally simple — Map preserves insertion order,
 * which gives us O(1) LRU eviction without an external dep.
 */

import { config } from '../config.js'

interface Entry<T> { value: T; expiresAt: number }

const store = new Map<string, Entry<unknown>>()

function evictExpired(now: number) {
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k)
    else break // Map iterates in insertion order; older entries first.
  }
}

function evictOverflow() {
  while (store.size > config.CACHE_MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) return
    store.delete(oldest)
  }
}

export function cacheKey(family: string, args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort()
  const norm: Record<string, unknown> = {}
  for (const k of keys) norm[k] = args[k]
  return `${family}::${JSON.stringify(norm)}`
}

export function cacheGet<T>(key: string): T | undefined {
  const now = Date.now()
  evictExpired(now)
  const e = store.get(key) as Entry<T> | undefined
  if (!e) return undefined
  if (e.expiresAt <= now) { store.delete(key); return undefined }
  // Refresh LRU position by re-inserting at the end.
  store.delete(key)
  store.set(key, e)
  return e.value
}

export function cacheSet<T>(key: string, value: T, ttlMs?: number): void {
  store.set(key, { value, expiresAt: Date.now() + (ttlMs ?? config.CACHE_TTL_MS) })
  evictOverflow()
}

/** Invalidate every entry under a given tool-family prefix. Used by
 *  write tools immediately after a successful mutation. */
export function cacheInvalidateFamily(family: string): number {
  let removed = 0
  const prefix = `${family}::`
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) { store.delete(k); removed++ }
  }
  return removed
}

export function cacheClear(): void { store.clear() }
export function cacheSize(): number { return store.size }
