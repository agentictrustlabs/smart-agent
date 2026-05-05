/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Prior-stats SPARQL.
 *
 * Returns fund / proposer prior outcomes by domain. Read-only here; the
 * data populates as the downstream review/award spec ships its public
 * award assertions (`sa:AwardAssertion` etc., not declared here).
 *
 * For v1 there are NO award assertions in GraphDB, so all queries
 * return empty results — but the shape is stable so US4 (T048) can wire
 * `stewardSideSignals` to `(fulfilled, abandoned)` tuples without
 * further plumbing changes.
 *
 * Supports FR-016 / FR-017 outcome-score signals.
 */

import { PREFIXES, DATA_GRAPH } from '../sparql'

function g(): string { return `GRAPH <${DATA_GRAPH}>` }

function lcase(addr: string): string { return addr.toLowerCase() }

/**
 * Fund-side prior outcomes filtered by intent-domain (kind set).
 * Returns (fulfilled, abandoned) totals over the fund's prior awards
 * whose proposal mandate-domain overlaps the supplied `domains`.
 *
 * Query result rows:
 *   { fundAgentId, fulfilled: int, abandoned: int }
 *
 * Falls back to fund-wide outcomes via a separate call when zero
 * domain-matched awards exist (Research R6) — that fall-back is
 * computed in the caller, not in this single SPARQL.
 *
 * In v1 (no award triples in GraphDB) this query returns a single row
 * with both counts at 0 for any input — by design (Research R6).
 */
export function fundPriorOutcomesByDomainQuery(
  fundAgentId: string,
  domains: string[],
): string {
  const a = lcase(fundAgentId)
  const domainFilter = domains.length === 0
    ? ''
    : `FILTER(?domain IN (${domains.map(d => `"${d.replace(/"/g, '\\"')}"`).join(', ')}))`

  return `${PREFIXES}
SELECT ?fundAgentId
       (COUNT(DISTINCT ?fulfilledAward) AS ?fulfilled)
       (COUNT(DISTINCT ?abandonedAward) AS ?abandoned)
WHERE {
  ${g()} {
    BIND("${a}" AS ?fundAgentId)
    OPTIONAL {
      # Placeholder: downstream award spec emits sa:AwardAssertion with
      # sa:awardingFund, sa:awardOutcome (fulfilled|abandoned), and
      # sa:awardDomain (a SKOS concept from intent-types.ttl). v1 returns
      # no rows here — see file header.
      ?fulfilledAward a sa:AwardAssertion ;
                      sa:awardingFund ?fund ;
                      sa:awardOutcome "fulfilled" ;
                      sa:awardDomain ?domain .
      ?fund sa:onChainAddress ?fa .
      FILTER(LCASE(?fa) = "${a}")
      ${domainFilter}
    }
    OPTIONAL {
      ?abandonedAward a sa:AwardAssertion ;
                      sa:awardingFund ?fund2 ;
                      sa:awardOutcome "abandoned" ;
                      sa:awardDomain ?domain .
      ?fund2 sa:onChainAddress ?fa2 .
      FILTER(LCASE(?fa2) = "${a}")
      ${domainFilter}
    }
  }
}
GROUP BY ?fundAgentId
`
}

/**
 * Proposer-side prior outcomes — the proposer's own (fulfilled, abandoned)
 * ratio across all of their completed grant cycles. Used by stewardSideSignals
 * (T047 — US4).
 *
 * In v1 (no award triples in GraphDB) returns (0, 0).
 */
export function proposerPriorOutcomesQuery(proposerAgentId: string): string {
  const a = lcase(proposerAgentId)
  return `${PREFIXES}
SELECT ?proposerAgentId
       (COUNT(DISTINCT ?fulfilledAward) AS ?fulfilled)
       (COUNT(DISTINCT ?abandonedAward) AS ?abandoned)
WHERE {
  ${g()} {
    BIND("${a}" AS ?proposerAgentId)
    OPTIONAL {
      ?fulfilledAward a sa:AwardAssertion ;
                      sa:awardedTo ?proposer ;
                      sa:awardOutcome "fulfilled" .
      ?proposer sa:onChainAddress ?pa .
      FILTER(LCASE(?pa) = "${a}")
    }
    OPTIONAL {
      ?abandonedAward a sa:AwardAssertion ;
                      sa:awardedTo ?proposer2 ;
                      sa:awardOutcome "abandoned" .
      ?proposer2 sa:onChainAddress ?pa2 .
      FILTER(LCASE(?pa2) = "${a}")
    }
  }
}
GROUP BY ?proposerAgentId
`
}
