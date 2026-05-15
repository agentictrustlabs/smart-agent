/**
 * Thin shim — the real on-chain → GraphDB sync now lives in hub-mcp
 * (`apps/hub-mcp/src/lib/kb-write-through.ts`). Phase 5 of the A2A-First
 * Routing Consolidation moved the implementation out of the web app so
 * the cache layer + the writes that invalidate it sit in the same
 * process.
 *
 * Existing callers keep their `scheduleKbSync()` / `scheduleKbSyncEager()`
 * imports; the call is now a single hub-mcp RPC instead of an in-process
 * timer. Hub-mcp owns the debounce / cooldown / min-interval logic.
 *
 * The web no longer holds GraphDB write credentials. `SKIP_KB_SYNC=true`
 * is still honoured (hub-mcp inherits the same env-gate).
 *
 * Deprecated — new code should call `hubScheduleKbSync()` from
 * `@/lib/clients/hub-client` directly.
 */

import { hubScheduleKbSync } from '@/lib/clients/hub-client'

/** Schedule a debounced kb-sync. Bursts coalesce inside hub-mcp's QUIET_MS window. */
export function scheduleKbSync(): void {
  // Fire-and-forget — the underlying tool only enqueues a timer.
  void hubScheduleKbSync(false).catch(err => {
    console.warn('[kb-sync] hub-mcp scheduling failed:', err instanceof Error ? err.message : err)
  })
}

/** Eager schedule — skips the QUIET_MS debounce but still respects rate-limit floors. */
export function scheduleKbSyncEager(): void {
  void hubScheduleKbSync(true).catch(err => {
    console.warn('[kb-sync] hub-mcp eager scheduling failed:', err instanceof Error ? err.message : err)
  })
}
