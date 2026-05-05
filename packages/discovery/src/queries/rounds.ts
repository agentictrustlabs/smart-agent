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
 *     requiredCredentials, visibility, proposalsReceived,
 *     onChainAssertionId
 *   }
 *
 * The mandate-match join + JSON unpacking happens in the discovery
 * service result parser, not here — SPARQL only narrows the candidate
 * set.
 */
export function listRoundsQuery(
  filters: RoundListFilters,
  /** Pre-fetched viewer-intent JSON literals to feed into the mandate-match filter. */
  viewerIntents: ReadonlyArray<{ id: string; kind?: string; geo?: string }> = [],
): string {
  const conds: string[] = []

  if (filters.search) {
    const s = escapeLit(filters.search.toLowerCase())
    conds.push(`FILTER(
      CONTAINS(LCASE(STR(?mandate)), "${s}") ||
      CONTAINS(LCASE(STR(COALESCE(?fundName, ""))), "${s}")
    )`)
  }

  if (filters.budgetMin !== undefined || filters.budgetMax !== undefined) {
    // Mandate is stored as a JSON literal; we can't filter by an inner
    // numeric here. Caller does the budget range check after JSON
    // parsing in the discovery service.
  }

  if (filters.deadlineHorizon && filters.deadlineHorizon !== 'all') {
    // Server-side deadline filter — the deadline is xsd:dateTime so we
    // can compare directly. The exact horizon math (e.g., this-week)
    // happens in the SPARQL by computing NOW + offset days.
    const days =
      filters.deadlineHorizon === 'this-week' ? 7 :
      filters.deadlineHorizon === 'this-month' ? 30 : 90
    conds.push(
      `FILTER(?deadlineDt <= (NOW() + "P${days}D"^^xsd:duration))`,
    )
    conds.push(`FILTER(?deadlineDt >= NOW())`)
  } else if (!filters.includeClosed) {
    conds.push(`FILTER(?deadlineDt >= NOW())`)
  }

  // Visibility gate: include 'public' always; 'private' is filtered to
  // those whose addressedApplicants includes the viewer (resolved in the
  // action layer — SPARQL only sees the coarse anchor for private rounds).
  // For the SPARQL we include both visibilities and let the parser drop
  // any private rounds the viewer is not addressed to.

  // Optional viewer-intent filter — used for mandate-match badging. We
  // don't restrict the result set (FR-001 says "rounds eligible for your
  // intent" but the UI is browse-with-badge; non-matching rounds remain
  // visible per spec.md). The intent list is parameterized so the
  // discovery service can post-process matches in TS.
  void viewerIntents

  // Domain filter — narrows by mandate.acceptedKinds JSON-literal substring.
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
       (?deadline AS ?deadlineDt)
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
