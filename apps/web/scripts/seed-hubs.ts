/**
 * One-shot: run catalyst + CIL hub seeds in parallel without waiting for
 * the boot-seed module's sequential gc → cat → cil loop. The seeds are
 * idempotent and have their own per-hub re-entry locks, so this is safe
 * to run while the boot-seed is still chewing on global.church.
 *
 *   pnpm --filter @smart-agent/web exec tsx scripts/seed-hubs.ts
 */
import { seedCatalystOnChain } from '../src/lib/demo-seed/seed-catalyst-onchain'
import { seedCILOnChain } from '../src/lib/demo-seed/seed-cil-onchain'

async function main() {
  console.log('[seed-hubs] kicking off catalyst + cil in parallel…')
  const results = await Promise.allSettled([
    seedCatalystOnChain().then(() => '[catalyst] done'),
    seedCILOnChain().then(() => '[cil] done'),
  ])
  for (const r of results) {
    if (r.status === 'fulfilled') console.log(r.value)
    else console.error('[seed-hubs] FAILED:', r.reason)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
