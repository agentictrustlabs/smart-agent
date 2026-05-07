/**
 * Demo seed — multiple grant rounds under Catalyst NoCo Network so Maria
 * (and other Catalyst hub users) see distinct, faith-flavored options on
 * /h/catalyst/rounds. Each round has a unique mandate so they're easy to
 * tell apart in the index list and downstream proposal seeds.
 *
 *   pnpm exec tsx scripts/seed-test-round.ts
 *
 * Idempotent: INSERT OR REPLACE on stable ids (and SPARQL INSERT DATA is
 * forgiving of repeats — duplicate triples coalesce).
 *
 * Caveat: a real round-creation flow would (a) anchor a real
 * sa:RoundOpenedAssertion on chain, and (b) extend the on-chain → GraphDB
 * sync to read the body fields from org-mcp. This script short-circuits
 * both for v1 demo purposes.
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

// Three rounds — distinct titles, distinct mandates, distinct sizes.
// The trauma-care round retains its slug for downstream test coverage but
// is reframed as a compassion-ministry initiative for migrant families.
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
    console.warn(`[seed-test-round] ${dbPath} does not exist — skipping SQL insert`)
    return
  }
  const db = await openSqlite(dbPath)
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
    for (const r of ROUNDS) {
      const iri = `urn:smart-agent:round:${r.id}`
      const assertionIri = `urn:smart-agent:assertion:${r.id}-opened`
      // Stash displayName + description inside the mandate JSON so the
      // runtime emitRoundsTurtle sync can re-emit them after every PUT.
      // The on-chain assertion payload doesn't currently carry these
      // fields; the rounds table is the seed's persistence anchor.
      const mandateWithDisplay = { ...r.mandate, displayName: r.displayName }
      stmt.run({
        id: iri,
        org_principal: FUND_ADDRESS,
        mandate: JSON.stringify(mandateWithDisplay),
        milestone_template: JSON.stringify(r.milestone),
        validator_requirements: JSON.stringify(r.validators),
        reporting_cadence: r.reportingCadence,
        deadline: r.deadline,
        decision_date: r.decisionDate,
        required_credentials: '[]',
        visibility: 'public',
        addressed_applicants: null,
        proposals_received: 0,
        on_chain_assertion_id: assertionIri,
        created_at: NOW,
        updated_at: NOW,
      })
      console.log(`[seed-test-round] SQL ok — ${r.id} (${r.displayName})`)
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
    throw new Error('GRAPHDB_BASE_URL / GRAPHDB_REPOSITORY / GRAPHDB_USERNAME / GRAPHDB_PASSWORD must be set')
  }
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const url = `${baseUrl}/repositories/${repository}/statements`

  const triples = ROUNDS.map(r => {
    const iri = `urn:smart-agent:round:${r.id}`
    const assertionIri = `urn:smart-agent:assertion:${r.id}-opened`
    const escMandate = JSON.stringify(r.mandate).replace(/"/g, '\\"')
    const escMilestone = JSON.stringify(r.milestone).replace(/"/g, '\\"')
    const escValidator = JSON.stringify(r.validators).replace(/"/g, '\\"')
    return `
    <${iri}> a sa:Round ;
      sa:displayName "${r.displayName.replace(/"/g, '\\"')}" ;
      sa:operatedByFund <${FUND_AGENT_IRI}> ;
      sa:roundMandate "${escMandate}" ;
      sa:milestoneTemplate "${escMilestone}" ;
      sa:validatorRequirements "${escValidator}" ;
      sa:reportingCadence "${r.reportingCadence}" ;
      sa:deadline "${r.deadline}"^^xsd:dateTime ;
      sa:decisionDate "${r.decisionDate}"^^xsd:dateTime ;
      sa:requiredCredentials "[]" ;
      sa:visibility "public" ;
      sa:proposalsReceived 0 .

    <${assertionIri}> a sa:RoundOpenedAssertion ;
      sa:onChainAssertionId "${assertionIri}" ;
      sa:subjectId "${r.id}" ;
      sa:payloadURI "data:application/json,${encodeURIComponent(JSON.stringify(r.mandate))}" ;
      prov:generatedAtTime "${NOW}"^^xsd:dateTime .
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
  console.log(`[seed-test-round] GraphDB ok — INSERT ${ROUNDS.length} rounds into data graph`)

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

/**
 * Treasury Phase 1 — for each seeded round, emit `sa:RoundOpenedAssertion`
 * on chain so the public read source (GraphDB mirror) reflects every public
 * state-change moment. Uses @smart-agent/sdk's `emitClassAssertion` directly
 * with the env (RPC_URL / CLASS_ASSERTION_ADDRESS / DEPLOYER_PRIVATE_KEY)
 * loaded from apps/web/.env above. Failures log + continue — the SQL/SPARQL
 * seed has already landed; the on-chain anchor is best-effort for now.
 */
async function emitRoundAnchors(): Promise<void> {
  const rpcUrl = process.env.RPC_URL
  const contractAddress = process.env.CLASS_ASSERTION_ADDRESS
  const operatorPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!rpcUrl || !contractAddress || !operatorPrivateKey) {
    console.warn('[seed-test-round] anchor emit skipped — missing RPC_URL / CLASS_ASSERTION_ADDRESS / DEPLOYER_PRIVATE_KEY')
    return
  }
  // Import the SDK by file path — this script runs at repo root via tsx
  // and doesn't have @smart-agent/sdk in its module-resolution scope.
  const sdk = await import(path.join(repoRoot, 'packages/sdk/src/index.ts')) as {
    emitClassAssertion: (
      cfg: { rpcUrl: string; contractAddress: `0x${string}`; operatorPrivateKey: `0x${string}` },
      input: { classIri: string; subjectIri: string; payload: Record<string, unknown> },
    ) => Promise<{ assertionId: string }>
  }
  const { emitClassAssertion } = sdk
  const ROUND_OPENED = 'sa:RoundOpenedAssertion'
  for (const r of ROUNDS) {
    const subjectIri = `urn:smart-agent:round:${r.id}`
    const payload = {
      id: r.id,
      fundAgentId: FUND_ADDRESS,
      mandate: r.mandate,
      reportingCadence: r.reportingCadence,
      deadline: r.deadline,
      decisionDate: r.decisionDate,
      requiredCredentials: [],
      visibility: 'public' as const,
    }
    try {
      const res = await emitClassAssertion(
        { rpcUrl, contractAddress: contractAddress as `0x${string}`, operatorPrivateKey: operatorPrivateKey as `0x${string}` },
        { classIri: ROUND_OPENED, subjectIri, payload },
      )
      console.log(`[seed-test-round] anchored ${r.id} → assertionId=${res.assertionId}`)
    } catch (err) {
      console.warn(`[seed-test-round] anchor failed for ${r.id}: ${err instanceof Error ? err.message : err}`)
    }
  }
}

async function main(): Promise<void> {
  await seedSql()
  await seedGraphDB()
  await emitRoundAnchors()
  console.log(`\n✓ Seeded ${ROUNDS.length} rounds operated by Catalyst NoCo Network:`)
  for (const r of ROUNDS) {
    console.log(`    · ${r.id} — ${r.displayName}`)
  }
  console.log(`  Visit: http://localhost:3000/h/catalyst/rounds (after Maria signs in)`)
  console.log(`  NOTE: the runtime KB sync may wipe the GraphDB part of this seed.`)
  console.log(`        Re-run this script if rounds disappear from the index.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
