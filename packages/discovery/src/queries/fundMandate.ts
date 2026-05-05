/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Fund-mandate SPARQL.
 *
 * Reads `sa:Fund` mandate fields + `sa:acceptsOpenCalls` from the public
 * agent metadata in GraphDB. Used by Q5 / FR-014 open-call eligibility
 * checks at submit time (`grant_proposal:submit`) when `roundId === null`.
 *
 * Fund typing was established by spec 002:
 *   `sa:Fund subClassOf sa:Pool`, with SHACL `FundGovernanceModelConsistencyShape`
 *   asserting `sa:governanceModel "fund"` on every Fund instance.
 *
 * The mandate fields here are agent-profile extensions on the pool agent
 * (acceptedUnits, ceilingPolicy, capacityCeiling, acceptsOpenCalls per
 * IA § 2.5) — not separate triples.
 */

import { PREFIXES, DATA_GRAPH } from '../sparql'

function g(): string { return `GRAPH <${DATA_GRAPH}>` }

function lcase(addr: string): string { return addr.toLowerCase() }

/**
 * Build the SPARQL for reading a fund's mandate-bearing fields. Returns
 * one row max; the action layer parses JSON literals where applicable.
 *
 * Result columns: ?fund ?fundName ?governanceModel ?acceptsOpenCalls
 *                 ?acceptedUnits ?ceilingPolicy ?capacityCeiling
 *                 ?fundMandate
 */
export function fundMandateQuery(fundAgentId: string): string {
  const a = lcase(fundAgentId)
  return `${PREFIXES}
SELECT ?fund ?fundName ?governanceModel ?acceptsOpenCalls
       ?ceilingPolicy ?capacityCeiling ?fundMandate
       (GROUP_CONCAT(DISTINCT ?acceptedUnit; separator="||") AS ?acceptedUnits)
WHERE {
  ${g()} {
    ?fund sa:onChainAddress ?addr .
    FILTER(LCASE(?addr) = "${a}")
    OPTIONAL { ?fund sa:displayName ?fundName }
    OPTIONAL { ?fund sa:governanceModel ?governanceModel }
    OPTIONAL { ?fund sa:acceptsOpenCalls ?acceptsOpenCalls }
    OPTIONAL { ?fund sa:acceptsUnit ?acceptedUnit }
    OPTIONAL { ?fund sa:ceilingPolicy ?ceilingPolicy }
    OPTIONAL { ?fund sa:capacityCeiling ?capacityCeiling }
    OPTIONAL { ?fund sa:fundMandate ?fundMandate }
  }
}
GROUP BY ?fund ?fundName ?governanceModel ?acceptsOpenCalls
         ?ceilingPolicy ?capacityCeiling ?fundMandate
LIMIT 1
`
}
