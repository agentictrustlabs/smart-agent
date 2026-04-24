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

/** Run all three community seeds to completion. Idempotent / concurrent-safe. */
export function triggerBootSeed(): Promise<void> {
  if (state.completed) return Promise.resolve()
  if (inflight) return inflight

  state.started = true
  state.startedAt = new Date().toISOString()
  state.phase = 'provisioning users (all prefixes)'

  inflight = (async () => {
    try {
      // 1. Provision every demo user across all three communities in parallel.
      //    Each call inserts DB rows + deploys person agents for that prefix.
      state.phase = 'provisioning: global.church users'
      await ensureCommunityUsers('gc-user-')

      state.phase = 'provisioning: catalyst users'
      await ensureCommunityUsers('cat-user-')

      state.phase = 'provisioning: cil users'
      await ensureCommunityUsers('cil-user-')

      // 2. Seed each hub's on-chain orgs + relationships. These are the big
      //    ones (30s – 2min each) but they're idempotent, so the total cost
      //    converges.
      state.phase = 'on-chain seed: global.church'
      await seedGlobalChurchOnChain()

      state.phase = 'on-chain seed: catalyst'
      await seedCatalystOnChain()

      state.phase = 'on-chain seed: cil'
      await seedCILOnChain()

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
