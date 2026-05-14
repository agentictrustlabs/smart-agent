#!/usr/bin/env tsx
/**
 * Repair script — register any Pool AgentAccount that's missing from
 * AgentAccountResolver. Spec-006 invariant: every pool's treasury must
 * resolve to a displayName + type so round detail / proposal timeline /
 * agent graph pages render correctly.
 *
 *   pnpm exec tsx scripts/repair-pool-registration.ts
 *
 * Idempotent — skips pools that are already registered.
 *
 * Signing: each pool was deployed with a known owner. For the demo
 * grant-flow pools (which are owned by Maria's EOA), we load her key
 * from `apps/web/local.db`. For pools created via the runtime `pool:create`
 * flow (owned by an org's AgentAccount), we skip with a warning — those
 * have to be repaired via an authenticated session, not a one-shot script.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createWalletClient, createPublicClient, http,
  keccak256, toBytes, type Address, type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const envFile = path.join(repoRoot, 'apps/web/.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

const RPC = process.env.RPC_URL!
const RESOLVER = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address
const POOL_REG = process.env.POOL_REGISTRY_ADDRESS as Address

const pub = createPublicClient({ chain: foundry, transport: http(RPC) })

async function loadSdk() {
  return await import(path.join(repoRoot, 'packages/sdk/src/index.ts')) as typeof import('../packages/sdk/src/index.js')
}

async function loadMariaKey(): Promise<{ privateKey: Hex; eoa: Address } | null> {
  try {
    const Database = (await import(path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')) as { default: new (path: string) => unknown }).default as new (p: string) => {
      prepare: (sql: string) => { get: (params: unknown) => unknown }
      close: () => void
    }
    const db = new Database(path.join(repoRoot, 'apps/web/local.db'))
    const row = db.prepare('SELECT private_key FROM local_user_accounts WHERE id = ?').get('cat-user-001') as { private_key: string } | undefined
    db.close()
    if (!row) return null
    const privateKey = row.private_key as Hex
    const eoa = privateKeyToAccount(privateKey).address
    return { privateKey, eoa }
  } catch {
    return null
  }
}

async function main() {
  const sdk = await loadSdk()
  const TYPE_POOL_AGENT = keccak256(toBytes('atl:PoolAgent'))
  const ZERO_HASH = ('0x' + '0'.repeat(64)) as Hex
  const SA_POOL_OPENED_AT = keccak256(toBytes('sa:poolOpenedAt'))
  const SA_POOL_SLUG = keccak256(toBytes('sa:poolSlug'))

  console.log('STEP 1 — discover pool AgentAccounts from PoolRegistry.allSubjects()')
  const poolSubjects = await pub.readContract({
    address: POOL_REG, abi: sdk.poolRegistryAbi, functionName: 'allSubjects',
  }) as readonly Hex[]
  console.log(`  found ${poolSubjects.length} pool subjects on chain`)

  // Each pool's subject = uint256(uint160(poolAgent)) — the address is
  // recoverable from the low 20 bytes of the subject.
  const candidates: Array<{ poolAgent: Address; slug: string }> = []
  for (const subj of poolSubjects) {
    const isPool = await pub.readContract({
      address: POOL_REG, abi: sdk.poolRegistryAbi, functionName: 'isSet',
      args: [subj, SA_POOL_OPENED_AT],
    }) as boolean
    if (!isPool) continue
    const poolAgent = `0x${subj.slice(26).toLowerCase()}` as Address
    let slug = ''
    try {
      slug = await pub.readContract({
        address: POOL_REG, abi: sdk.poolRegistryAbi, functionName: 'getString',
        args: [subj, SA_POOL_SLUG],
      }) as string
    } catch { /* slug optional */ }
    candidates.push({ poolAgent, slug: slug || `pool-${poolAgent.slice(0, 8)}` })
  }
  console.log(`  ${candidates.length} candidates after isSet(sa:poolOpenedAt)`)

  console.log('\nSTEP 2 — filter to unregistered pools')
  const unregistered: Array<{ poolAgent: Address; slug: string }> = []
  for (const c of candidates) {
    const isReg = await pub.readContract({
      address: RESOLVER, abi: sdk.agentAccountResolverAbi,
      functionName: 'isRegistered', args: [c.poolAgent],
    }) as boolean
    if (!isReg) unregistered.push(c)
  }
  console.log(`  ${unregistered.length} unregistered`)
  if (unregistered.length === 0) {
    console.log('\n✓ all pools already registered')
    return
  }

  const maria = await loadMariaKey()
  if (!maria) {
    console.error('Maria\'s key not found in local.db — cannot sign register calls')
    process.exit(1)
  }
  const wallet = createWalletClient({
    account: privateKeyToAccount(maria.privateKey),
    chain: foundry, transport: http(RPC),
  })

  console.log(`\nSTEP 3 — register from Maria's EOA (${maria.eoa.slice(0, 10)}…)`)
  let registered = 0
  let skipped = 0
  for (const { poolAgent, slug } of unregistered) {
    // Verify Maria's EOA actually owns this pool before attempting.
    let isOwner = false
    try {
      isOwner = await pub.readContract({
        address: poolAgent, abi: sdk.agentAccountAbi, functionName: 'isOwner', args: [maria.eoa],
      }) as boolean
    } catch { /* not an AgentAccount? skip */ }
    if (!isOwner) {
      console.log(`  skip ${slug} @ ${poolAgent} — Maria not an owner (probably a runtime-created pool; use UI / authenticated repair)`)
      skipped++
      continue
    }
    try {
      const displayName = slug.startsWith('demo-grant-flow-pool-')
        ? `Demo Grant Flow Pool #${slug.split('-').pop()}`
        : slug
      const tx = await wallet.writeContract({
        address: RESOLVER, abi: sdk.agentAccountResolverAbi,
        functionName: 'register',
        args: [poolAgent, displayName, `Repaired registration for ${slug}`, TYPE_POOL_AGENT, ZERO_HASH, ''],
      })
      await pub.waitForTransactionReceipt({ hash: tx })
      console.log(`  ✓ ${slug} @ ${poolAgent} → "${displayName}"`)
      registered++
    } catch (e) {
      console.warn(`  ✗ ${slug} @ ${poolAgent}: ${(e as Error).message.slice(0, 160)}`)
    }
  }

  console.log(`\n══════ DONE ══════`)
  console.log(`  registered: ${registered}`)
  console.log(`  skipped:    ${skipped}`)

  if (registered > 0) {
    try {
      const mod = await import(path.join(repoRoot, 'apps/web/src/lib/ontology/graphdb-sync.ts')) as { syncOnChainToGraphDB: () => Promise<unknown> }
      await mod.syncOnChainToGraphDB()
      console.log('  GraphDB sync ✓')
    } catch (e) {
      console.warn('  GraphDB sync warning:', (e as Error).message.slice(0, 160))
    }
  }
}

main().catch((e) => { console.error('repair failed:', e); process.exit(1) })
