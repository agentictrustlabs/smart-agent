/**
 * Spec 002 — Intent Marketplace (Pool Lane). One-shot demo seed.
 *
 * Creates a single test pool under Catalyst NoCo Network so Maria (and other
 * Catalyst hub users) can see something on /h/catalyst/pools after fresh-start.
 *
 *   pnpm exec tsx scripts/seed-test-pool.ts
 *
 * What it does:
 *
 *   1. INSERT OR REPLACE the pool body in apps/org-mcp/org-mcp.db (pools table).
 *   2. SPARQL INSERT (additive) the sa:Pool triples into the data graph at
 *      <https://smartagent.io/graph/data/onchain> so the discovery query
 *      surfaces the pool.
 *
 * Why additive INSERT instead of PUT: matches scripts/seed-test-round.ts —
 * the runtime KB-sync uses PUT for the data graph; until graphdb-sync
 * extends to read pools natively (it does, now — emitPoolsTurtle), this
 * script is the bridge for one-off demo seeding before any sync runs.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// Load env from apps/web/.env so we get GRAPHDB_* vars.
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

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const POOL_ID = 'demo-trauma-care-pool'
const POOL_IRI = `urn:smart-agent:pool:${POOL_ID}`

// Catalyst NoCo Network — the fund operating the pool (real seeded org).
const FUND_ADDRESS = '0x0F669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()
const FUND_AGENT_IRI = `https://smartagent.io/ontology/core#agent/${FUND_ADDRESS}`

const NOW = new Date().toISOString()

const MANDATE = 'Trauma-care training and church-planting capital for Northern Colorado leaders. Stewards prioritize evidence-based outcomes; donors may restrict by kind / geo or accept the open mandate.'

const ACCEPTED_RESTRICTIONS_JSON = JSON.stringify({
  kinds: ['trauma-care', 'church-planting', 'leader-care'],
  geoRoots: ['us/colorado', 'us/wyoming'],
  notForAdmin: true,
})
const ACCEPTED_UNITS_JSON = JSON.stringify(['USD'])
const STEWARDS_JSON = JSON.stringify([FUND_AGENT_IRI])

// ────────────────────────────────────────────────────────────────────────
// 1. SQL — insert pool into org-mcp
// ────────────────────────────────────────────────────────────────────────

async function seedSql(): Promise<void> {
  const dbPath = path.join(repoRoot, 'apps/org-mcp/org-mcp.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-pool] ${dbPath} does not exist — skipping SQL insert`)
    return
  }
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => { prepare: (sql: string) => { run: (params: Record<string, unknown>) => void }; close: () => void } }).default
  const db = new Database(dbPath)
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
    stmt.run({
      id: POOL_IRI,
      org_principal: FUND_ADDRESS,
      name: 'Catalyst Trauma-Care + Planting Pool',
      domain: 'funding',
      mandate: MANDATE,
      governance_model: 'fund',
      accepted_restrictions: ACCEPTED_RESTRICTIONS_JSON,
      accepted_units: ACCEPTED_UNITS_JSON,
      capacity_ceiling: null, // ceilingPolicy: 'accept' (per seed brief)
      ceiling_policy: 'accept',
      addressed_to: 'hub:catalyst',
      addressed_members: null,
      visibility: 'public',
      stewardship_agent: FUND_AGENT_IRI,
      stewards: STEWARDS_JSON,
      accepts_open_calls: 1,
      pledged_total: 0,
      allocated_total: 0,
      available_total: 0,
      on_chain_assertion_id: null,
      created_at: NOW,
      updated_at: NOW,
    })
    console.log(`[seed-test-pool] SQL ok — pool ${POOL_ID} in ${dbPath}`)
  } finally {
    db.close()
  }
}

// ────────────────────────────────────────────────────────────────────────
// 2. SPARQL INSERT — additive write into the data graph
// ────────────────────────────────────────────────────────────────────────

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

  const escapedMandate = MANDATE.replace(/"/g, '\\"').replace(/\n/g, '\\n')
  const escapedRestrictions = ACCEPTED_RESTRICTIONS_JSON.replace(/"/g, '\\"')

  const sparql = `
PREFIX sa: <https://smartagent.io/ontology/core#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

INSERT DATA {
  GRAPH <https://smartagent.io/graph/data/onchain> {
    <${POOL_IRI}> a sa:Pool ;
      sa:displayName "Catalyst Trauma-Care + Planting Pool" ;
      sa:domain "funding" ;
      sa:poolMandate "${escapedMandate}" ;
      sa:governanceModel "fund" ;
      sa:acceptedRestrictions "${escapedRestrictions}" ;
      sa:acceptsUnit "USD" ;
      sa:ceilingPolicy "accept" ;
      sa:addressedTo "hub:catalyst" ;
      sa:visibility "public" ;
      sa:stewardshipAgent <${FUND_AGENT_IRI}> ;
      sa:steward <${FUND_AGENT_IRI}> ;
      sa:acceptsOpenCalls true ;
      sa:pledgedTotal 0 ;
      sa:allocatedTotal 0 ;
      sa:availableTotal 0 .
  }
}
`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-update',
      Authorization: auth,
    },
    body: sparql,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SPARQL UPDATE failed (${response.status}): ${body}`)
  }
  console.log(`[seed-test-pool] GraphDB ok — INSERT into data graph`)
}

// ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await seedSql()
  await seedGraphDB()
  console.log(`\n✓ Seeded pool '${POOL_ID}' operated by Catalyst NoCo Network.`)
  console.log(`  Visit: http://localhost:3000/h/catalyst/pools (after Maria signs in)`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
