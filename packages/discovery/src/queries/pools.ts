/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pool SPARQL builders.
 *
 * Reads the public mirror of `sa:Pool` (and synthetic
 * `sa:PoolOpenedAssertion` / `sa:PoolPledgedTotalAssertion` mirror nodes)
 * populated by the on-chain → GraphDB sync at
 * `apps/web/src/lib/ontology/graphdb-sync.ts`.
 *
 * Visibility gate (FR-003): private pools surface in the public mirror as
 * coarse anchors WITHOUT the `addressedMembers` list. The action layer
 * resolves the addressed list via the pool's org-mcp before rendering the
 * pool to a non-addressed viewer.
 *
 * Filters: domain (substring), governance model, geo, free-text — applied
 * server-side where they map cleanly to a single triple; structured filters
 * (like the JSON-literal mandate) are applied post-parse in the action
 * layer (mirrors the rounds pattern).
 */

import { PREFIXES, DATA_GRAPH } from '../sparql'
import type { PoolListFilters } from '../types'

function g(): string { return `GRAPH <${DATA_GRAPH}>` }

function escapeLit(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * SPARQL builder for the pools index page. Returns rows shaped:
 *   {
 *     pool, id, name, domain, mandate, governanceModel,
 *     acceptedRestrictions, acceptedUnits, capacityCeiling, ceilingPolicy,
 *     addressedTo, addressedMembers, visibility, stewardshipAgent, stewards,
 *     acceptsOpenCalls, pledgedTotal, allocatedTotal, availableTotal,
 *     onChainAssertionId
 *   }
 */
export function listPoolsQuery(filters: PoolListFilters): string {
  const conds: string[] = []

  if (filters.search) {
    const s = escapeLit(filters.search.toLowerCase())
    conds.push(`FILTER(
      CONTAINS(LCASE(STR(COALESCE(?mandate, ""))), "${s}") ||
      CONTAINS(LCASE(STR(COALESCE(?name, ""))), "${s}")
    )`)
  }

  if (filters.domain) {
    const d = escapeLit(filters.domain)
    conds.push(`FILTER(STR(?domain) = "${d}")`)
  }

  if (filters.governanceModel) {
    const gm = escapeLit(filters.governanceModel)
    conds.push(`FILTER(STR(?governanceModel) = "${gm}")`)
  }

  if (filters.geo) {
    const geo = escapeLit(filters.geo.toLowerCase())
    // Geo lives inside the JSON-literal mandate / acceptedRestrictions;
    // CONTAINS the loose serialized form for the index narrow.
    conds.push(`FILTER(
      CONTAINS(LCASE(STR(COALESCE(?mandate, ""))), "${geo}") ||
      CONTAINS(LCASE(STR(COALESCE(?acceptedRestrictions, ""))), "${geo}")
    )`)
  }

  return `${PREFIXES}

SELECT ?pool ?poolId ?name ?domain ?mandate ?governanceModel
       ?acceptedRestrictions ?acceptedUnits ?capacityCeiling ?ceilingPolicy
       ?addressedTo ?addressedMembers ?visibility
       ?stewardshipAgent ?treasuryAgent ?stewards ?acceptsOpenCalls
       ?pledgedTotal ?allocatedTotal ?availableTotal
       ?onChainAssertionId
WHERE {
  ${g()} {
    ?pool a sa:Pool .
    BIND(STR(?pool) AS ?poolId)

    OPTIONAL { ?pool sa:displayName ?name }
    OPTIONAL { ?pool sa:domain ?domain }
    OPTIONAL { ?pool sa:poolMandate ?mandate }
    OPTIONAL { ?pool sa:governanceModel ?governanceModel }
    OPTIONAL { ?pool sa:acceptedRestrictions ?acceptedRestrictions }
    OPTIONAL { ?pool sa:acceptsUnit ?acceptedUnits }
    OPTIONAL { ?pool sa:capacityCeiling ?capacityCeiling }
    OPTIONAL { ?pool sa:ceilingPolicy ?ceilingPolicy }
    OPTIONAL { ?pool sa:addressedTo ?addressedTo }
    OPTIONAL { ?pool sa:addressedMembers ?addressedMembers }
    OPTIONAL { ?pool sa:visibility ?visibility }
    OPTIONAL { ?pool sa:stewardshipAgent ?stewardshipAgent }
    OPTIONAL { ?pool sa:treasuryAgent ?treasuryAgent }
    OPTIONAL { ?pool sa:steward ?stewards }
    OPTIONAL { ?pool sa:acceptsOpenCalls ?acceptsOpenCalls }
    OPTIONAL { ?pool sa:pledgedTotal ?pledgedTotal }
    OPTIONAL { ?pool sa:allocatedTotal ?allocatedTotal }
    OPTIONAL { ?pool sa:availableTotal ?availableTotal }
    OPTIONAL { ?pool sa:onChainAssertionId ?onChainAssertionId }

    ${conds.join('\n    ')}
  }
}
ORDER BY ASC(?name)
`
}

/**
 * SPARQL builder for the pool detail page. Pulls a single pool by IRI
 * with all body fields.
 */
export function poolDetailQuery(poolId: string): string {
  const id = escapeLit(poolId)
  return `${PREFIXES}

SELECT ?pool ?name ?domain ?mandate ?governanceModel
       ?acceptedRestrictions ?acceptedUnits ?capacityCeiling ?ceilingPolicy
       ?addressedTo ?addressedMembers ?visibility
       ?stewardshipAgent ?treasuryAgent ?stewards ?acceptsOpenCalls
       ?pledgedTotal ?allocatedTotal ?availableTotal
       ?onChainAssertionId
WHERE {
  ${g()} {
    BIND(IRI("${id}") AS ?pool)
    ?pool a sa:Pool .

    OPTIONAL { ?pool sa:displayName ?name }
    OPTIONAL { ?pool sa:domain ?domain }
    OPTIONAL { ?pool sa:poolMandate ?mandate }
    OPTIONAL { ?pool sa:governanceModel ?governanceModel }
    OPTIONAL { ?pool sa:acceptedRestrictions ?acceptedRestrictions }
    OPTIONAL { ?pool sa:acceptsUnit ?acceptedUnits }
    OPTIONAL { ?pool sa:capacityCeiling ?capacityCeiling }
    OPTIONAL { ?pool sa:ceilingPolicy ?ceilingPolicy }
    OPTIONAL { ?pool sa:addressedTo ?addressedTo }
    OPTIONAL { ?pool sa:addressedMembers ?addressedMembers }
    OPTIONAL { ?pool sa:visibility ?visibility }
    OPTIONAL { ?pool sa:stewardshipAgent ?stewardshipAgent }
    OPTIONAL { ?pool sa:treasuryAgent ?treasuryAgent }
    OPTIONAL { ?pool sa:steward ?stewards }
    OPTIONAL { ?pool sa:acceptsOpenCalls ?acceptsOpenCalls }
    OPTIONAL { ?pool sa:pledgedTotal ?pledgedTotal }
    OPTIONAL { ?pool sa:allocatedTotal ?allocatedTotal }
    OPTIONAL { ?pool sa:availableTotal ?availableTotal }
    OPTIONAL { ?pool sa:onChainAssertionId ?onChainAssertionId }
  }
}
LIMIT 1
`
}
