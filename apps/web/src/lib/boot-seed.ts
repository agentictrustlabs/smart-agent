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
import { seedSkillsOnChain } from '@/lib/demo-seed/seed-skills-onchain'
import { seedSkillIssuersOnChain } from '@/lib/demo-seed/seed-skill-issuers-onchain'
import { seedDemoSkillClaimsOnChain } from '@/lib/demo-seed/seed-demo-skill-claims'
import { seedDiscipleNetworksOnChain } from '@/lib/demo-seed/seed-disciple-networks-onchain'
import { seedCatalystNeedsAndOfferings } from '@/lib/demo-seed/seed-needs-resources'
import { ensureDevP256Stub } from '@/lib/dev-p256-stub'

export interface BootState {
  started: boolean
  startedAt: string | null
  completed: boolean
  completedAt: string | null
  phase: string
  error: string | null
}

// Stash the boot-state on globalThis so dev-mode HMR module reloads don't
// reset `completed` to `false` and cause the late skill-seed top-up to
// re-run on every page load (each top-up is ~10s of RPC reads, which
// stacks up under the test runner).
type BootGuard = { state: BootState; inflight: Promise<void> | null }
const _boot = globalThis as unknown as { __saBootGuard?: BootGuard }
if (!_boot.__saBootGuard) {
  _boot.__saBootGuard = {
    state: {
      started: false, startedAt: null,
      completed: false, completedAt: null,
      phase: 'idle', error: null,
    },
    inflight: null,
  }
}
const state: BootState = _boot.__saBootGuard.state

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
  if (_boot.__saBootGuard!.inflight) return _boot.__saBootGuard!.inflight!

  state.started = true
  state.startedAt = new Date().toISOString()
  state.phase = 'provisioning users (all prefixes)'
  // Reset error from a prior failed attempt so callers don't see a stale
  // string while a fresh attempt is making real progress.
  state.error = null

  const inflight = (async () => {
    try {
      // -1. If the chain already has all three hub agents registered, an
      //     earlier seed run completed and the in-memory flag was cleared
      //     by an HMR reload. Mark complete and exit before doing any
      //     work — otherwise dev edits stall every passkey signin while
      //     the seed re-checks every agent it already wrote.
      if (await chainSeedingComplete()) {
        // Even when the chain says hubs+orgs are seeded, the v1 skill-claim
        // seed may not have run yet (it's an idempotent step added after
        // the original chainSeedingComplete check was written). Run it
        // explicitly here — re-runs hit ClaimExists and exit cheaply.
        try {
          await seedSkillsOnChain()
          await seedSkillIssuersOnChain()
          await seedDiscipleNetworksOnChain()
          await seedDemoSkillClaimsOnChain()
        } catch (e) {
          console.warn('[boot-seed] late skill seed error (non-fatal):', (e as Error).message)
        }
        state.completed = true
        state.completedAt = new Date().toISOString()
        state.phase = 'ready'
        console.log('[boot-seed] chain already seeded — skill claims topped up, ready')
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
        // fr/pl/dm users (sister networks for catalyst). These don't depend on
        // hub-seed completion, so we provision them up-front. This clears the
        // 41/41 readiness gate before the slow hub-seed work runs, instead of
        // making the user wait through ~10 minutes of catalyst+cil seeding.
        ensureCommunityUsers('fr-user-'),
        ensureCommunityUsers('pl-user-'),
        ensureCommunityUsers('dm-user-'),
      ])

      // 2a. Geo features + .geo name tree first — hub seeds mint
      //     `residentOf` / `operatesIn` GeoClaims that pin a feature
      //     version, so the features must already exist by the time the
      //     hub seed runs.
      state.phase = 'on-chain seed: geo features'
      try {
        await seedGeoOnChain()
      } catch (e) {
        console.warn('[boot-seed] geo seed error (non-fatal):', (e as Error).message)
      }

      // 2a′. Skill definitions — published once at boot so the profile
      //      panel and trust-search column have something to bind against.
      //      Idempotent at the per-skill level.
      state.phase = 'on-chain seed: skill definitions'
      try {
        await seedSkillsOnChain()
      } catch (e) {
        console.warn('[boot-seed] skills seed error (non-fatal):', (e as Error).message)
      }

      // 2a″. Skill issuer registry — register the demo skill-mcp issuer
      //      so cross-issued claim demos surface a registered issuer at
      //      scoring time. Idempotent at the contract level.
      state.phase = 'on-chain seed: skill issuers'
      try {
        await seedSkillIssuersOnChain()
      } catch (e) {
        console.warn('[boot-seed] skill issuer seed error (non-fatal):', (e as Error).message)
      }

      // 2b. Seed each hub's on-chain orgs + relationships sequentially.
      //     We used to run these in parallel, but every seed now mints
      //     ~30 GeoClaims with the same deployer key — viem's nonce
      //     manager can't keep three concurrent batches in lockstep, and
      //     the pre-flight balance funding races trip "nonce too low"
      //     reverts. Per-hub locks make sequential safe under poll
      //     re-triggers.
      state.phase = 'on-chain seed: all hubs'
      await seedGlobalChurchOnChain()
      await seedCatalystOnChain()
      await seedCILOnChain()

      // 2b′. Catalyst sister networks (Harvest East, Great Lakes,
      //      CityBridge). Adds the disciple-tools-flavoured org agents
      //      + 12 actors representing missional archetypes (Multiplier,
      //      Dispatcher, Strategist, Digital Responder, Multi-Gen Coach)
      //      under the existing Catalyst hub. Idempotent.
      state.phase = 'on-chain seed: disciple-tools sister networks'
      try {
        await seedDiscipleNetworksOnChain()
      } catch (e) {
        console.warn('[boot-seed] disciple networks seed error (non-fatal):', (e as Error).message)
      }

      // 2c. Demo skill claims — runs after person-agents exist so
      //     getPersonAgentForUser resolves. Idempotent: deterministic
      //     nonce hits ClaimExists on re-run.
      state.phase = 'on-chain seed: demo skill claims'
      try {
        await seedDemoSkillClaimsOnChain()
      } catch (e) {
        console.warn('[boot-seed] demo skill claims error (non-fatal):', (e as Error).message)
      }

      // 2d. Catalyst Needs / Resources / Matches (Discover layer).
      //     Runs after person + org agents exist + skill claims so the
      //     match scorer has real evidence to work with.
      state.phase = 'discover seed: needs + offerings + matches'
      try {
        await seedCatalystNeedsAndOfferings()
      } catch (e) {
        console.warn('[boot-seed] catalyst needs/resources seed error (non-fatal):', (e as Error).message)
      }

      // 2e. Project legacy needs/offerings rows into Intents. acceptMatch
      //     mints an Engagement only when both holder + provider Intents
      //     exist; without this backfill, accepting a match silently fails
      //     the mint step and the user lands on an "accepted" match with
      //     no engagement workspace. Idempotent.
      state.phase = 'discover seed: backfilling intents from legacy'
      try {
        const { backfillIntentsFromLegacy } = await import('@/lib/actions/intents.action')
        const r = await backfillIntentsFromLegacy()
        console.log(`[boot-seed] intents backfill: ${r.needsBackfilled} needs, ${r.offeringsBackfilled} offerings`)
      } catch (e) {
        console.warn('[boot-seed] intent backfill error (non-fatal):', (e as Error).message)
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
      _boot.__saBootGuard!.inflight = null
    }
  })()
  _boot.__saBootGuard!.inflight = inflight
  return inflight
}

export function getBootState(): BootState {
  return { ...state }
}
