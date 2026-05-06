/**
 * Spec 001 — Intent Marketplace (Direct Lane). MatchInitiation SPARQL builders.
 *
 * Reads the public mirror of `sa:MatchInitiationAssertion` triples (populated
 * by the on-chain → GraphDB sync). Private-tier initiations never reach
 * GraphDB (IA P4 / SHACL `sa:PrivateIntentInitiationNoAnchorShape`).
 *
 * Used by FR-019 ("view existing match" affordance) — discovery layer
 * surfaces public-tier `pending` initiations on a given pair so the UI can
 * show "view existing match" instead of "propose match".
 */

import { PREFIXES, DATA_GRAPH } from '../sparql'

function g(): string { return `GRAPH <${DATA_GRAPH}>` }

function escapeLit(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * Returns active (status='pending') MatchInitiations referencing the given
 * intent on either side. Only public-tier initiations appear in the mirror.
 * Private-tier initiations are surfaced through the initiator's MCP via
 * `match_initiation:read` (initiator-only) — discovery never sees them.
 */
export function listActiveInitiationsForIntentQuery(intentId: string): string {
  const idEsc = escapeLit(intentId)
  return `${PREFIXES}
SELECT ?initiation ?onChainAssertionId ?initiatorAgentId ?viewedIntentId ?candidateIntentId ?initiationKind ?proposedAt ?status ?visibility
WHERE {
  ${g()} {
    ?asn a sa:MatchInitiationAssertion ;
         sa:onChainAssertionId ?onChainAssertionId ;
         sa:subjectId ?subjectId .

    BIND(IRI(CONCAT("urn:smart-agent:match-initiation:", STR(?subjectId))) AS ?initiation)

    OPTIONAL { ?initiation sa:viewedIntent ?viewedIntentId }
    OPTIONAL { ?initiation sa:candidateIntent ?candidateIntentId }
    OPTIONAL { ?initiation sa:initiator ?initiatorAgentId }
    OPTIONAL { ?initiation sa:initiationKind ?initiationKind }
    OPTIONAL { ?initiation sa:proposedAt ?proposedAt }
    OPTIONAL { ?initiation sa:status ?status }
    OPTIONAL { ?initiation sa:visibility ?visibility }

    # Reference the intent on either side.
    FILTER(STR(?viewedIntentId) = "${idEsc}" || STR(?candidateIntentId) = "${idEsc}")

    # Active: only 'pending' rows count for FR-019 duplicate prevention.
    FILTER(!BOUND(?status) || ?status = "pending")
  }
}
`
}
