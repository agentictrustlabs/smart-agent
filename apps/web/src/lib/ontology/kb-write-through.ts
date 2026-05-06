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
 * Backpressure: after a SUCCESSFUL sync we earn a COOLDOWN_MS of
 * silence before the next sync — even if writes pile up, we don't
 * hammer GraphDB. This was the load source that was killing the public
 * GraphDB instance: catalyst-seed bursts at ~3 edges/sec triggered ~3
 * syncs/sec, each PUTting a multi-MB combined turtle. Cooldown bounds
 * sync frequency to at most 1 every 30s regardless of write volume.
 *
 * Failure handling: log and move on. The next call retriggers the sync;
 * a manual `POST /api/ontology-sync` still works as a backstop.
 */

const QUIET_MS = 60_000        // wait this long after the last write before syncing
const COOLDOWN_MS = 30_000     // wait at least this long after a successful sync

type LockState = {
  timer: NodeJS.Timeout | null
  inflight: Promise<void> | null
  pending: boolean
  /** Epoch ms of the last successful sync; 0 means never. */
  lastSyncOkAt: number
}

// globalThis singleton so Next.js HMR doesn't fork independent timers.
const G = globalThis as unknown as { __kbSyncLock?: LockState }
if (!G.__kbSyncLock) G.__kbSyncLock = { timer: null, inflight: null, pending: false, lastSyncOkAt: 0 }
const lock = G.__kbSyncLock

async function runSync(): Promise<boolean> {
  // Lazy import — graphdb-sync pulls heavy deps; we don't want to load it
  // on every request, only when a mutation actually happens.
  const mod = await import('./graphdb-sync')
  const result = await mod.syncOnChainToGraphDB()
  console.log('[kb-sync]', result.success ? `ok (${result.agentCount} agents)` : `failed: ${result.message}`)
  return result.success
}

export function scheduleKbSync(): void {
  // If a sync is already running, mark pending so we re-arm when it ends.
  if (lock.inflight) { lock.pending = true; return }

  // If we synced successfully recently, stretch the timer until the
  // cooldown elapses.
  const now = Date.now()
  const sinceOk = now - lock.lastSyncOkAt
  const wait = sinceOk < COOLDOWN_MS ? Math.max(QUIET_MS, COOLDOWN_MS - sinceOk) : QUIET_MS

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
