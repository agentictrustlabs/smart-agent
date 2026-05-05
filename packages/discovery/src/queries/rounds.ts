/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Round SPARQL builders.
 *
 * Reads the public mirror of `sa:RoundOpenedAssertion` / `sa:RoundClosedAssertion`
 * triples (populated by the on-chain → GraphDB sync at
 * `apps/web/src/lib/ontology/graphdb-sync.ts`).
 *
 * Mandate-match badging (FR-001 / Research R2): the viewer's intents are
 * joined to round.mandate.acceptedKinds / acceptedGeo via JSON-literal
 * filters. The full overlap test (kind / geo containment / budget) is
 * applied here for the badge; the same pattern feeds proposer-side rank
 * (FR-016).
 *
 * Visibility gate (FR-003): private rounds appear in the public mirror as
 * coarse anchors WITHOUT the addressed-applicants list. The action layer is
 * responsible for resolving the addressed list via the fund's org-mcp
 * (`round:read_addressed_list` cross-delegation) before showing private
 * rounds to a non-addressed viewer.
 */

import { PREFIXES, DATA_GRAPH } from '../sparql'
import type { RoundListFilters } from '../types'

function g(): string { return `GRAPH <${DATA_GRAPH}>` }

function escapeLit(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * SPARQL builder for the rounds index page. Pulls every round in the
 * public mirror (subject to filters), joins the viewer's intent set
 * for mandate-match badging.
 *
 * Returns rows shaped:
 *   {
 *     round, id, fundAgentId, mandate, milestoneTemplate,
 *     validatorRequirements, reportingCadence, deadline, decisionDate,
 *     requiredCredentials, visibility, addressedApplicants,
 *     proposalsReceived, onChainAssertionId
 *   }
 *
 * The mandate-match join + JSON unpacking happens in the discovery
 * service result parser / action layer, not here — SPARQL only narrows
 * the candidate set on what it can match cheaply (deadline window,
 * search substring, visibility-or-addressed). Budget range and the
 * full mandate-overlap test (kind / geo containment) are applied
 * post-parse in the action layer (T032) because the mandate is a JSON
 * string literal — we can do `CONTAINS` substring filtering but not
 * structured numeric / array filtering.
 *
 * FR-001 / FR-002 / FR-003 implementation:
 *   - FR-001 (mandate-match badging): the `viewerIntents` arg is
 *     accepted here for future use; the actual overlap is computed
 *     post-parse in the action layer (cheaper + cleaner than building
 *     N SPARQL filter clauses).
 *   - FR-002 (filtering): domain (substring), deadline horizon,
 *     budget range, free-text search, includeClosed toggle.
 *     - domain / search / deadline: filtered server-side here.
 *     - budgetMin/Max: post-parse (mandate is JSON literal).
 *     - includeClosed: drives the `RoundClosedAssertion EXISTS`
 *       FILTER below.
 *   - FR-003 (private-round visibility gate): the SPARQL emits
 *     `addressedApplicants` as a JSON literal; the action layer
 *     drops private rounds whose addressed-applicants list does not
 *     include the viewer. (For v1, federated reads via
 *     `round:read_addressed_list` are deferred — public mirror is
 *     authoritative for the visible-or-addressed test.)
 */
export function listRoundsQuery(
  filters: RoundListFilters,
  /** Pre-fetched viewer-intent JSON literals — accepted for future use; current
   *  implementation computes the mandate-match badge in the action layer. */
  viewerIntents: ReadonlyArray<{ id: string; kind?: string; geo?: string }> = [],
): string {
  const conds: string[] = []

  if (filters.search) {
    const s = escapeLit(filters.search.toLowerCase())
    // Free-text across mandate / fund name / description fields. We use
    // CONTAINS over the JSON-literal string form, which is loose but
    // cheap. False positives are filtered out by the renderer when the
    // user clicks through.
    conds.push(`FILTER(
      CONTAINS(LCASE(STR(COALESCE(?mandate, ""))), "${s}") ||
      CONTAINS(LCASE(STR(COALESCE(?fundName, ""))), "${s}")
    )`)
  }

  // Budget range — applied post-parse in the action layer because the
  // mandate is stored as a JSON literal (`budgetCeiling` lives inside
  // the JSON string, not as a separate triple). The bounds reach the
  // result parser via the filters object directly.

  if (filters.deadlineHorizon && filters.deadlineHorizon !== 'all') {
    // Server-side deadline filter — the deadline is xsd:dateTime so we
    // can compare directly. The exact horizon math (e.g., this-week)
    // computes NOW + offset days using xsd:duration.
    const days =
      filters.deadlineHorizon === 'this-week' ? 7 :
      filters.deadlineHorizon === 'this-month' ? 30 : 90
    conds.push(
      `FILTER(xsd:dateTime(?deadline) <= (NOW() + "P${days}D"^^xsd:duration))`,
    )
    conds.push(`FILTER(xsd:dateTime(?deadline) >= NOW())`)
  } else if (!filters.includeClosed) {
    conds.push(`FILTER(xsd:dateTime(?deadline) >= NOW())`)
  }

  // viewerIntents accepted for future use (the mandate-match overlap is
  // computed post-parse in the action layer because the mandate is a
  // JSON literal — see FR-001 / Research R2).
  void viewerIntents

  // Domain filter — narrows by mandate JSON-literal substring. The
  // mandate JSON contains `acceptedKinds: ["..."]` so a CONTAINS over
  // the serialized form is sufficient for the index narrow.
  if (filters.domain) {
    const d = escapeLit(filters.domain)
    conds.push(`FILTER(CONTAINS(STR(?mandate), "${d}"))`)
  }

  return `${PREFIXES}
PREFIX p-plan: <http://purl.org/net/p-plan#>

SELECT ?round ?roundId ?fundAgentId ?fundName
       ?mandate ?milestoneTemplate ?validatorRequirements
       ?reportingCadence ?deadline ?decisionDate
       ?requiredCredentials ?visibility ?addressedApplicants
       ?proposalsReceived ?onChainAssertionId
WHERE {
  ${g()} {
    ?asn a sa:RoundOpenedAssertion ;
         sa:onChainAssertionId ?onChainAssertionId ;
         sa:subjectId ?subjectId .
    OPTIONAL { ?asn sa:payloadURI ?payloadURI }

    # Round entity (the subject) — bind from subjectId.
    BIND(IRI(CONCAT("urn:smart-agent:round:", STR(?subjectId))) AS ?round)
    BIND(STR(?subjectId) AS ?roundId)

    OPTIONAL { ?round sa:operatedByFund ?fundAgentId }
    OPTIONAL {
      ?fund sa:onChainAddress ?fundAgentId .
      ?fund sa:displayName ?fundName .
    }
    OPTIONAL { ?round sa:roundMandate ?mandate }
    OPTIONAL { ?round sa:milestoneTemplate ?milestoneTemplate }
    OPTIONAL { ?round sa:validatorRequirements ?validatorRequirements }
    OPTIONAL { ?round sa:reportingCadence ?reportingCadence }
    OPTIONAL { ?round sa:deadline ?deadline }
    OPTIONAL { ?round sa:decisionDate ?decisionDate }
    OPTIONAL { ?round sa:requiredCredentials ?requiredCredentials }
    OPTIONAL { ?round sa:visibility ?visibility }
    OPTIONAL { ?round sa:addressedApplicants ?addressedApplicants }
    OPTIONAL { ?round sa:proposalsReceived ?proposalsReceived }

    # Filter out closed rounds (matched RoundClosed anchor) unless includeClosed
    ${filters.includeClosed ? '' : `
    FILTER NOT EXISTS {
      ?closeAsn a sa:RoundClosedAssertion ;
                sa:subjectId ?subjectId .
    }`}

    ${conds.join('\n    ')}
  }
}
ORDER BY ASC(?deadline)
`
}

/**
 * SPARQL builder for the round detail page. Pulls a single round by IRI
 * with full mandate / milestone-template / validator / reporting fields.
 */
export function roundDetailQuery(roundId: string): string {
  const id = escapeLit(roundId)
  return `${PREFIXES}
PREFIX p-plan: <http://purl.org/net/p-plan#>

SELECT ?round ?fundAgentId ?fundName
       ?mandate ?milestoneTemplate ?validatorRequirements
       ?reportingCadence ?deadline ?decisionDate
       ?requiredCredentials ?visibility ?addressedApplicants
       ?proposalsReceived ?onChainAssertionId
WHERE {
  ${g()} {
    BIND(IRI("urn:smart-agent:round:${id}") AS ?round)

    OPTIONAL {
      ?asn a sa:RoundOpenedAssertion ;
           sa:subjectId ?subjectId ;
           sa:onChainAssertionId ?onChainAssertionId .
      FILTER(STR(?subjectId) = "${id}")
    }

    OPTIONAL { ?round sa:operatedByFund ?fundAgentId }
    OPTIONAL {
      ?fund sa:onChainAddress ?fundAgentId .
      ?fund sa:displayName ?fundName .
    }
    OPTIONAL { ?round sa:roundMandate ?mandate }
    OPTIONAL { ?round sa:milestoneTemplate ?milestoneTemplate }
    OPTIONAL { ?round sa:validatorRequirements ?validatorRequirements }
    OPTIONAL { ?round sa:reportingCadence ?reportingCadence }
    OPTIONAL { ?round sa:deadline ?deadline }
    OPTIONAL { ?round sa:decisionDate ?decisionDate }
    OPTIONAL { ?round sa:requiredCredentials ?requiredCredentials }
    OPTIONAL { ?round sa:visibility ?visibility }
    OPTIONAL { ?round sa:addressedApplicants ?addressedApplicants }
    OPTIONAL { ?round sa:proposalsReceived ?proposalsReceived }
  }
}
LIMIT 1
`
}
