/**
 * Debounced write-through sync from on-chain → GraphDB.
 *
 * Every server-side write that mutates the public trust graph
 * (createRelationship, confirmRelationship, agent registration, etc.)
 * calls `scheduleKbSync()`. Calls inside a 2-second window coalesce into
 * one sync — so a burst (boot-seed, batched UI flow) costs a single
 * GraphDB upload instead of N.
 *
 * Why a process-wide singleton:
 *   • The KB is denormalized read-model. Stale state shows up as wrong
 *     KPI counts and an empty /agents directory; correctness on chain is
 *     unaffected, so we never block a write to wait for the sync.
 *   • If the sync itself is in flight when a new mutation arrives, we
 *     re-arm the timer once it finishes, guaranteeing the latest state
 *     eventually lands.
 *
 * Failure handling: log and move on. The next call retriggers the sync;
 * a manual `POST /api/ontology-sync` still works as a backstop.
 */

const QUIET_MS = 2_000

type LockState = {
  timer: NodeJS.Timeout | null
  inflight: Promise<void> | null
  pending: boolean
}

// globalThis singleton so Next.js HMR doesn't fork independent timers.
const G = globalThis as unknown as { __kbSyncLock?: LockState }
if (!G.__kbSyncLock) G.__kbSyncLock = { timer: null, inflight: null, pending: false }
const lock = G.__kbSyncLock

async function runSync() {
  // Lazy import — graphdb-sync pulls heavy deps; we don't want to load it
  // on every request, only when a mutation actually happens.
  const mod = await import('./graphdb-sync')
  const result = await mod.syncOnChainToGraphDB()
  console.log('[kb-sync]', result.success ? `ok (${result.agentCount} agents)` : `failed: ${result.message}`)
}

export function scheduleKbSync(): void {
  // If a sync is already running, mark pending so we re-arm when it ends.
  if (lock.inflight) { lock.pending = true; return }

  if (lock.timer) clearTimeout(lock.timer)
  lock.timer = setTimeout(() => {
    lock.timer = null
    lock.inflight = runSync()
      .catch(e => { console.warn('[kb-sync] error:', (e as Error).message) })
      .finally(() => {
        lock.inflight = null
        if (lock.pending) {
          lock.pending = false
          scheduleKbSync()
        }
      })
  }, QUIET_MS)
}
