# Phase 0 — Research: Intent Marketplace (Direct Lane)

## R1. MatchInitiation persistence shape

**Decision**: Body lives in the **initiator's MCP** (`apps/person-mcp/src/db/schema.ts` for individual initiators; the org-mcp twin for org initiators) in a new `match_initiations` table. A conditional on-chain assertion (`sa:MatchInitiationAssertion`) is minted via the existing `emitOnChainAssertion` path in `apps/person-mcp/src/tools/intents.ts` (and its org-mcp twin) — but **only when both referenced intents have already minted their own public on-chain assertions**. The on-chain → GraphDB sync indexes the public mirror in `DATA_GRAPH`. Reads of the public mirror go through `@smart-agent/discovery`; reads of private rows go through the initiator's MCP.

**Rationale** — per IA § 1 + § 2.1:
- *Body in MCP* — owner-routing (P1) + public/private split is physical (P4). A connector-mode initiation references two intents the connector does not own; the connector's MCP is the single owner of the artifact (Audit § 2 O10; `sa:initiator` is `owl:FunctionalProperty`).
- *Conditional on-chain anchor* — anchored only when visibility is `public` or `public-coarse`, which is derived as the *strictest* of the two referenced intents' visibilities (see § R3 below). SHACL `sa:PrivateIntentInitiationNoAnchorShape` (`docs/ontology/tbox/shacl/visibility.ttl`) enforces "no anchor when any source intent is private" — a private intent's IRI must never appear in a public triple.
- *No GraphDB-as-truth* — the MCP→GraphDB pipe is forbidden (IA P4). GraphDB only ever holds an instance of `sa:MatchInitiationAssertion` if a public on-chain assertion published it first.

**Body layout** (per IA § 2.1):

```ts
match_initiations {
  id              IRI primary key,
  principal       not null,                 // = initiator agent id (the row's owner)
  viewedIntentId  IRI,                      // counter-party intent
  candidateIntentId IRI,                    // counter-party intent
  initiatorAgentId IRI,                     // == principal (redundant but mirrors spec contract field)
  initiationKind  enum('self','connector'),
  proposedAt      timestamp,
  basis           json,                     // RankBasis snapshot
  status          enum('pending','superseded','consumed'),
  visibility      enum('public','public-coarse','private','off-chain'),
  onChainAssertionId IRI nullable,
  createdAt, updatedAt
}
```

**T-Box** — already authored by the Ontologist (Audit § 1.1). Class + properties live in `docs/ontology/tbox/matches.ttl`:
- `sa:MatchInitiation` (one class with `sa:visibility` predicate per Audit § 2 O2; not split into Public/Private subclasses).
- `sa:MatchInitiationAssertion` (the on-chain anchor class).
- Properties: `sa:initiator` (functional, subPropertyOf `prov:wasAssociatedWith`), `sa:viewedIntent`, `sa:candidateIntent` (both functional), `sa:initiationKind` (range `sa:MatchInitiationKind` C-Box scheme), `sa:proposedAt` (subPropertyOf `prov:generatedAtTime`), `sa:basis` (xsd:string JSON literal — Audit § 2 O4), `sa:status` (range `sa:MatchInitiationStatus` C-Box scheme), `sa:visibility`, `sa:onChainAssertionId`.

**Alternatives considered**:
- *web SQLite row*: rejected — duplicates state, breaks owner-routing, fights the data-store-consolidation initiative.
- *GraphDB as source of truth*: rejected — would require MCP→GraphDB writes (forbidden), and would force private-tier initiations into a public store.
- *Replicate the artifact into both intent expressers' MCPs* (Audit § 2 O10): rejected — breaks no-duplication; the artifact has one owner (the connector), and the two expressers' authority is over their own intents, not the artifact.

## R2. Hop-distance SPARQL

**Decision**: Use SPARQL property path `sa:relatesTo+` (one-or-more) with a `LIMIT` and recursive depth cap of 6 implemented via repeated property unions.

**Rationale**: GraphDB property paths are evaluated in the engine. Capping depth bounds query time; 6 hops is well past anything that would affect the rank (proximityScore at 6 hops = `1/(1+6) ≈ 0.143`, indistinguishable from 7+ in practice).

**Alternatives considered**:
- *Unbounded transitive*: rejected — query time grows quadratically with depth on dense graphs.
- *Materialised hop-distance table*: rejected — premature; introduces a sync problem on every relationship edit.

## R3. Visibility / privacy gate (cascade)

**Decision**: Reuse the existing `saint:visibility` predicate (newly codified in `docs/ontology/tbox/intents.ttl` per Audit § 4 F1). A `MatchInitiation`'s visibility is computed at write time as the **strictest** of the two referenced intents' visibilities (cascade rule, IA § 3.1). The cascade computation lives in the action layer; SHACL encodes the *necessary consequences* (no anchor when source is private) in `docs/ontology/tbox/shacl/visibility.ttl`:

| Shape | Enforces |
|---|---|
| `sa:PrivateIntentInitiationNoAnchorShape` | A MatchInitiation referencing any non-public intent MUST NOT carry `sa:onChainAssertionId`. |
| `sa:MatchInitiationOppositeDirectionsShape` | `viewedIntent.direction` and `candidateIntent.direction` MUST be opposite. |

**Rationale**: Audit § 2 O8 — the cross-property "strictest-of" computation cannot be expressed cleanly in pure SHACL, so we encode the consequence (the SHACL violation when the action layer gets it wrong). A non-addressee viewer is gated by a SPARQL filter on the existing entitlement-credential graph before returning the intent in any list or candidate response.

**Alternatives considered**:
- *App-layer filter only*: rejected — pushes privacy enforcement into application code, where it can be bypassed by direct API calls. SHACL on the public mirror gives a backstop on the publicly visible side.

## R4. Self-match exclusion

**Decision**: SPARQL `FILTER (?expressedByA != ?expressedByB)` in the candidates query. Trivially correct.

## R5. Already-paired ("active") detection (FR-019, Q5)

**Decision**: Two-layer:
1. **Initiator's MCP** is authoritative for that initiator: `SELECT FROM match_initiations WHERE (viewedIntentId, candidateIntentId) = (?, ?) AND status = 'pending'`.
2. **Public mirror in GraphDB**: a `EXISTS` against `sa:MatchInitiationAssertion` triples linked to either intent — answers the cross-connector question only for public-tier initiations.

**Per IA § 2.1, the duplicate-check is authoritative for the initiating principal** — a different connector would not see another connector's private initiation against the same pair. Spec 001's FR-019 does not constrain cross-connector visibility, so this is in-spec.

**Per Clarification Q5** — only `pending` blocks new initiations; `superseded` and `consumed` do not.

**Rationale**: Decidable purely in the discovery layer without coupling to the downstream commitment lifecycle.

## R6. Rank-cue snapshot ("basis")

**Decision**: Persist `basis` as a JSON literal on the MatchInitiation row in the initiator's MCP and (when anchored) on the on-chain assertion as `sa:basis`. Discovery reads it back without re-deriving — preserves the rationale at proposal time even if the underlying graph changes.

**Rationale**: Per spec 001 Q3, `basis` is part of the artifact contract. JSON-as-literal is the cheapest path; Audit § 2 O4 endorsed JSON for v1 (RankBasis is opaque to SPARQL by design). Coarse-tier anchors omit `sa:basis` (per IA § 2.1).

## R7. Connector-mode authorization (Q1 resolution)

**Decision**: A connector (initiator who expressed neither intent) is permitted in v1. Authorization gate is hub-membership of the initiator + visibility gate on each intent (private intents still require credentialed-agent for routing). The artifact records `initiationKind = 'connector'`. The two intent expressers receive a notification via the standard `notifications:create` system-delegation pattern (no PII embedded — just an IRI reference).

**Per Audit § 2 O7**: a single `sa:MatchInitiationAssertion` class on chain, with `sa:initiationKind` as the discriminator. No separate event class.

**Per Audit § 2 O10**: the artifact is **not replicated** into the two expressers' MCPs — notification-only, preserving owner-routing.

**Rationale**: Pure-discovery rule; commitment-side consent of the two expressers is the downstream spec's responsibility.

## R8. Cross-hub network visibility (Q2 resolution)

**Decision**: `network:<hubId>` intents are visible only to members of the issuing hub in v1. Cross-hub discovery is deferred. Implementation: SPARQL `addressedTo` filter joins to hub-membership edges.

## R9. Notification on connector-mode

**Decision**: Both intent expressers are notified when a connector initiates a match (per spec.md Story 4 acceptance scenario 4). Notification mechanism: existing `notifications:create` system-delegation pattern (cf. IA § 3.2 + the hand-off described in `05-feature-data-flow.md` § 6).

**Rationale**: Connector-style initiation is opaque to the expressers if not surfaced; the artifact's existence is the trigger event. No PII is embedded — just an IRI reference and a "you have a new MatchInitiation referencing your intent" note.

## R10. Cross-spec ack-count primitive (IA § 3.10)

**Decision**: An integer `liveAcknowledgementCount` column lands on the existing `intents` table in person-mcp and org-mcp. On `MatchInitiation.create` the initiator's MCP issues a system-delegation `intent:bump_ack_count` notification to **each** of the two intent owners' MCPs (incrementing). On `MatchInitiation.withdraw` / `supersede` / `consume`, decrementing. The intent's `status` transition `expressed → acknowledged` happens when `liveAcknowledgementCount` rises to 1; reverting `acknowledged → expressed` happens when it drops to zero (relevant to spec 003 FR-023 too).

**Per Audit § 2 O5** — intentionally NOT codified in T-Box. It's an MCP implementation primitive. The ontology already expresses "intent has acknowledgement A" via the inverse predicates `sa:viewedIntent` / `sa:candidateIntent` / `sa:basedOnIntent`.

**Rationale**: Avoids fan-out queries; the intent owner's MCP is authoritative for "is my intent live-acknowledged."
