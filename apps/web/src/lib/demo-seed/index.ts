import { DEMO_USERS } from '@/lib/auth/session'

/**
 * Auto-seed demo community data when a demo user logs in.
 * For Catalyst: deploys agents + creates relationships ON-CHAIN.
 * Requires anvil + deployed contracts to be running.
 */
export async function ensureDemoCommunitySeeded(demoUserKey: string) {
  const user = DEMO_USERS[demoUserKey]
  if (!user) return

  if (demoUserKey.startsWith('cpm-')) {
    const { seedCpmCommunity } = await import('./seed-cpm')
    seedCpmCommunity()
  }
  if (demoUserKey.startsWith('cat-')) {
    const { seedCatalystOnChain } = await import('./seed-catalyst-onchain')
    // Run in background — don't block the login response.
    // The seed is idempotent so it's safe to run concurrently.
    seedCatalystOnChain().catch(err => console.warn('[demo-seed] Catalyst seed error:', err))
  }
}
