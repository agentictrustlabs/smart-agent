/**
 * Spec 002 — Intent Marketplace (Pool Lane). Multi-pool demo seed.
 *
 * Phase 0.3 — exercises the new on-chain attribute store path:
 *   1. Deploy a dedicated AgentAccount per pool via AgentAccountFactory.
 *   2. Call PoolRegistry.open(...) to write pool body into the shared
 *      PoolRegistry's own typed-attribute storage (with shape validation).
 *   3. Initialize the aggregate-counter row in org-mcp.db (slimmed schema).
 *   4. INSERT DATA into GraphDB so the /h/catalyst/pools index has data
 *      until the diff-aware attribute-walking emitter ships in
 *      Phase 0.6 cleanup.
 *
 *   pnpm exec tsx scripts/seed-test-pool.ts
 *
 * Idempotent: if PoolRegistry.open reverts on already-set required keys
 * (subjectVersion > 0), the seed continues. SQL insert uses INSERT OR
 * REPLACE on stable ids.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createWalletClient, createPublicClient, http,
  keccak256, toBytes, toHex,
  type Address, type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const envFile = path.join(repoRoot, 'apps/web/.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = value
  }
}

const RPC_URL = process.env.RPC_URL!
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex
const FACTORY_ADDR = process.env.AGENT_FACTORY_ADDRESS as Address
const POOL_REGISTRY_ADDR = process.env.POOL_REGISTRY_ADDRESS as Address | undefined

if (!RPC_URL || !DEPLOYER_KEY || !FACTORY_ADDR) {
  throw new Error('seed-test-pool: RPC_URL / DEPLOYER_PRIVATE_KEY / AGENT_FACTORY_ADDRESS required in apps/web/.env')
}
if (!POOL_REGISTRY_ADDR) {
  throw new Error('seed-test-pool: POOL_REGISTRY_ADDRESS not set — run scripts/fresh-start.sh first')
}

const NOW = new Date().toISOString()

interface PoolSeed {
  id: string
  name: string
  domain: string
  mandate: string
  governance: 'fund' | 'open-call' | 'giving-circle' | 'daf'
  acceptedRestrictions: { kinds?: string[]; geoRoots?: string[]; notForAdmin?: boolean }
  acceptedKinds: string[]
  acceptedUnits: string[]
  ceilingPolicy: 'block' | 'waitlist' | 'accept'
}

const POOLS: PoolSeed[] = [
  {
    id: 'demo-trauma-care-pool',
    name: 'Trauma-Care + Migrant Family Compassion Pool',
    domain: 'funding',
    mandate: 'Compassion-ministry funding for trauma-care training, migrant-family support, and church-based crisis response in Northern Colorado. Donors may restrict by kind / geo or accept the open compassion mandate.',
    governance: 'fund',
    acceptedRestrictions: {
      kinds: ['trauma-care', 'CompassionMinistry', 'MigrantFamilyCare', 'leader-care'],
      geoRoots: ['us/colorado', 'us/wyoming'],
      notForAdmin: true,
    },
    acceptedKinds: ['sa:GivingKind', 'sa:CompassionMinistry'],
    acceptedUnits: ['USD'],
    ceilingPolicy: 'accept',
  },
  {
    id: 'demo-spanish-bibles-pool',
    name: 'Spanish Bibles for New Families Pool',
    domain: 'funding',
    mandate: 'Heart-language scripture distribution for first-generation Spanish-speaking families in NoCo.',
    governance: 'fund',
    acceptedRestrictions: {
      kinds: ['HeartLanguageScripture', 'BibleStudy', 'Discipleship'],
      geoRoots: ['us/colorado'],
      notForAdmin: true,
    },
    acceptedKinds: ['sa:GivingKind', 'sa:Discipleship'],
    acceptedUnits: ['USD'],
    ceilingPolicy: 'accept',
  },
  {
    id: 'demo-prayer-chain-pool',
    name: 'Hispanic Family Prayer Chain Pool',
    domain: 'prayer',
    mandate: 'Standing prayer commitments for migrant families, church-plant catalysts, and discipleship circles across Northern Colorado.',
    governance: 'open-call',
    acceptedRestrictions: {
      kinds: ['PrayerCommitment', 'Intercession', 'DailyPrayer'],
      geoRoots: ['us/colorado'],
    },
    acceptedKinds: ['sa:PrayerKind', 'sa:Intercession'],
    acceptedUnits: ['prayer-minutes'],
    ceilingPolicy: 'accept',
  },
]

async function loadSdk() {
  return await import(path.join(repoRoot, 'packages/sdk/src/index.ts')) as {
    PoolRegistryClient: new (cfg: {
      registryAddress: Address
      walletClient: ReturnType<typeof createWalletClient>
      publicClient: ReturnType<typeof createPublicClient>
    }) => {
      open: (input: {
        poolAgent: Address
        domain: string
        governanceModel: 'fund' | 'open-call' | 'giving-circle' | 'daf'
        mandateHash: Hex
        mandateURI?: string
        acceptedUnits?: string[]
        acceptedKinds: string[]
        ceilingPolicy: 'block' | 'waitlist' | 'accept'
        capacityCeiling?: bigint
        stewards: Address[]
        visibility: 'public' | 'private'
      }) => Promise<Hex>
    }
    agentAccountFactoryAbi: readonly unknown[]
  }
}

async function deployPoolAgent(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  factoryAbi: readonly unknown[],
  ownerAddr: Address,
  salt: bigint,
): Promise<Address> {
  const deployerAccount = walletClient.account!
  const txHash = await walletClient.writeContract({
    address: FACTORY_ADDR,
    abi: factoryAbi,
    functionName: 'createAccount',
    args: [ownerAddr, salt],
    account: deployerAccount,
    chain: walletClient.chain ?? null,
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash })
  // Read deterministic address (createAccount returns it but receipt parsing
  // is fiddly — call the view-side getAddress instead).
  const computed = await publicClient.readContract({
    address: FACTORY_ADDR,
    abi: factoryAbi,
    functionName: 'getAddress',
    args: [ownerAddr, salt],
  }) as Address
  return computed
}

async function openSqlite(dbPath: string) {
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => {
    prepare: (sql: string) => { run: (params: Record<string, unknown>) => void }
    close: () => void
  } }).default
  return new Database(dbPath)
}

async function seedSqlCounters(deployedPools: Array<{ pool: PoolSeed; treasuryAddress: Address }>): Promise<void> {
  const dbPath = path.join(repoRoot, 'apps/org-mcp/org-mcp.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-pool] ${dbPath} does not exist — skipping SQL insert`)
    return
  }
  const db = await openSqlite(dbPath)
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO pools (
        id, treasury_address, name, accepted_restrictions, accepted_units,
        capacity_ceiling, ceiling_policy, visibility, addressed_members, stewards,
        pledged_total, allocated_total, available_total,
        created_at, updated_at
      ) VALUES (
        @id, @treasury_address, @name, @accepted_restrictions, @accepted_units,
        @capacity_ceiling, @ceiling_policy, @visibility, @addressed_members, @stewards,
        @pledged_total, @allocated_total, @available_total,
        @created_at, @updated_at
      )
    `)
    for (const { pool, treasuryAddress } of deployedPools) {
      const iri = `urn:smart-agent:pool:${pool.id}`
      stmt.run({
        id: iri,
        treasury_address: treasuryAddress,
        name: pool.name,
        accepted_restrictions: JSON.stringify(pool.acceptedRestrictions),
        accepted_units: JSON.stringify(pool.acceptedUnits),
        capacity_ceiling: null,
        ceiling_policy: pool.ceilingPolicy,
        visibility: 'public',
        addressed_members: null,
        stewards: JSON.stringify([treasuryAddress]),
        pledged_total: 0,
        allocated_total: 0,
        available_total: 0,
        created_at: NOW,
        updated_at: NOW,
      })
      console.log(`[seed-test-pool] SQL ok — ${pool.id} (${pool.name})`)
    }
  } finally {
    db.close()
  }
}

async function seedGraphDB(deployedPools: Array<{ pool: PoolSeed; treasuryAddress: Address }>): Promise<void> {
  const baseUrl = process.env.GRAPHDB_BASE_URL
  const repository = process.env.GRAPHDB_REPOSITORY
  const username = process.env.GRAPHDB_USERNAME
  const password = process.env.GRAPHDB_PASSWORD
  if (!baseUrl || !repository || !username || !password) {
    console.warn('[seed-test-pool] GraphDB env not set — SQL-only seed (still usable in dev)')
    return
  }
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const url = `${baseUrl}/repositories/${repository}/statements`

  const triples = deployedPools.map(({ pool, treasuryAddress }) => {
    const iri = `urn:smart-agent:pool:${pool.id}`
    const escMandate = pool.mandate.replace(/"/g, '\\"').replace(/\n/g, '\\n')
    const unitTriples = pool.acceptedUnits.map(u => `      sa:acceptsUnit "${u}" ;`).join('\n')
    return `
    <${iri}> a sa:Pool ;
      sa:displayName "${pool.name.replace(/"/g, '\\"')}" ;
      sa:domain "${pool.domain}" ;
      sa:poolMandate "${escMandate}" ;
      sa:governanceModel "${pool.governance}" ;
${unitTriples}
      sa:ceilingPolicy "${pool.ceilingPolicy}" ;
      sa:visibility "public" ;
      sa:treasuryAddress "${treasuryAddress}" ;
      sa:steward <eth:${treasuryAddress.toLowerCase()}> ;
      sa:acceptsOpenCalls true ;
      sa:pledgedTotal 0 ;
      sa:allocatedTotal 0 ;
      sa:availableTotal 0 .
`
  }).join('\n')

  const sparql = `
PREFIX sa: <https://smartagent.io/ontology/core#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

INSERT DATA {
  GRAPH <https://smartagent.io/graph/data/onchain> {
${triples}
  }
}
`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-update', Authorization: auth },
    body: sparql,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SPARQL UPDATE failed (${response.status}): ${body}`)
  }
  console.log(`[seed-test-pool] GraphDB ok — INSERT ${deployedPools.length} pools into data graph`)
}

async function main(): Promise<void> {
  const sdk = await loadSdk()
  const account = privateKeyToAccount(DEPLOYER_KEY)
  const walletClient = createWalletClient({ account, chain: undefined, transport: http(RPC_URL) })
  const publicClient = createPublicClient({ chain: undefined, transport: http(RPC_URL) })

  const client = new sdk.PoolRegistryClient({
    registryAddress: POOL_REGISTRY_ADDR!,
    walletClient,
    publicClient,
  })

  const deployedPools: Array<{ pool: PoolSeed; treasuryAddress: Address }> = []

  for (const pool of POOLS) {
    const salt = BigInt(keccak256(toBytes(`pool:${pool.id}`)))
    const treasuryAddress = await deployPoolAgent(
      walletClient, publicClient, sdk.agentAccountFactoryAbi, account.address, salt,
    )
    console.log(`[seed-test-pool] deployed pool agent ${pool.id} → ${treasuryAddress}`)

    const mandateHash = keccak256(toHex(JSON.stringify({
      narrative: pool.mandate,
      acceptedRestrictions: pool.acceptedRestrictions,
    })))

    try {
      const txHash = await client.open({
        poolAgent: treasuryAddress,
        domain: pool.domain,
        governanceModel: pool.governance,
        mandateHash,
        mandateURI: '',
        acceptedUnits: pool.acceptedUnits,
        acceptedKinds: pool.acceptedKinds,
        ceilingPolicy: pool.ceilingPolicy,
        capacityCeiling: 0n,
        stewards: [treasuryAddress],
        visibility: 'public',
      })
      console.log(`[seed-test-pool] PoolRegistry.open ok — ${pool.id} → tx ${txHash}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // If the pool is already opened (re-seed), continue.
      console.warn(`[seed-test-pool] PoolRegistry.open warn for ${pool.id}: ${msg}`)
    }

    deployedPools.push({ pool, treasuryAddress })
  }

  await seedSqlCounters(deployedPools)
  await seedGraphDB(deployedPools)

  console.log(`\n✓ Seeded ${POOLS.length} pools operated by Catalyst NoCo Network:`)
  for (const { pool, treasuryAddress } of deployedPools) {
    console.log(`    · ${pool.id} — ${pool.name}  (treasury ${treasuryAddress})`)
  }
  console.log(`  Visit: http://localhost:3000/h/catalyst/pools (after Maria signs in)`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
