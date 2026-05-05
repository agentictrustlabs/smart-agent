/**
 * One-shot demo seed — creates a single test round under Catalyst NoCo Network
 * so Maria (and other Catalyst hub users) can see something on /h/catalyst/rounds
 * after fresh-start.
 *
 *   pnpm exec tsx scripts/seed-test-round.ts
 *
 * What it does:
 *
 *   1. INSERT OR REPLACE the round body in apps/org-mcp/org-mcp.db (rounds table).
 *   2. SPARQL INSERT (additive — does NOT replace the data graph) the round
 *      triples + a synthetic sa:RoundOpenedAssertion mirror into GraphDB at
 *      `https://smartagent.io/graph/data/onchain` so the discovery query
 *      surfaces the round.
 *
 * Why additive INSERT instead of PUT:
 *   The runtime KB-sync (apps/web/src/lib/ontology/graphdb-sync.ts) uses PUT
 *   for the data graph, which wipes everything we don't re-emit. Until the
 *   sync extends to read rounds from org-mcp, this script is the bridge.
 *   Re-running this script after a sync wipe restores the round.
 *
 * Caveat: a real round-creation flow would (a) anchor a real
 * sa:RoundOpenedAssertion on chain via emitClassAssertion, and (b) extend
 * the on-chain → GraphDB sync to read the body fields from org-mcp. This
 * script short-circuits both for v1 demo purposes.
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

const ROUND_ID = 'demo-trauma-care-q2'
const ROUND_IRI = `urn:smart-agent:round:${ROUND_ID}`
const ASSERTION_IRI = `urn:smart-agent:assertion:${ROUND_ID}-opened`

// Catalyst NoCo Network — the fund operating the round (real seeded org).
const FUND_ADDRESS = '0x0F669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()
const FUND_AGENT_IRI = `https://smartagent.io/ontology/core#agent/${FUND_ADDRESS}`

const NOW = new Date().toISOString()
const DEADLINE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() // +14 days
const DECISION = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // +30 days

const MANDATE_JSON = JSON.stringify({
  acceptedKinds: ['trauma-care', 'CoachingNeed', 'NeedCoaching'],
  acceptedGeo: ['us/colorado'],
  budgetCeiling: 250000,
  expectedAwards: 6,
})
const MILESTONE_JSON = JSON.stringify({
  minMilestones: 2,
  maxMilestones: 5,
  trancheHints: { atKickoff: 0.3, midpoint: 0.4, completion: 0.3 },
})
const VALIDATOR_JSON = JSON.stringify({ minValidators: 2 })

// ────────────────────────────────────────────────────────────────────────
// 1. SQL — insert round into org-mcp
// ────────────────────────────────────────────────────────────────────────

async function seedSql(): Promise<void> {
  const dbPath = path.join(repoRoot, 'apps/org-mcp/org-mcp.db')
  if (!fs.existsSync(dbPath)) {
    console.warn(`[seed-test-round] ${dbPath} does not exist — skipping SQL insert`)
    return
  }

  // Lazy import — better-sqlite3 isn't a direct repo-root dep, so resolve
  // through the pnpm store path used by the apps that own SQLite.
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => { prepare: (sql: string) => { run: (params: Record<string, unknown>) => void }; close: () => void } }).default
  const db = new Database(dbPath)
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO rounds (
        id, org_principal, mandate, milestone_template, validator_requirements,
        reporting_cadence, deadline, decision_date, required_credentials,
        visibility, addressed_applicants, proposals_received,
        on_chain_assertion_id, created_at, updated_at
      ) VALUES (
        @id, @org_principal, @mandate, @milestone_template, @validator_requirements,
        @reporting_cadence, @deadline, @decision_date, @required_credentials,
        @visibility, @addressed_applicants, @proposals_received,
        @on_chain_assertion_id, @created_at, @updated_at
      )
    `)
    stmt.run({
      id: ROUND_IRI,
      org_principal: FUND_ADDRESS,
      mandate: MANDATE_JSON,
      milestone_template: MILESTONE_JSON,
      validator_requirements: VALIDATOR_JSON,
      reporting_cadence: 'quarterly',
      deadline: DEADLINE,
      decision_date: DECISION,
      required_credentials: '[]',
      visibility: 'public',
      addressed_applicants: null,
      proposals_received: 0,
      on_chain_assertion_id: ASSERTION_IRI,
      created_at: NOW,
      updated_at: NOW,
    })
    console.log(`[seed-test-round] SQL ok — round ${ROUND_ID} in ${dbPath}`)
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
    throw new Error('GRAPHDB_BASE_URL / GRAPHDB_REPOSITORY / GRAPHDB_USERNAME / GRAPHDB_PASSWORD must be set')
  }
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const url = `${baseUrl}/repositories/${repository}/statements`

  // Build INSERT DATA (additive). We escape `"""` by relying on JSON.stringify
  // never producing triple-quotes in our payloads.
  const escapedMandate = MANDATE_JSON.replace(/"/g, '\\"')
  const escapedMilestone = MILESTONE_JSON.replace(/"/g, '\\"')
  const escapedValidator = VALIDATOR_JSON.replace(/"/g, '\\"')

  const sparql = `
PREFIX sa: <https://smartagent.io/ontology/core#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

INSERT DATA {
  GRAPH <https://smartagent.io/graph/data/onchain> {
    <${ROUND_IRI}> a sa:Round ;
      sa:operatedByFund <${FUND_AGENT_IRI}> ;
      sa:roundMandate "${escapedMandate}" ;
      sa:milestoneTemplate "${escapedMilestone}" ;
      sa:validatorRequirements "${escapedValidator}" ;
      sa:reportingCadence "quarterly" ;
      sa:deadline "${DEADLINE}"^^xsd:dateTime ;
      sa:decisionDate "${DECISION}"^^xsd:dateTime ;
      sa:requiredCredentials "[]" ;
      sa:visibility "public" ;
      sa:proposalsReceived 0 .

    <${ASSERTION_IRI}> a sa:RoundOpenedAssertion ;
      sa:onChainAssertionId "${ASSERTION_IRI}" ;
      sa:subjectId "${ROUND_ID}" ;
      sa:payloadURI "data:application/json,${encodeURIComponent(MANDATE_JSON)}" ;
      prov:generatedAtTime "${NOW}"^^xsd:dateTime .
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
  console.log(`[seed-test-round] GraphDB ok — INSERT into data graph`)

  // Verification.
  const askResp = await fetch(`${baseUrl}/repositories/${repository}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      Authorization: auth,
    },
    body: `PREFIX sa: <https://smartagent.io/ontology/core#>
SELECT (COUNT(?r) AS ?n) WHERE {
  GRAPH <https://smartagent.io/graph/data/onchain> { ?r a sa:Round }
}`,
  })
  if (!askResp.ok) throw new Error(`verify query failed (${askResp.status})`)
  const result = (await askResp.json()) as { results: { bindings: Array<{ n: { value: string } }> } }
  console.log(`[seed-test-round] verify — rounds in data graph: ${result.results.bindings[0]?.n?.value ?? '?'}`)
}

// ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await seedSql()
  await seedGraphDB()
  console.log(`\n✓ Seeded round '${ROUND_ID}' operated by Catalyst NoCo Network.`)
  console.log(`  Visit: http://localhost:3000/h/catalyst/rounds (after Maria signs in)`)
  console.log(`  NOTE: the runtime KB sync will wipe the GraphDB part of this seed`)
  console.log(`        whenever any on-chain edge is created. Re-run this script`)
  console.log(`        if the rounds page goes empty again.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
