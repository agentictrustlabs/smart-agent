/**
 * SKOS / skill-taxonomy helpers, paralleling geo-sparql.ts.
 *
 * The GraphDB SmartAgents repository is loaded with `tbox/skills.ttl`
 * + `cbox/skill-vocabulary.ttl` at startup, so SKOS queries
 * (prefLabel / altLabel / broader / narrower) hit a live concept
 * graph server-side. This module wraps the queries; consumers only
 * see typed results.
 *
 * v1 adds SKOS narrower expansion: `expandNarrowerConcepts(seedIri)`
 * walks `^skos:broader*` from the seed to collect every descendant
 * concept (e.g. "Nonprofit development" → {grant-writing,
 * volunteer-coordination, donor-stewardship, …}). Consumers use the
 * resulting concept set when querying for matching agents — a search
 * for the broad concept then matches agents whose claims point to any
 * narrower descendant.
 *
 * IRI conventions:
 *   skill   = https://smartagent.io/skill/<scheme>/<conceptId>
 *   scheme  = saskill:SkillScheme
 *
 * Per-agent claim resolution does NOT happen here — for that, read
 * directly from `AgentSkillRegistry` via the SDK's `AgentSkillClient`.
 * GraphDB only knows about the skill *taxonomy*, not which agent has
 * which claim.
 */

import { PREFIXES } from './sparql'
import type { GraphDBClient } from './graphdb-client'

const SKILL_PREFIXES = `
${PREFIXES}
PREFIX saskill: <https://smartagent.io/ontology/skill#>
PREFIX skos:    <http://www.w3.org/2004/02/skos/core#>
`

export interface SkillConceptRef {
  iri: string
  prefLabel: string
  altLabels: string[]
}

/**
 * Resolve free-text input to skill concept IRIs.
 *
 * v0 strategy: case-insensitive match against `skos:prefLabel` and
 * `skos:altLabel`. Returns ranked by (prefLabel match > altLabel match,
 * then alphabetic).
 */
export function expandSkillConceptQuery(text: string, limit = 10): string {
  // Lower-case the term and escape inside the regex.
  const term = text.toLowerCase().replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  return `${SKILL_PREFIXES}
SELECT ?skill ?prefLabel (GROUP_CONCAT(DISTINCT ?altLabel ; separator="|") AS ?altLabels) ?prefMatch WHERE {
  ?skill a saskill:Skill ;
         skos:prefLabel ?prefLabel .
  OPTIONAL { ?skill skos:altLabel ?altLabel . }
  BIND(IF(REGEX(LCASE(STR(?prefLabel)), "${term}"), 1, 0) AS ?prefMatch)
  FILTER (
    REGEX(LCASE(STR(?prefLabel)), "${term}")
    || REGEX(LCASE(STR(?altLabel)), "${term}")
  )
}
GROUP BY ?skill ?prefLabel ?prefMatch
ORDER BY DESC(?prefMatch) ?prefLabel
LIMIT ${limit}`
}

/**
 * List every skill concept, paginated. Used by the profile UI to
 * populate a skill picker. v0 returns the hand-curated set in
 * `cbox/skill-vocabulary.ttl`.
 */
export function allSkillsQuery(opts: { offset?: number; limit?: number } = {}): string {
  const offset = opts.offset ?? 0
  const limit  = Math.min(opts.limit ?? 100, 500)
  return `${SKILL_PREFIXES}
SELECT ?skill ?prefLabel (GROUP_CONCAT(DISTINCT ?altLabel ; separator="|") AS ?altLabels) WHERE {
  ?skill a saskill:Skill ;
         skos:prefLabel ?prefLabel .
  OPTIONAL { ?skill skos:altLabel ?altLabel . }
}
GROUP BY ?skill ?prefLabel
ORDER BY ?prefLabel
OFFSET ${offset} LIMIT ${limit}`
}

/**
 * Resolve a single skill IRI to its label + altLabels. Cheap reverse
 * lookup used to render claim rows on a profile.
 */
export function skillByIriQuery(iri: string): string {
  return `${SKILL_PREFIXES}
SELECT ?prefLabel (GROUP_CONCAT(DISTINCT ?altLabel ; separator="|") AS ?altLabels) WHERE {
  <${iri}> a saskill:Skill ;
           skos:prefLabel ?prefLabel .
  OPTIONAL { <${iri}> skos:altLabel ?altLabel . }
}
GROUP BY ?prefLabel`
}

/**
 * Walk `^skos:broader*` from `seedIri` to collect every narrower
 * descendant concept (the seed itself is included). v1 SKOS
 * narrower-expansion query: a search for "nonprofit development"
 * pulls in grant-writing, volunteer-coordination, etc.
 *
 * The property path `^skos:broader*` is GraphDB's idiom for inverse
 * traversal — semantically equivalent to `skos:narrower*` but doesn't
 * require the vocabulary to assert the inverse triples explicitly
 * (our cbox uses skos:broader exclusively).
 */
export function narrowerConceptsQuery(seedIri: string, limit = 100): string {
  return `${SKILL_PREFIXES}
SELECT DISTINCT ?skill ?prefLabel (GROUP_CONCAT(DISTINCT ?altLabel ; separator="|") AS ?altLabels) ?depth WHERE {
  {
    BIND(<${seedIri}> AS ?skill)
    BIND(0 AS ?depth)
  }
  UNION
  {
    ?skill (^skos:broader)+ <${seedIri}> .
    BIND(1 AS ?depth)
  }
  ?skill a saskill:Skill ;
         skos:prefLabel ?prefLabel .
  OPTIONAL { ?skill skos:altLabel ?altLabel . }
}
GROUP BY ?skill ?prefLabel ?depth
ORDER BY ?depth ?prefLabel
LIMIT ${limit}`
}

/**
 * Narrower expansion accepting free-text. Resolves the term to a
 * seed concept (best prefLabel match), then walks `^skos:broader*`.
 * Returns the seed plus its descendants in a single round trip.
 */
export function expandConceptWithNarrowerQuery(text: string, limit = 100): string {
  const term = text.toLowerCase().replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  return `${SKILL_PREFIXES}
SELECT DISTINCT ?skill ?prefLabel (GROUP_CONCAT(DISTINCT ?altLabel ; separator="|") AS ?altLabels) ?depth WHERE {
  {
    SELECT ?seed (MIN(?d) AS ?seedDepth) WHERE {
      ?seed a saskill:Skill ;
            skos:prefLabel ?seedLabel .
      OPTIONAL { ?seed skos:altLabel ?seedAlt . }
      FILTER (
        REGEX(LCASE(STR(?seedLabel)), "${term}")
        || REGEX(LCASE(STR(?seedAlt)), "${term}")
      )
      BIND(0 AS ?d)
    }
    GROUP BY ?seed
    ORDER BY ?seedDepth ?seed
    LIMIT 1
  }
  {
    BIND(?seed AS ?skill)
    BIND(0 AS ?depth)
  }
  UNION
  {
    ?skill (^skos:broader)+ ?seed .
    BIND(1 AS ?depth)
  }
  ?skill a saskill:Skill ;
         skos:prefLabel ?prefLabel .
  OPTIONAL { ?skill skos:altLabel ?altLabel . }
}
GROUP BY ?skill ?prefLabel ?depth
ORDER BY ?depth ?prefLabel
LIMIT ${limit}`
}

/**
 * Build the variable-list (`VALUES ?targetSkill { <iri1> <iri2> … }`)
 * needed to plug an expanded concept set into a GRAPH-qualified
 * agent-search SPARQL query. Helper kept here so callers can
 * compose with custom outer queries (e.g. trust-search joining
 * geo + skill).
 */
export function valuesClauseFromConcepts(refs: { iri: string }[]): string {
  if (refs.length === 0) return 'VALUES ?targetSkill { }'
  return `VALUES ?targetSkill { ${refs.map(r => `<${r.iri}>`).join(' ')} }`
}

/**
 * Thin client wrapper. Mirrors `GeoDiscoveryClient`.
 */
export class SkillDiscoveryClient {
  constructor(private readonly graphdb: GraphDBClient) {}

  /** Free-text → ranked concept refs. */
  async expandConcept(text: string, limit = 10): Promise<SkillConceptRef[]> {
    if (!text.trim()) return []
    const res = await this.graphdb.query(expandSkillConceptQuery(text.trim(), limit))
    return res.results.bindings.map(b => ({
      iri: b.skill?.value ?? '',
      prefLabel: b.prefLabel?.value ?? '',
      altLabels: (b.altLabels?.value ?? '').split('|').filter(Boolean),
    }))
  }

  /** Paginated skill catalog. */
  async listSkills(opts: { offset?: number; limit?: number } = {}): Promise<SkillConceptRef[]> {
    const res = await this.graphdb.query(allSkillsQuery(opts))
    return res.results.bindings.map(b => ({
      iri: b.skill?.value ?? '',
      prefLabel: b.prefLabel?.value ?? '',
      altLabels: (b.altLabels?.value ?? '').split('|').filter(Boolean),
    }))
  }

  /** Resolve one IRI to label + altLabels. Returns null when not found. */
  async getByIri(iri: string): Promise<SkillConceptRef | null> {
    const res = await this.graphdb.query(skillByIriQuery(iri))
    const b = res.results.bindings[0]
    if (!b) return null
    return {
      iri,
      prefLabel: b.prefLabel?.value ?? '',
      altLabels: (b.altLabels?.value ?? '').split('|').filter(Boolean),
    }
  }

  /**
   * Expand a seed concept IRI to itself plus every narrower descendant.
   * Returned refs include a `depth` field (0 = seed, 1+ = descendants
   * via inverse skos:broader).
   */
  async expandNarrower(seedIri: string, limit = 100): Promise<(SkillConceptRef & { depth: number })[]> {
    if (!seedIri) return []
    const res = await this.graphdb.query(narrowerConceptsQuery(seedIri, limit))
    return res.results.bindings.map(b => ({
      iri: b.skill?.value ?? '',
      prefLabel: b.prefLabel?.value ?? '',
      altLabels: (b.altLabels?.value ?? '').split('|').filter(Boolean),
      depth: Number(b.depth?.value ?? 0),
    }))
  }

  /**
   * Free-text → seed concept → narrower descendants in one round trip.
   * Returns an empty list when no concept matches the term. Use this
   * over `expandConcept` when the caller wants narrower-aware ranking
   * (the broad term should match agents whose claims point to any
   * descendant).
   */
  async expandConceptWithNarrower(
    text: string,
    limit = 100,
  ): Promise<(SkillConceptRef & { depth: number })[]> {
    if (!text.trim()) return []
    const res = await this.graphdb.query(expandConceptWithNarrowerQuery(text.trim(), limit))
    return res.results.bindings.map(b => ({
      iri: b.skill?.value ?? '',
      prefLabel: b.prefLabel?.value ?? '',
      altLabels: (b.altLabels?.value ?? '').split('|').filter(Boolean),
      depth: Number(b.depth?.value ?? 0),
    }))
  }
}
