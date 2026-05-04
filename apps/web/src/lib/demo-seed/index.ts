import { DEMO_USER_META } from '@/lib/auth/session'
import { seedCatalystOnChain } from './seed-catalyst-onchain'
import { seedCILOnChain } from './seed-cil-onchain'
import { seedGlobalChurchOnChain } from './seed-globalchurch-onchain'
import { seedMultiplyData } from './seed-multiply-data'
import { seedMcpDemoData } from './seed-mcp-data'
import { ensureCommunityUsers } from './lookup-users'

/**
 * Ensure demo community is fully seeded — real wallets + on-chain agents.
 * Called on first demo login.
 *
 * Flow:
 *   1. Ensure all users in the community have real wallets + deployed AgentAccounts
 *   2. Fire on-chain seeding (orgs, relationships, edges) in background
 *   3. Seed personal app data (oikos, prayers, training)
 */
export async function ensureDemoCommunitySeeded(demoUserKey: string) {
  const meta = DEMO_USER_META[demoUserKey]
  if (!meta) return

  // Determine community prefix from hubId
  const communityPrefix = meta.hubId === 'global-church' ? 'gc-user-'
    : meta.hubId === 'catalyst' ? 'cat-user-'
    : meta.hubId === 'cil' ? 'cil-user-'
    : null

  // Ensure all users in this community have real wallets
  if (communityPrefix) {
    try {
      await ensureCommunityUsers(communityPrefix)
    } catch (err) {
      console.warn('[demo-seed] Community wallet provisioning failed:', err)
    }
  }

  // Fire on-chain seeding in background (idempotent, concurrent-safe)
  if (meta.hubId === 'global-church') {
    seedGlobalChurchOnChain().catch(err =>
      console.warn('[demo-seed] Global.Church on-chain seeding failed:', err)
    )
  } else if (meta.hubId === 'cil') {
    seedCILOnChain().catch(err =>
      console.warn('[demo-seed] CIL on-chain seeding failed:', err)
    )
  } else if (meta.hubId === 'catalyst') {
    seedCatalystOnChain().catch(err =>
      console.warn('[demo-seed] Catalyst on-chain seeding failed:', err)
    )
  }

  // Seed remaining web-SQL demo data (training catalog, etc.)
  seedMultiplyData()

  // Seed person-mcp + org-mcp domain tables (oikos, prayers, training,
  // preferences, notifications, revenue reports, proposals). Direct
  // SQLite write — bypasses delegation flow for demo.
  try {
    await seedMcpDemoData()
  } catch (err) {
    console.warn('[demo-seed] MCP seed failed:', (err as Error).message)
  }

  // People-group MCP seed (catalyst only for v1 — Wolof concept + Senegal/Dakar
  // segments + multi-source estimates + reachedness + community + geometry).
  // Runs after the catalyst on-chain seed has had a chance to deploy
  // Senegal Wolof Outreach + cross-delegations.
  if (meta.hubId === 'catalyst') {
    try {
      const { seedPeopleGroupsDemoData } = await import('./seed-people-groups-data')
      const { listRegisteredAgents } = await import('@/lib/agent-resolver')
      const agents = await listRegisteredAgents()
      const swo = agents.find(a => a.name === 'Senegal Wolof Outreach')
      if (swo) {
        await seedPeopleGroupsDemoData({ orgAddress: swo.address })
      } else {
        console.log('[demo-seed] Senegal Wolof Outreach not yet on-chain; PG seed deferred to next demo-login')
      }
    } catch (err) {
      console.warn('[demo-seed] People-group seed failed:', (err as Error).message)
    }
  }
}
