/**
 * One-shot: upload all T-Box, SHACL, and C-Box .ttl files from
 * docs/ontology/ to GraphDB.
 *
 *   pnpm tsx scripts/sync-ontology.ts
 *
 * Reads GRAPHDB_BASE_URL / GRAPHDB_REPOSITORY / GRAPHDB_USERNAME /
 * GRAPHDB_PASSWORD from apps/web/.env (or the process environment).
 *
 * Named graphs (must match packages/discovery/src and
 * apps/web/src/lib/ontology/graphdb-sync.ts):
 *
 *   T-Box + SHACL  → https://smartagent.io/graph/schema/tbox
 *   C-Box          → https://smartagent.io/graph/schema/cbox
 *
 * The existing apps/web/src/lib/ontology/graphdb-sync.ts skips the
 * tbox/shacl/ subdirectory; this script recurses, so the visibility
 * cascade shapes land in the same named graph as the rest of T-Box.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// Hand-parse apps/web/.env so we don't pull in dotenv as a script dep.
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
const CBOX_GRAPH = 'https://smartagent.io/graph/schema/cbox'

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    console.error(`Missing required env var: ${key}`)
    process.exit(1)
  }
  return value
}

const baseUrl = requireEnv('GRAPHDB_BASE_URL')
const repository = requireEnv('GRAPHDB_REPOSITORY')
const username = requireEnv('GRAPHDB_USERNAME')
const password = requireEnv('GRAPHDB_PASSWORD')

const repoUrl = `${baseUrl}/repositories/${repository}`
const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

/** Walk a directory tree and return the absolute path of every .ttl file (recursive). */
function findTurtleFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...findTurtleFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.ttl')) {
      out.push(full)
    }
  }
  return out
}

async function uploadTurtle(turtle: string, namedGraph: string): Promise<void> {
  const url = `${repoUrl}/rdf-graphs/service?graph=${encodeURIComponent(namedGraph)}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle', Authorization: authHeader },
    body: turtle,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`PUT ${namedGraph} failed (${response.status}): ${body}`)
  }
}

interface SparqlBinding {
  [variable: string]: { value: string; type: string }
}

async function sparqlQuery(query: string): Promise<SparqlBinding[]> {
  const response = await fetch(repoUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      Authorization: authHeader,
    },
    body: query,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SPARQL query failed (${response.status}): ${body}`)
  }
  const result = (await response.json()) as { results: { bindings: SparqlBinding[] } }
  return result.results.bindings
}

async function main() {
  const tboxDir = path.join(repoRoot, 'docs/ontology/tbox')
  const cboxDir = path.join(repoRoot, 'docs/ontology/cbox')

  const tboxFiles = findTurtleFiles(tboxDir).sort()
  const cboxFiles = findTurtleFiles(cboxDir).sort()

  console.log(`Found ${tboxFiles.length} T-Box .ttl files (under ${path.relative(repoRoot, tboxDir)})`)
  for (const f of tboxFiles) console.log(`  · ${path.relative(repoRoot, f)}`)
  console.log(`Found ${cboxFiles.length} C-Box .ttl files (under ${path.relative(repoRoot, cboxDir)})`)
  for (const f of cboxFiles) console.log(`  · ${path.relative(repoRoot, f)}`)

  if (tboxFiles.length === 0 && cboxFiles.length === 0) {
    console.error('No .ttl files found. Aborting.')
    process.exit(1)
  }

  const concat = (files: string[]): string =>
    files
      .map((f) => `# ─── ${path.relative(repoRoot, f)} ──────────────────────────\n${fs.readFileSync(f, 'utf8')}`)
      .join('\n\n')

  if (tboxFiles.length) {
    console.log(`\nUploading T-Box + SHACL → ${TBOX_GRAPH}`)
    await uploadTurtle(concat(tboxFiles), TBOX_GRAPH)
    console.log('  ✓ T-Box uploaded.')
  }

  if (cboxFiles.length) {
    console.log(`\nUploading C-Box → ${CBOX_GRAPH}`)
    await uploadTurtle(concat(cboxFiles), CBOX_GRAPH)
    console.log('  ✓ C-Box uploaded.')
  }

  // Verify: count owl:Class declarations in each graph.
  console.log('\nVerifying via SPARQL counts...')

  const tboxClasses = await sparqlQuery(`
    PREFIX owl: <http://www.w3.org/2002/07/owl#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    SELECT (COUNT(?c) AS ?count) WHERE {
      GRAPH <${TBOX_GRAPH}> {
        ?c a ?type .
        FILTER(?type IN (owl:Class, rdfs:Class))
      }
    }
  `)
  const tboxClassCount = tboxClasses[0]?.count?.value ?? '0'
  console.log(`  T-Box classes:  ${tboxClassCount}`)

  const tboxShapes = await sparqlQuery(`
    PREFIX sh: <http://www.w3.org/ns/shacl#>
    SELECT (COUNT(?s) AS ?count) WHERE {
      GRAPH <${TBOX_GRAPH}> { ?s a sh:NodeShape }
    }
  `)
  const shapeCount = tboxShapes[0]?.count?.value ?? '0'
  console.log(`  SHACL shapes:   ${shapeCount}`)

  const cboxConcepts = await sparqlQuery(`
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT (COUNT(?c) AS ?count) WHERE {
      GRAPH <${CBOX_GRAPH}> { ?c a skos:Concept }
    }
  `)
  const conceptCount = cboxConcepts[0]?.count?.value ?? '0'
  console.log(`  C-Box concepts: ${conceptCount}`)

  // Confirm the marketplace classes specifically landed.
  const marketplaceClasses = await sparqlQuery(`
    PREFIX owl: <http://www.w3.org/2002/07/owl#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX sa: <https://smartagent.io/ontology/core#>
    SELECT ?c WHERE {
      GRAPH <${TBOX_GRAPH}> {
        ?c a ?type .
        FILTER(?type IN (owl:Class, rdfs:Class))
        FILTER(?c IN (sa:MatchInitiation, sa:MatchInitiationAssertion,
                      sa:Pool, sa:Fund, sa:PoolPledge, sa:PledgeAssertion,
                      sa:PoolPledgedTotalAssertion, sa:Round,
                      sa:RoundOpenedAssertion, sa:RoundClosedAssertion,
                      sa:GrantProposal))
      }
    } ORDER BY ?c
  `)
  console.log(`  Marketplace classes present: ${marketplaceClasses.length} / 11`)
  for (const row of marketplaceClasses) console.log(`    · ${row.c.value}`)

  const missing = [
    'sa:MatchInitiation',
    'sa:MatchInitiationAssertion',
    'sa:Pool',
    'sa:Fund',
    'sa:PoolPledge',
    'sa:PledgeAssertion',
    'sa:PoolPledgedTotalAssertion',
    'sa:Round',
    'sa:RoundOpenedAssertion',
    'sa:RoundClosedAssertion',
    'sa:GrantProposal',
  ].filter(
    (curie) =>
      !marketplaceClasses.some(
        (row) => row.c.value === curie.replace('sa:', 'https://smartagent.io/ontology/core#'),
      ),
  )
  if (missing.length) {
    console.warn(`  ⚠ Missing classes: ${missing.join(', ')}`)
    process.exit(2)
  }

  console.log('\n✓ Sync complete.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
