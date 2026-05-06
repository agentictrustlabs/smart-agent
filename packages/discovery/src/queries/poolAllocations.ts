/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pool allocation SPARQL builder.
 *
 * Read-only here. Allocations are written by the downstream allocation /
 * disbursement spec (not yet shipped). v1 returns empty results — same
 * pattern as `priorStats.ts` for spec 003. The shape is stable; once the
 * downstream spec lands, this file becomes the canonical query.
 *
 * `storyPermissions`-aware aggregation (FR-006) is applied post-parse in
 * the discovery service: rows with `shareWithSupportTeam` are aggregated
 * into a `{kind: 'aggregated', count}` summary; rows with `anonymous`
 * surface as `'anonymized'`.
 */

import { PREFIXES, DATA_GRAPH } from '../sparql'

function g(): string { return `GRAPH <${DATA_GRAPH}>` }

function escapeLit(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * SPARQL builder for recent pool allocations. Returns rows shaped:
 *   {
 *     allocation, amount, unit, awardedTo, awardedAt, outcomeStatus,
 *     storyPermissions
 *   }
 *
 * In v1 there are no `sa:PoolAllocationAssertion` triples in the public
 * mirror so this query returns empty bindings. Kept here so the discovery
 * service surface is stable.
 */
export function listRecentAllocationsQuery(poolId: string, limit = 5): string {
  const id = escapeLit(poolId)
  const lim = Math.max(1, Math.min(50, Math.floor(limit)))
  return `${PREFIXES}

SELECT ?allocation ?amount ?unit ?awardedTo ?awardedAt ?outcomeStatus ?storyPermissions
WHERE {
  ${g()} {
    ?allocation a sa:PoolAllocationAssertion ;
                sa:targetPool ?pool .
    FILTER(STR(?pool) = "${id}")
    OPTIONAL { ?allocation sa:allocationAmount ?amount }
    OPTIONAL { ?allocation sa:allocationUnit ?unit }
    OPTIONAL { ?allocation sa:awardedTo ?awardedTo }
    OPTIONAL { ?allocation sa:awardedAt ?awardedAt }
    OPTIONAL { ?allocation sa:awardOutcome ?outcomeStatus }
    OPTIONAL { ?allocation sa:storyPermissions ?storyPermissions }
  }
}
ORDER BY DESC(?awardedAt)
LIMIT ${lim}
`
}
