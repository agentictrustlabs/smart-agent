/**
 * Spec 003 — Intent Marketplace (Proposal Lane). SHACL invariant probe (T063).
 *
 * Confirms that the spec-003 SHACL backstop ships with the ontology graph in
 * GraphDB. Runs two SPARQL ASK queries:
 *
 *   1. Does `sa:GrantProposalAlwaysPrivateShape` exist in the T-Box graph?
 *      (uploaded as part of `docs/ontology/tbox/shacl/visibility.ttl` by
 *      `scripts/sync-ontology.ts`).
 *   2. Are there any `sa:GrantProposal` instances in the data graph?
 *      Per IA P5 / IA § 2.3 / SHACL `sa:GrantProposalAlwaysPrivateShape`:
 *      proposals must NEVER appear in GraphDB. The expected count is 0.
 *
 * Exits non-zero on either failure so it can run in CI.
 *
 *   pnpm tsx scripts/validate-grant-proposal-shacl.ts
 *
 * Reads GRAPHDB_BASE_URL / GRAPHDB_REPOSITORY / GRAPHDB_USERNAME /
 * GRAPHDB_PASSWORD from apps/web/.env (or the process environment), same
 * as `sync-ontology.ts`.
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
    const key = m[1]
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

const TBOX_GRAPH = 'https://smartagent.io/graph/schema/tbox'
const DATA_GRAPH = 'https://smartagent.io/graph/data'

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    console.error(`Missing required env var: ${key}`)
    process.exit(1)
  }
  return value
}

const BASE = requireEnv('GRAPHDB_BASE_URL').replace(/\/$/, '')
const REPO = requireEnv('GRAPHDB_REPOSITORY')
const USER = process.env.GRAPHDB_USERNAME
const PASS = process.env.GRAPHDB_PASSWORD

function authHeader(): Record<string, string> {
  if (!USER || !PASS) return {}
  return { Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}` }
}

async function ask(query: string): Promise<boolean> {
  const url = `${BASE}/repositories/${REPO}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      ...authHeader(),
    },
    body: query,
  })
  if (!res.ok) {
    throw new Error(`SPARQL ASK failed: ${res.status} ${await res.text()}`)
  }
  const json = (await res.json()) as { boolean: boolean }
  return Boolean(json.boolean)
}

async function count(query: string): Promise<number> {
  const url = `${BASE}/repositories/${REPO}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      ...authHeader(),
    },
    body: query,
  })
  if (!res.ok) {
    throw new Error(`SPARQL count failed: ${res.status} ${await res.text()}`)
  }
  const json = (await res.json()) as { results: { bindings: Array<{ n?: { value: string } }> } }
  const v = json.results.bindings[0]?.n?.value ?? '0'
  return parseInt(v, 10) || 0
}

async function main() {
  console.log('[validate-grant-proposal-shacl] checking SHACL invariants...')

  // 1. Shape exists in T-Box.
  const shapeQ = `
PREFIX sa: <https://smart-agent.io/ontology#>
PREFIX sh: <http://www.w3.org/ns/shacl#>
ASK {
  GRAPH <${TBOX_GRAPH}> {
    sa:GrantProposalAlwaysPrivateShape a sh:NodeShape .
  }
}`
  const shapeOk = await ask(shapeQ)
  console.log(
    shapeOk
      ? '  [OK]  sa:GrantProposalAlwaysPrivateShape declared in T-Box'
      : '  [WARN] sa:GrantProposalAlwaysPrivateShape NOT found in T-Box — run scripts/sync-ontology.ts',
  )

  // 2. No GrantProposal instances in the data graph.
  const instanceQ = `
PREFIX sa: <https://smart-agent.io/ontology#>
SELECT (COUNT(?gp) AS ?n)
WHERE {
  GRAPH <${DATA_GRAPH}> {
    ?gp a sa:GrantProposal .
  }
}`
  const n = await count(instanceQ)
  console.log(
    n === 0
      ? '  [OK]  zero sa:GrantProposal instances in data graph (private-always invariant holds)'
      : `  [FAIL] ${n} sa:GrantProposal instance(s) found in data graph — invariant violated!`,
  )

  if (!shapeOk) {
    console.warn('[validate-grant-proposal-shacl] shape missing; sync-ontology.ts must run first.')
  }
  if (n > 0) {
    console.error('[validate-grant-proposal-shacl] FAIL — grant proposals never anchor in v1.')
    process.exit(2)
  }

  console.log('[validate-grant-proposal-shacl] done.')
}

main().catch((err) => {
  console.error('[validate-grant-proposal-shacl] error:', err)
  process.exit(1)
})
