/**
 * Demo seed — multiple grant rounds under Catalyst NoCo Network.
 *
 * Phase 0.4 — exercises the new on-chain attribute store path:
 *   1. Pool 0 from seed-test-pool.ts is treated as the operating fund.
 *      We register it as a Fund + open each round via FundRegistry.openRound.
 *   2. Body lives on chain in FundRegistry's typed-attribute storage.
 *   3. org-mcp.db rounds row is the denormalized cache for the proposal-flow
 *      hot path (validation, addressed-applicants).
 *   4. INSERT DATA into GraphDB so /h/catalyst/rounds renders before the
 *      attribute-walking emitter ships.
 *
 *   pnpm exec tsx scripts/seed-test-round.ts
 *
 * Idempotent at the SQL layer; FundRegistry.openRound reverts if a round
 * subject is already initialized — caught + logged so the script continues.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createWalletClient, createPublicClient, http,
  keccak256, toHex,
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
const FUND_REGISTRY_ADDR = process.env.FUND_REGISTRY_ADDRESS as Address | undefined

if (!RPC_URL || !DEPLOYER_KEY || !FACTORY_ADDR) {
  throw new Error('seed-test-round: RPC_URL / DEPLOYER_PRIVATE_KEY / AGENT_FACTORY_ADDRESS required in apps/web/.env')
}
if (!FUND_REGISTRY_ADDR) {
  throw new Error('seed-test-round: FUND_REGISTRY_ADDRESS not set — run scripts/fresh-start.sh first')
}

const NOW = new Date().toISOString()
const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()

interface RoundSeed {
  id: string
  displayName: string
  mandate: {
    acceptedKinds: string[]
    acceptedGeo: string[]
    budgetCeiling: number
    expectedAwards: number
  }
  milestone: {
    minMilestones: number
    maxMilestones: number
    trancheHints: { atKickoff: number; midpoint: number; completion: number }
  }
  validators: { minValidators: number }
  reportingCadence: 'monthly' | 'quarterly' | 'annual'
  deadline: string
  decisionDate: string
}

const ROUNDS: RoundSeed[] = [
  {
    id: 'demo-trauma-care-q2',
    displayName: 'Trauma-Care for Migrant Families — Compassion Ministry Q2',
    mandate: {
      acceptedKinds: ['trauma-care', 'CompassionMinistry', 'MigrantFamilyCare'],
      acceptedGeo: ['us/colorado'],
      budgetCeiling: 250000,
      expectedAwards: 6,
    },
    milestone: { minMilestones: 2, maxMilestones: 5, trancheHints: { atKickoff: 0.3, midpoint: 0.4, completion: 0.3 } },
    validators: { minValidators: 2 },
    reportingCadence: 'quarterly',
    deadline: days(14),
    decisionDate: days(30),
  },
  {
    id: 'demo-spanish-scripture-q2',
    displayName: 'Spanish Heart-Language Scripture & Discipleship Q2',
    mandate: {
      acceptedKinds: ['HeartLanguageScripture', 'BibleStudy', 'Discipleship'],
      acceptedGeo: ['us/colorado', 'us/wyoming'],
      budgetCeiling: 60000,
      expectedAwards: 8,
    },
    milestone: { minMilestones: 2, maxMilestones: 4, trancheHints: { atKickoff: 0.4, midpoint: 0.3, completion: 0.3 } },
    validators: { minValidators: 1 },
    reportingCadence: 'quarterly',
    deadline: days(21),
    decisionDate: days(45),
  },
  {
    id: 'demo-pastoral-coaching-q2',
    displayName: 'Pastoral Coaching Cohort for NoCo Church Planters Q2',
    mandate: {
      acceptedKinds: ['CircleCoach', 'PastoralCoaching', 'ChurchPlanting'],
      acceptedGeo: ['us/colorado'],
      budgetCeiling: 75000,
      expectedAwards: 3,
    },
    milestone: { minMilestones: 3, maxMilestones: 6, trancheHints: { atKickoff: 0.25, midpoint: 0.5, completion: 0.25 } },
    validators: { minValidators: 2 },
    reportingCadence: 'monthly',
    deadline: days(28),
    decisionDate: days(60),
  },
]

const CADENCE_CONCEPT: Record<RoundSeed['reportingCadence'], string> = {
  monthly: 'sa:CadenceMonthly',
  quarterly: 'sa:CadenceQuarterly',
  annual: 'sa:CadenceAnnual',
}

async function loadSdk() {
  return await import(path.join(repoRoot, 'packages/sdk/src/index.ts')) as {
    FundRegistryClient: new (cfg: {
      registryAddress: Address
      walletClient: ReturnType<typeof createWalletClient>
      publicClient: ReturnType<typeof createPublicClient>
    }) => {
      registerFund: (fundAgent: Address, acceptedKinds: string[], openForCalls: boolean) => Promise<Hex>
      openRound: (input: {
        roundId: string
        fundAgent: Address
        deadline: bigint
        decisionDate: bigint
        reportingCadence: string
        requiredCredentials?: string[]
        visibility: 'public' | 'private'
        initialStatus?: 'open' | 'review' | 'decided' | 'closed' | 'canceled'
      }) => Promise<{ txHash: Hex; roundSubject: Hex }>
    }
    agentAccountFactoryAbi: readonly unknown[]
  }
}

async function deployFundAgent(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  factoryAbi: readonly unknown[],
  ownerAddr: Address,
  salt: bigint,
): Promise<Address> {
  const account = walletClient.account!
  const txHash = await walletClient.writeContract({
    address: FACTORY_ADDR,
    abi: factoryAbi,
    functionName: 'createAccount',
    args: [ownerAddr, salt],
    account,
    chain: walletClient.chain ?? null,
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash })
  return await publicClient.readContract({
    address: FACTORY_ADDR,
    abi: factoryAbi,
    functionName: 'getAddress',
    args: [ownerAddr, salt],
  }) as Address
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

async function seedSqlCache(fundAgent: Address): Promise<void> {
  // Round body lives ON CHAIN in FundRegistry now; this seed script's
  // FundRegistry.openRound call (in main()) writes the canonical body. The
  // org-mcp `rounds` table is slim (voting config only) and auto-creates
  // rows when `round:update_voting_config` is first called — no SQL seed
  // needed for the body. Keep the function as a no-op for callsite stability.
  void fundAgent
  const dbPath = path.join(repoRoot, 'apps/org-mcp/org-mcp.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-round] ${dbPath} does not exist — skipping SQL seed`)
    return
  }
  const db = await openSqlite(dbPath)
  try {
    // Insert default voting config rows (steward-quorum, threshold=2) for
    // each demo round so the admin / vote pages work without an explicit
    // round:update_voting_config call.
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO rounds (
        id, voting_strategy, voting_threshold,
        voting_window_starts_at, voting_window_ends_at,
        eligible_voters, updated_at
      ) VALUES (
        @id, 'steward-quorum', 2,
        @voting_window_starts_at, @voting_window_ends_at,
        '{"kind":"stewards"}', @updated_at
      )
    `)
    for (const r of ROUNDS) {
      const iri = `urn:smart-agent:round:${r.id}`
      // Default voting window: opens at submission deadline, closes 7 days later.
      const windowStart = r.deadline
      const windowEnd = new Date(Date.parse(r.deadline) + 7 * 24 * 60 * 60 * 1000).toISOString()
      stmt.run({
        id: iri,
        voting_window_starts_at: windowStart,
        voting_window_ends_at: windowEnd,
        updated_at: NOW,
      })
      console.log(`[seed-test-round] SQL voting config ok — ${r.id} (${r.displayName})`)
    }
  } finally {
    db.close()
  }
}

async function seedGraphDB(fundAgent: Address): Promise<void> {
  const baseUrl = process.env.GRAPHDB_BASE_URL
  const repository = process.env.GRAPHDB_REPOSITORY
  const username = process.env.GRAPHDB_USERNAME
  const password = process.env.GRAPHDB_PASSWORD
  if (!baseUrl || !repository || !username || !password) {
    console.warn('[seed-test-round] GraphDB env not set — SQL-only seed')
    return
  }
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const url = `${baseUrl}/repositories/${repository}/statements`

  const triples = ROUNDS.map(r => {
    const iri = `urn:smart-agent:round:${r.id}`
    const escMandate = JSON.stringify(r.mandate).replace(/"/g, '\\"')
    const escMilestone = JSON.stringify(r.milestone).replace(/"/g, '\\"')
    const escValidator = JSON.stringify(r.validators).replace(/"/g, '\\"')
    return `
    <${iri}> a sa:Round ;
      sa:displayName "${r.displayName.replace(/"/g, '\\"')}" ;
      sa:operatedByFund <eth:${fundAgent.toLowerCase()}> ;
      sa:roundMandate "${escMandate}" ;
      sa:milestoneTemplate "${escMilestone}" ;
      sa:validatorRequirements "${escValidator}" ;
      sa:reportingCadence "${r.reportingCadence}" ;
      sa:deadline "${r.deadline}"^^xsd:dateTime ;
      sa:decisionDate "${r.decisionDate}"^^xsd:dateTime ;
      sa:requiredCredentials "[]" ;
      sa:visibility "public" ;
      sa:status "open" ;
      sa:proposalsReceived 0 .
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
  console.log(`[seed-test-round] GraphDB ok — INSERT ${ROUNDS.length} rounds`)
}

async function main(): Promise<void> {
  const sdk = await loadSdk()
  const account = privateKeyToAccount(DEPLOYER_KEY)
  const walletClient = createWalletClient({ account, chain: undefined, transport: http(RPC_URL) })
  const publicClient = createPublicClient({ chain: undefined, transport: http(RPC_URL) })

  // 1. Use the catalyst NoCo Network as the fund agent so Maria (governance
  //    owner of the network) can manage these rounds. The deployer is also
  //    a co-owner of the network, so registerFund + openRound will succeed.
  const fundAgent = '0x0F669E6851A15FD0E5904EB197c369C2ab578D9b' as Address
  console.log(`[seed-test-round] fund agent (catalyst network) → ${fundAgent}`)

  const client = new sdk.FundRegistryClient({
    registryAddress: FUND_REGISTRY_ADDR!,
    walletClient,
    publicClient,
  })

  // 2. Register the fund (idempotent — re-runs overwrite acceptedKinds).
  const acceptedKinds = Array.from(new Set(ROUNDS.flatMap(r => r.mandate.acceptedKinds)))
    .map(k => `sa:${k.replace(/[^a-zA-Z0-9]/g, '')}`)
  try {
    const tx = await client.registerFund(fundAgent, acceptedKinds, true)
    console.log(`[seed-test-round] FundRegistry.registerFund ok — tx ${tx}`)
  } catch (err) {
    console.warn(`[seed-test-round] registerFund warn: ${err instanceof Error ? err.message : err}`)
  }

  // 3. Open each round on chain.
  for (const r of ROUNDS) {
    try {
      const { txHash } = await client.openRound({
        roundId: r.id,
        fundAgent,
        deadline: BigInt(Math.floor(Date.parse(r.deadline) / 1000)),
        decisionDate: BigInt(Math.floor(Date.parse(r.decisionDate) / 1000)),
        reportingCadence: CADENCE_CONCEPT[r.reportingCadence],
        requiredCredentials: [],
        visibility: 'public',
        initialStatus: 'open',
        mandate: JSON.stringify(r.mandate ?? {}),
        milestoneTemplate: JSON.stringify(r.milestoneTemplate ?? {}),
        validatorRequirements: JSON.stringify(r.validatorRequirements ?? {}),
      })
      console.log(`[seed-test-round] FundRegistry.openRound ok — ${r.id} → tx ${txHash}`)
    } catch (err) {
      console.warn(`[seed-test-round] openRound warn for ${r.id}: ${err instanceof Error ? err.message : err}`)
    }
  }

  await seedSqlCache(fundAgent)
  await seedGraphDB(fundAgent)

  console.log(`\n✓ Seeded ${ROUNDS.length} rounds operated by fund ${fundAgent}:`)
  for (const r of ROUNDS) {
    console.log(`    · ${r.id} — ${r.displayName}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
