/**
 * Pre-warm every demo community at startup.
 *
 * Rule: the system is NOT "ready" until every demo person has a deployed
 * person agent, every demo org is on-chain, and every hub is registered.
 * We do not wait for a user's first login to provision their community —
 * that's the lazy path; the banner would flicker to green for one user
 * while other users' state still had gaps. Here we run all three hub
 * seeds sequentially on first /api/boot-seed call.
 *
 *   Idempotent: a completed seed short-circuits at the per-user level
 *   (generateDemoWallet checks for an existing DB row) and at the on-chain
 *   level (the per-hub seed sets an 'edgesComplete' sentinel).
 *
 *   Concurrent-safe: module-level singleton guards both the boot state
 *   and each per-hub seed inside `ensureDemoCommunitySeeded`.
 */

import { ensureCommunityUsers } from '@/lib/demo-seed/lookup-users'
import { seedCILOnChain } from '@/lib/demo-seed/seed-cil-onchain'
import { seedCatalystOnChain } from '@/lib/demo-seed/seed-catalyst-onchain'
import { seedGlobalChurchOnChain } from '@/lib/demo-seed/seed-globalchurch-onchain'
import { seedGeoOnChain } from '@/lib/demo-seed/seed-geo-onchain'
import { ensureDevP256Stub } from '@/lib/dev-p256-stub'

export interface BootState {
  started: boolean
  startedAt: string | null
  completed: boolean
  completedAt: string | null
  phase: string
  error: string | null
}

const state: BootState = {
  started: false,
  startedAt: null,
  completed: false,
  completedAt: null,
  phase: 'idle',
  error: null,
}

let inflight: Promise<void> | null = null

/**
 * Quick on-chain probe: have the three hub agents already been seeded?
 * Used to short-circuit boot-seed when an HMR reload reset the in-memory
 * state.completed flag but anvil already has everything. Without this,
 * every dev-mode source edit kicks off a fresh seed pass that hammers
 * the deployer EOA for ~10 minutes and slows every concurrent RPC call
 * (e.g. passkey-verify and the bootstrap routes balloon to 10–30s).
 */
async function chainSeedingComplete(): Promise<boolean> {
  try {
    const { listRegisteredAgents } = await import('@/lib/agent-resolver')
    const agents = await listRegisteredAgents()
    // Hub agents register last in each seed function. If all three hub
    // names appear, every prior step (orgs, persons, edges, names) is
    // already on chain.
    const lower = (s: string) => s.toLowerCase()
    const names = new Set(agents.map(a => lower(a.name)))
    return ['catalyst hub', 'mission collective hub', 'global.church hub'].every(h => names.has(h))
  } catch {
    return false
  }
}

/** Run all three community seeds to completion. Idempotent / concurrent-safe. */
export function triggerBootSeed(): Promise<void> {
  if (state.completed) return Promise.resolve()
  if (inflight) return inflight

  state.started = true
  state.startedAt = new Date().toISOString()
  state.phase = 'provisioning users (all prefixes)'
  // Reset error from a prior failed attempt so callers don't see a stale
  // string while a fresh attempt is making real progress.
  state.error = null

  inflight = (async () => {
    try {
      // -1. If the chain already has all three hub agents registered, an
      //     earlier seed run completed and the in-memory flag was cleared
      //     by an HMR reload. Mark complete and exit before doing any
      //     work — otherwise dev edits stall every passkey signin while
      //     the seed re-checks every agent it already wrote.
      if (await chainSeedingComplete()) {
        state.completed = true
        state.completedAt = new Date().toISOString()
        state.phase = 'ready'
        console.log('[boot-seed] chain already seeded — skipping')
        return
      }

      // 0. Install the dev-only P-256 always-true stub at the canonical
      //    precompile addresses. Anvil 1.5 doesn't expose RIP-7212, so
      //    real WebAuthn / passkey signature verification can't run
      //    without a fallback. The stub makes the smart account's
      //    `_verifyWebAuthn` path return true so passkey-signed user
      //    operations + ERC-1271 calls succeed in local dev. Idempotent.
      state.phase = 'installing dev P-256 stub'
      await ensureDevP256Stub()

      // 1. Provision every demo user across all three communities in
      //    parallel. The deployer-lock serializes the actual on-chain
      //    writes inside getWalletClient, so this is "concurrent kick-off,
      //    serialized signing" — gives us a single fan-out point instead
      //    of three round-trip waves of fetches.
      state.phase = 'provisioning users (all communities)'
      await Promise.all([
        ensureCommunityUsers('gc-user-'),
        ensureCommunityUsers('cat-user-'),
        ensureCommunityUsers('cil-user-'),
      ])

      // 2. Seed each hub's on-chain orgs + relationships in parallel for
      //    the same reason. Each hub seed has its own per-hub lock that
      //    short-circuits double-entry, so calling them simultaneously is
      //    safe even if a poll re-trigger lands mid-flight.
      state.phase = 'on-chain seed: all hubs'
      await Promise.all([
        seedGlobalChurchOnChain(),
        seedCatalystOnChain(),
        seedCILOnChain(),
      ])

      // 2b. Geo features + .geo name tree.
      //     Runs after the hub seeds because city tags on agents are
      //     useful even if the GeoFeatureRegistry write fails (the
      //     coarse-tier of geo-overlap.v1 only needs ATL_CITY).
      state.phase = 'on-chain seed: geo features'
      try {
        await seedGeoOnChain()
      } catch (e) {
        console.warn('[boot-seed] geo seed error (non-fatal):', (e as Error).message)
      }

      // 3. Push fresh on-chain state into the GraphDB KB so the /agents
      //    directory + KPI counters reflect today's deploy. Subsequent edge
      //    writes use scheduleKbSync() from the action layer.
      state.phase = 'syncing on-chain → GraphDB'
      try {
        const { syncOnChainToGraphDB } = await import('@/lib/ontology/graphdb-sync')
        const result = await syncOnChainToGraphDB()
        console.log('[boot-seed]', result.success ? `KB sync ok (${result.agentCount})` : `KB sync failed: ${result.message}`)
      } catch (e) {
        console.warn('[boot-seed] KB sync error (non-fatal):', (e as Error).message)
      }

      state.completed = true
      state.completedAt = new Date().toISOString()
      state.phase = 'ready'
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      state.phase = `failed: ${state.error}`
      // Leave completed=false so next poll retries.
    } finally {
      inflight = null
    }
  })()

  return inflight
}

export function getBootState(): BootState {
  return { ...state }
}
