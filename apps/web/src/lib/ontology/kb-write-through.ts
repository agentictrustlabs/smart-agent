/**
 * Debounced write-through sync from on-chain → GraphDB.
 *
 * Every server-side write that mutates the public trust graph
 * (createRelationship, confirmRelationship, agent registration, etc.)
 * calls `scheduleKbSync()`. Calls inside the QUIET_MS window coalesce
 * into one sync — so a burst (catalyst-seed creates ~3000 edges) costs
 * a single GraphDB upload instead of N.
 *
 * Why a process-wide singleton:
 *   • The KB is denormalized read-model. Stale state shows up as wrong
 *     KPI counts and an empty /agents directory; correctness on chain is
 *     unaffected, so we never block a write to wait for the sync.
 *   • If the sync itself is in flight when a new mutation arrives, we
 *     re-arm the timer once it finishes, guaranteeing the latest state
 *     eventually lands.
 *
 * Backpressure (in order of strictness):
 *   1. QUIET_MS         — wait this long after the LAST mutation before
 *                          syncing. Coalesces bursts.
 *   2. COOLDOWN_MS      — after a SUCCESSFUL sync, hold off this long
 *                          before starting another even if mutations pile up.
 *   3. MIN_INTERVAL_MS  — hard floor between sync STARTS regardless of
 *                          success. Caps load when GraphDB is failing
 *                          (524 / 500) and we'd otherwise retry too fast.
 *
 * Failure handling: log and move on. The next call retriggers the sync;
 * a manual `POST /api/ontology-sync` still works as a backstop.
 *
 * Env-gate `SKIP_KB_SYNC=true` → `scheduleKbSync()` is a no-op. Use during
 * seed scripts that drive their own SPARQL writes so the action layer
 * doesn't pile follow-up full-graph PUTs on top.
 */

const QUIET_MS         = 120_000   // wait this long after the last write before syncing
const COOLDOWN_MS      = 90_000    // wait at least this long after a successful sync
const MIN_INTERVAL_MS  = 60_000    // hard floor between sync starts

type LockState = {
  timer: NodeJS.Timeout | null
  inflight: Promise<void> | null
  pending: boolean
  /** Epoch ms of the last successful sync; 0 means never. */
  lastSyncOkAt: number
  /** Epoch ms of the last sync START (success or failure). */
  lastSyncStartedAt: number
}

// globalThis singleton so Next.js HMR doesn't fork independent timers.
const G = globalThis as unknown as { __kbSyncLock?: LockState }
if (!G.__kbSyncLock) {
  G.__kbSyncLock = { timer: null, inflight: null, pending: false, lastSyncOkAt: 0, lastSyncStartedAt: 0 }
}
const lock = G.__kbSyncLock

function syncDisabled(): boolean {
  const v = process.env.SKIP_KB_SYNC?.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

async function runSync(): Promise<boolean> {
  lock.lastSyncStartedAt = Date.now()
  // Lazy import — graphdb-sync pulls heavy deps; only load on actual sync.
  const mod = await import('./graphdb-sync')
  const result = await mod.syncOnChainToGraphDB()
  console.log('[kb-sync]', result.success ? `ok (${result.agentCount} agents)` : `failed: ${result.message}`)
  return result.success
}

export function scheduleKbSync(): void {
  if (syncDisabled()) return

  // If a sync is already running, mark pending so we re-arm when it ends.
  if (lock.inflight) { lock.pending = true; return }

  const now = Date.now()
  const sinceOk     = now - lock.lastSyncOkAt
  const sinceStart  = now - lock.lastSyncStartedAt
  const waitForOk    = sinceOk    < COOLDOWN_MS     ? COOLDOWN_MS - sinceOk        : 0
  const waitForStart = sinceStart < MIN_INTERVAL_MS ? MIN_INTERVAL_MS - sinceStart : 0
  const wait = Math.max(QUIET_MS, waitForOk, waitForStart)

  if (lock.timer) clearTimeout(lock.timer)
  lock.timer = setTimeout(() => {
    lock.timer = null
    lock.inflight = runSync()
      .then(ok => {
        if (ok) lock.lastSyncOkAt = Date.now()
      })
      .catch(e => { console.warn('[kb-sync] error:', (e as Error).message) })
      .finally(() => {
        lock.inflight = null
        if (lock.pending) {
          lock.pending = false
          scheduleKbSync()
        }
      })
  }, wait)
}
