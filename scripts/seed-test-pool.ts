/**
 * Spec 002 — Intent Marketplace (Pool Lane). Multi-pool demo seed.
 *
 * Creates three faith-flavored pools under Catalyst NoCo Network so the
 * /h/catalyst/pools index has variety: a compassion-care fund, a Spanish
 * scripture distribution fund, and a non-monetary prayer-chain pool.
 *
 *   pnpm exec tsx scripts/seed-test-pool.ts
 *
 * Idempotent: INSERT OR REPLACE on stable ids; SPARQL INSERT DATA.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

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

const FUND_ADDRESS = '0x0F669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()
const FUND_AGENT_IRI = `https://smartagent.io/ontology/core#agent/${FUND_ADDRESS}`
const NOW = new Date().toISOString()

interface PoolSeed {
  id: string
  name: string
  domain: string
  mandate: string
  governanceModel: 'fund' | 'coaching-network' | 'prayer-chain'
  acceptedRestrictions: { kinds?: string[]; geoRoots?: string[]; notForAdmin?: boolean }
  acceptedUnits: string[]
  ceilingPolicy: 'block' | 'waitlist' | 'accept'
}

const POOLS: PoolSeed[] = [
  {
    id: 'demo-trauma-care-pool',
    name: 'Trauma-Care + Migrant Family Compassion Pool',
    domain: 'funding',
    mandate: 'Compassion-ministry funding for trauma-care training, migrant-family support, and church-based crisis response in Northern Colorado. Donors may restrict by kind / geo or accept the open compassion mandate.',
    governanceModel: 'fund',
    acceptedRestrictions: {
      kinds: ['trauma-care', 'CompassionMinistry', 'MigrantFamilyCare', 'leader-care'],
      geoRoots: ['us/colorado', 'us/wyoming'],
      notForAdmin: true,
    },
    acceptedUnits: ['USD'],
    ceilingPolicy: 'accept',
  },
  {
    id: 'demo-spanish-bibles-pool',
    name: 'Spanish Bibles for New Families Pool',
    domain: 'funding',
    mandate: 'Heart-language scripture distribution for first-generation Spanish-speaking families in NoCo. Funds bilingual Bibles, study guides, and host-family curriculum kits. Stewards prioritize newly-formed circles in church-plant catchments.',
    governanceModel: 'fund',
    acceptedRestrictions: {
      kinds: ['HeartLanguageScripture', 'BibleStudy', 'Discipleship'],
      geoRoots: ['us/colorado'],
      notForAdmin: true,
    },
    acceptedUnits: ['USD'],
    ceilingPolicy: 'accept',
  },
  {
    id: 'demo-prayer-chain-pool',
    name: 'Hispanic Family Prayer Chain Pool',
    domain: 'prayer',
    mandate: 'Standing prayer commitments for migrant families, church-plant catalysts, and discipleship circles across Northern Colorado. Donors pledge prayer minutes (not money); the steward routes specific intercession requests to the chain.',
    governanceModel: 'prayer-chain',
    acceptedRestrictions: {
      kinds: ['PrayerCommitment', 'Intercession', 'DailyPrayer'],
      geoRoots: ['us/colorado'],
    },
    acceptedUnits: ['prayer-minutes'],
    ceilingPolicy: 'accept',
  },
]

async function openSqlite(dbPath: string) {
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => {
    prepare: (sql: string) => { run: (params: Record<string, unknown>) => void }
    close: () => void
  } }).default
  return new Database(dbPath)
}

async function seedSql(): Promise<void> {
  const dbPath = path.join(repoRoot, 'apps/org-mcp/org-mcp.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-pool] ${dbPath} does not exist — skipping SQL insert`)
    return
  }
  const db = await openSqlite(dbPath)
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO pools (
        id, org_principal, name, domain, mandate, governance_model,
        accepted_restrictions, accepted_units, capacity_ceiling, ceiling_policy,
        addressed_to, addressed_members, visibility, stewardship_agent, stewards,
        accepts_open_calls, pledged_total, allocated_total, available_total,
        on_chain_assertion_id, created_at, updated_at
      ) VALUES (
        @id, @org_principal, @name, @domain, @mandate, @governance_model,
        @accepted_restrictions, @accepted_units, @capacity_ceiling, @ceiling_policy,
        @addressed_to, @addressed_members, @visibility, @stewardship_agent, @stewards,
        @accepts_open_calls, @pledged_total, @allocated_total, @available_total,
        @on_chain_assertion_id, @created_at, @updated_at
      )
    `)
    for (const p of POOLS) {
      const iri = `urn:smart-agent:pool:${p.id}`
      stmt.run({
        id: iri,
        org_principal: FUND_ADDRESS,
        name: p.name,
        domain: p.domain,
        mandate: p.mandate,
        governance_model: p.governanceModel,
        accepted_restrictions: JSON.stringify(p.acceptedRestrictions),
        accepted_units: JSON.stringify(p.acceptedUnits),
        capacity_ceiling: null,
        ceiling_policy: p.ceilingPolicy,
        addressed_to: 'hub:catalyst',
        addressed_members: null,
        visibility: 'public',
        stewardship_agent: FUND_AGENT_IRI,
        stewards: JSON.stringify([FUND_AGENT_IRI]),
        accepts_open_calls: 1,
        pledged_total: 0,
        allocated_total: 0,
        available_total: 0,
        on_chain_assertion_id: null,
        created_at: NOW,
        updated_at: NOW,
      })
      console.log(`[seed-test-pool] SQL ok — ${p.id} (${p.name})`)
    }
  } finally {
    db.close()
  }
}

async function seedGraphDB(): Promise<void> {
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

  const triples = POOLS.map(p => {
    const iri = `urn:smart-agent:pool:${p.id}`
    const escMandate = p.mandate.replace(/"/g, '\\"').replace(/\n/g, '\\n')
    const escRestrictions = JSON.stringify(p.acceptedRestrictions).replace(/"/g, '\\"')
    const unitTriples = p.acceptedUnits.map(u => `      sa:acceptsUnit "${u}" ;`).join('\n')
    return `
    <${iri}> a sa:Pool ;
      sa:displayName "${p.name.replace(/"/g, '\\"')}" ;
      sa:domain "${p.domain}" ;
      sa:poolMandate "${escMandate}" ;
      sa:governanceModel "${p.governanceModel}" ;
      sa:acceptedRestrictions "${escRestrictions}" ;
${unitTriples}
      sa:ceilingPolicy "${p.ceilingPolicy}" ;
      sa:addressedTo "hub:catalyst" ;
      sa:visibility "public" ;
      sa:stewardshipAgent <${FUND_AGENT_IRI}> ;
      sa:steward <${FUND_AGENT_IRI}> ;
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
  console.log(`[seed-test-pool] GraphDB ok — INSERT ${POOLS.length} pools into data graph`)
}

/**
 * Treasury Phase 1 — anchor each seeded pool with `sa:PoolOpenedAssertion`.
 * The treasury address is left as a placeholder (the demo pools are
 * org-mcp rows, not deployed AgentAccounts) until Phase 2 wires real
 * factory-deployed pool agents. Public-tier payload carries mandate
 * detail; private pools would emit a coarse variant — none seeded yet.
 */
async function emitPoolAnchors(): Promise<void> {
  const rpcUrl = process.env.RPC_URL
  const contractAddress = process.env.CLASS_ASSERTION_ADDRESS
  const operatorPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!rpcUrl || !contractAddress || !operatorPrivateKey) {
    console.warn('[seed-test-pool] anchor emit skipped — missing env')
    return
  }
  // Import the SDK by file path — same reasoning as seed-test-round.ts.
  const sdk = await import(path.join(repoRoot, 'packages/sdk/src/index.ts')) as {
    emitClassAssertion: (
      cfg: { rpcUrl: string; contractAddress: `0x${string}`; operatorPrivateKey: `0x${string}` },
      input: { classIri: string; subjectIri: string; payload: Record<string, unknown> },
    ) => Promise<{ assertionId: string }>
  }
  const { emitClassAssertion } = sdk
  const POOL_OPENED = 'sa:PoolOpenedAssertion'
  const openedAt = NOW
  for (const p of POOLS) {
    const subjectIri = `urn:smart-agent:pool:${p.id}`
    const payload = {
      id: p.id,
      // v1 placeholder — real pool deployment lands in Phase 2 (pool:create
      // tool calls AgentAccountFactory).
      treasuryAddress: FUND_ADDRESS,
      governanceModel: p.governanceModel,
      acceptedUnits: p.acceptedUnits,
      acceptedKinds: p.acceptedRestrictions.kinds ?? [],
      acceptedGeo: p.acceptedRestrictions.geoRoots ?? [],
      ceilingPolicy: p.ceilingPolicy,
      capacityCeiling: null,
      visibility: 'public' as const,
      stewards: [FUND_ADDRESS],
      openedAt,
    }
    try {
      const res = await emitClassAssertion(
        { rpcUrl, contractAddress: contractAddress as `0x${string}`, operatorPrivateKey: operatorPrivateKey as `0x${string}` },
        { classIri: POOL_OPENED, subjectIri, payload },
      )
      console.log(`[seed-test-pool] anchored ${p.id} → assertionId=${res.assertionId}`)
    } catch (err) {
      console.warn(`[seed-test-pool] anchor failed for ${p.id}: ${err instanceof Error ? err.message : err}`)
    }
  }
}

async function main(): Promise<void> {
  await seedSql()
  await seedGraphDB()
  await emitPoolAnchors()
  console.log(`\n✓ Seeded ${POOLS.length} pools operated by Catalyst NoCo Network:`)
  for (const p of POOLS) {
    console.log(`    · ${p.id} — ${p.name}`)
  }
  console.log(`  Visit: http://localhost:3000/h/catalyst/pools (after Maria signs in)`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
