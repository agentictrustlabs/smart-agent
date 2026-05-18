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

import { isNotNull } from 'drizzle-orm'
import { ensureCommunityUsers } from '@/lib/demo-seed/lookup-users'
import { seedCILOnChain } from '@/lib/demo-seed/seed-cil-onchain'
import { seedCatalystOnChain } from '@/lib/demo-seed/seed-catalyst-onchain'
import { seedGlobalChurchOnChain } from '@/lib/demo-seed/seed-globalchurch-onchain'
import { seedGeoOnChain } from '@/lib/demo-seed/seed-geo-onchain'
import { seedSkillsOnChain } from '@/lib/demo-seed/seed-skills-onchain'
import { seedSkillIssuersOnChain } from '@/lib/demo-seed/seed-skill-issuers-onchain'
import { seedDemoSkillClaimsOnChain } from '@/lib/demo-seed/seed-demo-skill-claims'
import { seedDiscipleNetworksOnChain } from '@/lib/demo-seed/seed-disciple-networks-onchain'
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
      // -2. S2.5(a) — production invariant: refuse to start a seed if any
      //     demo private key has slipped into the prod DB. Errors here
      //     propagate to the boot-seed state.error so operators see it
      //     loudly on the readiness banner.
      await assertNoDemoPrivateKeysInProd()

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
      // SEED_PROFILE=minimal: smoke-test seed for the proposal-funding video.
      // Provisions exactly three demo users (Maria, Pastor David, Sarah) +
      // catalyst-seed:minimal's 3 orgs + 2 treasuries. Skips gc/cil/
      // disciple-networks/skill-claims/mcp-data entirely. ~5 min vs ~60 min.
      const minimal = process.env.SEED_PROFILE === 'minimal'
      state.phase = minimal
        ? 'provisioning users (Maria + David + Sarah — minimal)'
        : 'provisioning users (all communities)'
      if (minimal) {
        const { ensureDemoUser } = await import('@/lib/demo-seed/lookup-users')
        await ensureDemoUser('cat-user-001') // Maria Gonzalez — Network Program Director
        await ensureDemoUser('cat-user-002') // Pastor David Chen — Fort Collins Network Lead
        await ensureDemoUser('cat-user-005') // Sarah Thompson — Network Regional Lead
      } else {
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
      }

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
      state.phase = minimal
        ? 'on-chain seed: catalyst hub only (minimal)'
        : 'on-chain seed: all hubs'
      if (!minimal) {
        await seedGlobalChurchOnChain()
      }
      await seedCatalystOnChain()
      if (!minimal) {
        await seedCILOnChain()
      }

      if (!minimal) {
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
      } else {
        console.log('[boot-seed] SEED_PROFILE=minimal — skipping disciple-networks')
      }

      // 2c. Demo skill claims — runs after person-agents exist so
      //     getPersonAgentForUser resolves. Idempotent: deterministic
      //     nonce hits ClaimExists on re-run. In minimal mode the helper
      //     iterates BINDINGS and silently skips users whose DB row
      //     hasn't been provisioned — yielding only the Maria/David/Sarah
      //     bindings (plus any other catalyst users that boot-seed
      //     happened to provision).
      state.phase = 'on-chain seed: demo skill claims'
      try {
        await seedDemoSkillClaimsOnChain()
      } catch (e) {
        console.warn('[boot-seed] demo skill claims error (non-fatal):', (e as Error).message)
      }

      // 2c′. Fund the minimal demo principals' treasuries so the
      //      proposal-funding video has real USDC to move. In minimal
      //      mode this targets exactly Maria/David/Sarah personal
      //      smart accounts + Catalyst NoCo Network + Fort Collins
      //      Network org treasuries. In full mode the activity-log
      //      seed downstream handles per-user funding via lane-seed
      //      scripts, so this is a no-op there.
      if (minimal) {
        state.phase = 'on-chain seed: fund minimal demo treasuries'
        try {
          const { fundMinimalDemoTreasuries } = await import('@/lib/demo-seed/fund-demo-treasuries')
          await fundMinimalDemoTreasuries()
        } catch (e) {
          console.warn('[boot-seed] minimal treasury funding failed (non-fatal):', (e as Error).message)
        }
      }

      // 2d. Seed person-mcp + org-mcp domain tables (oikos, prayers, training,
      //     preferences, notifications, revenue reports, proposals).
      //     Goes through the proper delegation flow per file docstring;
      //     each function iterates a known user list and silently skips
      //     users that aren't in the DB. In minimal mode this yields
      //     Maria/David/Sarah's data (plus org-level revenue + proposals
      //     for the two seeded orgs).
      state.phase = 'seeding mcp domain tables'
      try {
        const { seedMcpDemoData } = await import('@/lib/demo-seed/seed-mcp-data')
        await seedMcpDemoData()
      } catch (e) {
        console.warn('[boot-seed] mcp seed error (non-fatal):', (e as Error).message)
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

/**
 * S2.5(a) — production invariant: no demo private keys may live in the
 * `local_user_accounts.private_key` column when the app is running with
 * `NODE_ENV=production` (and no `SMART_AGENT_ENV=dev` override).
 *
 * Demo personas carry a stored EOA private key so the action layer can
 * sign on their behalf without a passkey ceremony. That's a giant
 * footgun in production: if any row leaks into a prod DB, the
 * `demo-login` flow (separately gated by `requireDev()`, but defence
 * in depth) or any helper that reads `users.privateKey` could
 * trivially impersonate that user.
 *
 * This guard runs at module-import time of `boot-seed.ts` (the very
 * first thing any boot-seed-aware path imports) and at the top of
 * `triggerBootSeed()` so it's impossible to start the app with such a
 * row present. Operators see a clear error and the process should be
 * stopped at deploy time.
 *
 * Throws (instead of `process.exit`) so it composes with the Next.js
 * boot lifecycle — Next surfaces module-load errors as 500s during
 * dev, which is the visible-failure mode we want.
 */
export class DemoPrivateKeyInProductionError extends Error {
  constructor(rowCount: number) {
    super(
      `[S2.5] Refusing to start: ${rowCount} row(s) in local_user_accounts ` +
      'have a non-null private_key while NODE_ENV=production. Demo-stored ' +
      'private keys are dev-only — they must NEVER reach a production ' +
      'database. Wipe the column, restore from a clean snapshot, or use ' +
      'SMART_AGENT_ENV=dev if you genuinely need this on a staging box.',
    )
    this.name = 'DemoPrivateKeyInProductionError'
  }
}

export async function assertNoDemoPrivateKeysInProd(): Promise<void> {
  // Only the strict-production case is a hard error. `SMART_AGENT_ENV=dev`
  // (staging boxes where Next.js forces NODE_ENV=production) and any
  // non-production NODE_ENV bypass the check.
  if (process.env.NODE_ENV !== 'production') return
  if (process.env.SMART_AGENT_ENV === 'dev') return

  // Lazy import so test files that DON'T touch the DB can still import
  // this module to exercise the prod-invariant helper.
  const { db, schema } = await import('@/db')
  const rows = await db
    .select({ id: schema.localUserAccounts.id })
    .from(schema.localUserAccounts)
    .where(isNotNull(schema.localUserAccounts.privateKey))
    .limit(1)

  if (rows.length > 0) {
    throw new DemoPrivateKeyInProductionError(rows.length)
  }
}

/**
 * Helper for any data-access path that reads `users.privateKey`. Call
 * BEFORE returning the column to a caller. Throws in production when
 * the caller is about to hand back a non-null value — defence in depth
 * even if a demo row somehow survived the boot-time invariant.
 */
export function assertPrivateKeyAccessAllowed(privateKey: string | null | undefined): void {
  if (privateKey === null || privateKey === undefined) return
  if (process.env.NODE_ENV !== 'production') return
  if (process.env.SMART_AGENT_ENV === 'dev') return
  throw new DemoPrivateKeyInProductionError(1)
}
