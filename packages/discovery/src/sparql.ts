/**
 * SPARQL Query Builders
 *
 * All SPARQL queries against the SmartAgents knowledge base.
 * Queries traverse the multi-node graph:
 *   Agent → sa:hasIdentity → sai:SmartAgentIdentity
 *     → sai:hasOwnerAccount → eth:Account
 */

import type { AgentQueryOptions } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PREFIXES = `
PREFIX sa:   <https://smartagent.io/ontology/core#>
PREFIX sai:  <https://smartagent.io/ontology/identity#>
PREFIX sar:  <https://smartagent.io/ontology/relationships#>
PREFIX eth:  <https://smartagent.io/ontology/eth#>
PREFIX sad:  <https://smartagent.io/ontology/delegation#>
PREFIX sag:  <https://smartagent.io/ontology/governance#>
PREFIX sah:  <https://smartagent.io/ontology/hub#>
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
`

export const DATA_GRAPH = 'https://smartagent.io/graph/data/onchain'

function g(): string { return `GRAPH <${DATA_GRAPH}>` }

// ---------------------------------------------------------------------------
// Agent Queries
// ---------------------------------------------------------------------------

/**
 * List all agents with one row per agent.
 * Traverses Agent → SmartAgentIdentity for metadata.
 */
export function listAgentsQuery(opts: AgentQueryOptions = {}): string {
  const filters: string[] = []

  if (opts.agentType) {
    filters.push(`FILTER(?agentType = "${opts.agentType}")`)
  }
  if (opts.search) {
    const escaped = opts.search.replace(/"/g, '\\"').toLowerCase()
    filters.push(`FILTER(
      CONTAINS(LCASE(?name), "${escaped}") ||
      CONTAINS(LCASE(?address), "${escaped}") ||
      CONTAINS(LCASE(COALESCE(?desc, "")), "${escaped}") ||
      CONTAINS(LCASE(COALESCE(?primaryNameVal, "")), "${escaped}")
    )`)
  }
  if (opts.capability) {
    filters.push(`FILTER(CONTAINS(LCASE(?allCaps), "${opts.capability.toLowerCase()}"))`)
  }
  if (opts.templateId) {
    filters.push(`FILTER(?tmplVal = "${opts.templateId}")`)
  }

  let orderBy = 'ORDER BY ?name'
  if (opts.sortBy === 'type') orderBy = `ORDER BY ${opts.sortDir === 'desc' ? 'DESC' : 'ASC'}(?agentType) ?name`
  else if (opts.sortBy === 'relationships') orderBy = `ORDER BY ${opts.sortDir === 'desc' ? 'DESC' : 'ASC'}(?totalRels)`
  else if (opts.sortBy === 'name') orderBy = `ORDER BY ${opts.sortDir === 'desc' ? 'DESC' : 'ASC'}(?name)`

  const limit = opts.limit ? `LIMIT ${opts.limit}` : ''
  const offset = opts.offset ? `OFFSET ${opts.offset}` : ''

  return `${PREFIXES}
SELECT
  ?agent
  ?address
  ?name
  (SAMPLE(?desc) AS ?description)
  (SAMPLE(?typeVal) AS ?agentType)
  (SAMPLE(?classLocal) AS ?aiClass)
  (SAMPLE(?activeVal) AS ?isActive)
  (SAMPLE(?uaidVal) AS ?uaid)
  (SAMPLE(?primaryNameVal) AS ?primaryName)
  (SAMPLE(?nameLabelVal) AS ?nameLabel)
  (SAMPLE(?tmplVal) AS ?templateId)
  (SAMPLE(?a2aVal) AS ?a2aEndpoint)
  (SAMPLE(?mcpVal) AS ?mcpServer)
  (SAMPLE(?latVal) AS ?latitude)
  (SAMPLE(?lonVal) AS ?longitude)
  (SAMPLE(?metaVal) AS ?metadataURI)
  (GROUP_CONCAT(DISTINCT ?cap; separator="||") AS ?allCaps)
  (GROUP_CONCAT(DISTINCT ?trust; separator="||") AS ?allTrust)
  (GROUP_CONCAT(DISTINCT ?ctrlAddr; separator="||") AS ?allControllers)
  (COUNT(DISTINCT ?outEdge) AS ?outRels)
  (COUNT(DISTINCT ?inEdge) AS ?inRels)
  (COUNT(DISTINCT ?outEdge) + COUNT(DISTINCT ?inEdge) AS ?totalRels)
WHERE {
  ${g()} {
    ?agent a ?type .
    FILTER(STRSTARTS(STR(?type), "https://smartagent.io/ontology/core#"))
    ?agent sa:onChainAddress ?address .
    ?agent sa:displayName ?name .
    OPTIONAL { ?agent sa:description ?desc }
    OPTIONAL { ?agent sa:agentType ?typeVal }
    OPTIONAL { ?agent sa:isActive ?activeVal }
    OPTIONAL { ?agent sa:uaid ?uaidVal }
    OPTIONAL { ?agent sa:primaryName ?primaryNameVal }
    OPTIONAL { ?agent sa:nameLabel ?nameLabelVal }

    # Traverse into SmartAgentIdentity for metadata
    OPTIONAL {
      ?agent sa:hasIdentity ?identity .
      ?identity a sai:SmartAgentIdentity .
      OPTIONAL { ?identity sai:aiAgentClass ?classIRI . BIND(STRAFTER(STR(?classIRI), "#") AS ?classLocal) }
      OPTIONAL { ?identity sai:templateId ?tmplVal }
      OPTIONAL { ?identity sai:capability ?cap }
      OPTIONAL { ?identity sai:supportedTrustModel ?trust }
      OPTIONAL { ?identity sai:a2aEndpoint ?a2aVal }
      OPTIONAL { ?identity sai:mcpServer ?mcpVal }
      OPTIONAL { ?identity sai:metadataURI ?metaVal }
      OPTIONAL {
        ?identity sai:hasOwnerAccount ?ctrlAcct .
        ?ctrlAcct eth:accountAddress ?ctrlAddr .
      }
    }

    # Latitude/longitude still on agent for now
    OPTIONAL { ?agent sa:latitude ?latVal }
    OPTIONAL { ?agent sa:longitude ?lonVal }

    # Relationship counts
    OPTIONAL { ?outEdge sar:subject ?agent }
    OPTIONAL { ?inEdge sar:object ?agent }

    ${filters.join('\n    ')}
  }
}
GROUP BY ?agent ?address ?name
${orderBy}
${limit}
${offset}
`
}

/**
 * Count agents by type.
 */
export function countAgentsByTypeQuery(): string {
  return `${PREFIXES}
SELECT ?agentType (COUNT(?agent) AS ?count)
WHERE {
  ${g()} {
    ?agent a ?type .
    FILTER(STRSTARTS(STR(?type), "https://smartagent.io/ontology/core#"))
    OPTIONAL { ?agent sa:agentType ?agentType }
  }
}
GROUP BY ?agentType
ORDER BY DESC(?count)
`
}

/**
 * Get a single agent by address with full detail.
 */
export function agentDetailQuery(address: string): string {
  const addrLower = address.toLowerCase()
  return `${PREFIXES}
SELECT
  ?agent ?address ?name ?description ?agentType ?aiClass ?isActive ?uaid
  ?templateId ?a2aEndpoint ?mcpServer ?latitude ?longitude ?metadataURI
  (GROUP_CONCAT(DISTINCT ?cap; separator="||") AS ?capabilities)
  (GROUP_CONCAT(DISTINCT ?trust; separator="||") AS ?trustModels)
  (GROUP_CONCAT(DISTINCT ?ctrlAddr; separator="||") AS ?controllers)
WHERE {
  ${g()} {
    ?agent sa:onChainAddress ?address .
    FILTER(LCASE(?address) = "${addrLower}")
    ?agent sa:displayName ?name .
    OPTIONAL { ?agent sa:description ?description }
    OPTIONAL { ?agent sa:agentType ?agentType }
    OPTIONAL { ?agent sa:isActive ?isActive }
    OPTIONAL { ?agent sa:uaid ?uaid }
    OPTIONAL { ?agent sa:latitude ?latitude }
    OPTIONAL { ?agent sa:longitude ?longitude }

    OPTIONAL {
      ?agent sa:hasIdentity ?identity .
      ?identity a sai:SmartAgentIdentity .
      OPTIONAL { ?identity sai:aiAgentClass ?classIRI . BIND(STRAFTER(STR(?classIRI), "#") AS ?aiClass) }
      OPTIONAL { ?identity sai:templateId ?templateId }
      OPTIONAL { ?identity sai:a2aEndpoint ?a2aEndpoint }
      OPTIONAL { ?identity sai:mcpServer ?mcpServer }
      OPTIONAL { ?identity sai:metadataURI ?metadataURI }
      OPTIONAL { ?identity sai:capability ?cap }
      OPTIONAL { ?identity sai:supportedTrustModel ?trust }
      OPTIONAL {
        ?identity sai:hasOwnerAccount ?ctrlAcct .
        ?ctrlAcct eth:accountAddress ?ctrlAddr .
      }
    }
  }
}
GROUP BY ?agent ?address ?name ?description ?agentType ?aiClass ?isActive ?uaid
         ?templateId ?a2aEndpoint ?mcpServer ?latitude ?longitude ?metadataURI
LIMIT 1
`
}

// ---------------------------------------------------------------------------
// Relationship Queries
// ---------------------------------------------------------------------------

export function outgoingEdgesQuery(address: string): string {
  const addrLower = address.toLowerCase()
  return `${PREFIXES}
SELECT ?edgeId ?targetAddress ?targetName ?relType ?status
  (GROUP_CONCAT(DISTINCT ?roleLocal; separator="||") AS ?roles)
WHERE {
  ${g()} {
    ?subjectAgent sa:onChainAddress ?subAddr .
    FILTER(LCASE(?subAddr) = "${addrLower}")
    ?edge sar:subject ?subjectAgent .
    ?edge sar:edgeId ?edgeId .
    ?edge sar:object ?targetAgent .
    ?targetAgent sa:onChainAddress ?targetAddress .
    ?targetAgent sa:displayName ?targetName .
    ?edge sar:relationshipType ?relTypeIRI . BIND(STRAFTER(STR(?relTypeIRI), "#") AS ?relType)
    ?edge sar:edgeStatus ?statusIRI . BIND(STRAFTER(STR(?statusIRI), "#") AS ?status)
    OPTIONAL { ?edge sar:hasRole ?roleIRI . BIND(STRAFTER(STR(?roleIRI), "#") AS ?roleLocal) }
  }
}
GROUP BY ?edgeId ?targetAddress ?targetName ?relType ?status
`
}

export function incomingEdgesQuery(address: string): string {
  const addrLower = address.toLowerCase()
  return `${PREFIXES}
SELECT ?edgeId ?sourceAddress ?sourceName ?relType ?status
  (GROUP_CONCAT(DISTINCT ?roleLocal; separator="||") AS ?roles)
WHERE {
  ${g()} {
    ?objectAgent sa:onChainAddress ?objAddr .
    FILTER(LCASE(?objAddr) = "${addrLower}")
    ?edge sar:object ?objectAgent .
    ?edge sar:edgeId ?edgeId .
    ?edge sar:subject ?sourceAgent .
    ?sourceAgent sa:onChainAddress ?sourceAddress .
    ?sourceAgent sa:displayName ?sourceName .
    ?edge sar:relationshipType ?relTypeIRI . BIND(STRAFTER(STR(?relTypeIRI), "#") AS ?relType)
    ?edge sar:edgeStatus ?statusIRI . BIND(STRAFTER(STR(?statusIRI), "#") AS ?status)
    OPTIONAL { ?edge sar:hasRole ?roleIRI . BIND(STRAFTER(STR(?roleIRI), "#") AS ?roleLocal) }
  }
}
GROUP BY ?edgeId ?sourceAddress ?sourceName ?relType ?status
`
}

export function countEdgesQuery(): string {
  return `${PREFIXES}
SELECT (COUNT(?edge) AS ?count)
WHERE {
  ${g()} {
    ?edge a sar:RelationshipEdge .
  }
}
`
}

// ---------------------------------------------------------------------------
// Hop-Distance Queries
// ---------------------------------------------------------------------------
//
// The trust-proximity signal in the intent-marketplace ranking formula
// (specs 001/002/003 — `score = 0.6 * 1/(1+hops) + 0.4 * outcomeScore`)
// requires the *minimum* hop distance between two agents in the
// AgentRelationship graph.
//
// The edge model is bipartite — agents do NOT have a direct sar:relatesTo
// predicate; every relationship goes through a RelationshipEdge node:
//
//     ?a ←sar:subject— ?edge —sar:object→ ?b
//
// SPARQL 1.1 property paths cannot be depth-capped, so we UNION over each
// path length 1..maxHops and take MIN(?length). We treat edges as
// **undirected** for proximity (subject↔object are interchangeable) — trust
// flows both ways and the matchmaker doesn't care who initiated.
//
// Depth cap = 6 is per spec 001's research.md R2: at 6 hops the proximity
// score is 1/(1+6) ≈ 0.143, indistinguishable from longer paths in practice.

const HOP_DEPTH_CAP = 6

/** One "hop" between two variables — either direction of an edge. */
function hopPattern(from: string, to: string, edgeVar: string): string {
  return `{ ?${edgeVar} sar:subject ?${from} ; sar:object ?${to} }
        UNION
        { ?${edgeVar} sar:subject ?${to} ; sar:object ?${from} }`
}

/** Build a chain of N hops: a -hop- v1 -hop- v2 ... -hop- b. */
function hopChain(from: string, to: string, length: number): string {
  if (length === 1) return hopPattern(from, to, 'e0')
  const lines: string[] = []
  let prev = from
  for (let i = 0; i < length; i += 1) {
    const next = i === length - 1 ? to : `vh${i}`
    lines.push(hopPattern(prev, next, `e${i}`))
    prev = next
  }
  return lines.join('\n        ')
}

/**
 * Minimum hop distance between two agents (by on-chain address), undirected,
 * capped at 6. Returns ?distance bound to the smallest path length found,
 * or no rows if the agents are unreachable within the cap.
 *
 * Result row: { distance: integer in 1..6 } (no row → unreachable / > cap).
 *
 * Use case: trust-proximity component of the matchmaker ranking
 * (`proximityScore = 1 / (1 + hops)`).
 */
export function hopDistanceQuery(addressA: string, addressB: string): string {
  const a = addressA.toLowerCase()
  const b = addressB.toLowerCase()

  const branches: string[] = []
  for (let len = 1; len <= HOP_DEPTH_CAP; len += 1) {
    branches.push(`{
      ${hopChain('agentA', 'agentB', len)}
      BIND(${len} AS ?distance)
    }`)
  }

  return `${PREFIXES}
SELECT (MIN(?distance) AS ?minDistance)
WHERE {
  ${g()} {
    ?agentA sa:onChainAddress ?addrA .
    FILTER(LCASE(?addrA) = "${a}")
    ?agentB sa:onChainAddress ?addrB .
    FILTER(LCASE(?addrB) = "${b}")
    ${branches.join('\n    UNION\n    ')}
  }
}
`
}

/**
 * For a given source agent, find every other agent reachable within
 * `maxHops` (default 6), with the minimum hop distance to each.
 * Useful for batch-ranking candidates (one query per source instead of
 * one per candidate).
 *
 * Result rows: { targetAddress, targetName?, distance } sorted by distance asc.
 */
export function hopsFromAgentQuery(sourceAddress: string, maxHops = HOP_DEPTH_CAP): string {
  const src = sourceAddress.toLowerCase()
  const cap = Math.min(Math.max(1, maxHops), HOP_DEPTH_CAP)

  const branches: string[] = []
  for (let len = 1; len <= cap; len += 1) {
    branches.push(`{
      ${hopChain('source', 'target', len)}
      BIND(${len} AS ?distance)
    }`)
  }

  return `${PREFIXES}
SELECT ?targetAddress ?targetName (MIN(?distance) AS ?minDistance)
WHERE {
  ${g()} {
    ?source sa:onChainAddress ?srcAddr .
    FILTER(LCASE(?srcAddr) = "${src}")
    ${branches.join('\n    UNION\n    ')}
    ?target sa:onChainAddress ?targetAddress .
    OPTIONAL { ?target sa:displayName ?targetName }
    FILTER(?target != ?source)
  }
}
GROUP BY ?targetAddress ?targetName
ORDER BY ?minDistance
`
}
