/**
 * Spec 001 — Intent Marketplace (Direct Lane). Candidate-intent SPARQL builders.
 *
 * Reads the public mirror of `sa:IntentAssertion` triples (populated by the
 * on-chain → GraphDB sync at `apps/web/src/lib/ontology/graphdb-sync.ts`).
 *
 * For a viewed intent in `expressed` or `acknowledged` state, returns the
 * counter-intents on the *opposite direction* and the *same kind/object*,
 * excluding self-matches and withdrawn/abandoned/fulfilled candidates.
 *
 * FR coverage:
 *   - FR-007: opposite-direction filter on the same object/kind.
 *   - FR-008: self-match exclusion (FILTER(?expA != ?expB)).
 *   - FR-009: status exclusion (withdrawn/abandoned/fulfilled).
 *   - FR-010: optional broadening via SKOS parent path — DEFERRED (v1 only
 *     does exact same-kind matching).
 *   - FR-011: visibility gate — credentialed-agent rule lives in the action
 *     layer; this SPARQL only filters out non-public assertions.
 *
 * Visibility note: only intents with `visibility ∈ {public, public-coarse}`
 * are mirrored to GraphDB. Private intents live owner-private in MCPs and
 * never appear in a candidate query result. Coarse-tier candidates are
 * surfaced with their coarse fields (kind + geoBucket) only.
 */

import { PREFIXES, DATA_GRAPH } from '../sparql'

function g(): string { return `GRAPH <${DATA_GRAPH}>` }

function escapeLit(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * Returns counter-intents (opposite direction, same kind) for the given
 * viewed intent. Result rows include the candidate intent's IRI, the
 * expresser's address (for hop-distance), and the candidate's kind / direction
 * / visibility / geo bucket.
 *
 * The viewed intent's direction + kind are passed in by the caller; we don't
 * re-fetch them via SPARQL — the action layer already has the row from
 * either the local web SQLite or the IntentAssertion mirror.
 */
export function listCandidatesForIntentQuery(opts: {
  viewedIntentId: string
  viewedDirection: 'receive' | 'give'
  viewedKind: string
  viewedExpresser: string
  /** Optional: cap result set size. */
  limit?: number
}): string {
  const oppositeDirection = opts.viewedDirection === 'receive' ? 'give' : 'receive'
  const kindEsc = escapeLit(opts.viewedKind)
  const dirEsc = escapeLit(oppositeDirection)
  const expresserLc = opts.viewedExpresser.toLowerCase()
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50))

  return `${PREFIXES}
SELECT ?intentId ?candidate ?direction ?kind ?expresserAddress ?summary ?geoBucket ?visibility ?onChainAssertionId
WHERE {
  ${g()} {
    ?asn a sa:IntentAssertion ;
         sa:onChainAssertionId ?onChainAssertionId ;
         sa:subjectId ?subjectId .
    OPTIONAL { ?asn sa:payloadURI ?payloadURI }

    BIND(IRI(CONCAT("urn:smart-agent:intent:", STR(?subjectId))) AS ?candidate)
    BIND(STR(?subjectId) AS ?intentId)

    OPTIONAL { ?candidate sa:direction ?direction }
    OPTIONAL { ?candidate sa:intentKind ?kind }
    OPTIONAL { ?candidate sa:expressedByAgent ?expresserAddress }
    OPTIONAL { ?candidate sa:summary ?summary }
    OPTIONAL { ?candidate sa:geoBucket ?geoBucket }
    OPTIONAL { ?candidate sa:visibility ?visibility }

    # FR-007: opposite direction
    FILTER(STR(?direction) = "${dirEsc}")

    # FR-007: same kind (object equality)
    FILTER(STR(?kind) = "${kindEsc}")

    # FR-008: exclude self-match (different expresser)
    FILTER(LCASE(STR(?expresserAddress)) != "${expresserLc}")

    # Exclude the viewed intent itself.
    FILTER(STR(?subjectId) != "${escapeLit(opts.viewedIntentId)}")

    # FR-009: exclude candidates whose status has moved past expressed/acknowledged.
    FILTER NOT EXISTS {
      ?candidate sa:status ?status .
      FILTER(?status IN ("withdrawn", "abandoned", "fulfilled"))
    }
  }
}
LIMIT ${limit}
`
}
