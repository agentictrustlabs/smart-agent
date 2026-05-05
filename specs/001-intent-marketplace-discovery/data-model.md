# Phase 1 — Data Model: Intent Marketplace (Direct Lane)

## Entities

### Intent (existing — read-only here, with one new field)

Already in the graph. Relevant fields read by this feature:

| Field | Type | Notes |
|-------|------|-------|
| `id` | IRI | stable identifier |
| `direction` | `'receive' \| 'give'` | required for counter-intent matching |
| `object` | IRI (resourceType) | the desire's object |
| `intentType` | IRI (SKOS leaf) | finer specialisation |
| `topic` | string | searchable |
| `detail` | string | searchable |
| `expressedByAgent` | IRI | the agent who expressed |
| `addressedTo` | string | `hub:<id>` \| `network:<id>` \| `agent:<addr>` \| `self` |
| `priority` | enum | filterable |
| `geo` | string (e.g. `us/colorado`) | filterable |
| `visibility` | `sageo:Visibility` | privacy gate; codified as `saint:visibility` per Audit § 4 F1 |
| `status` | `'drafted' \| 'expressed' \| 'acknowledged' \| 'in-progress' \| 'fulfilled' \| 'withdrawn' \| 'abandoned'` | lifecycle |
| `liveAcknowledgementCount` | integer | NEW — derived counter; incremented by `intent:bump_ack_count` system-delegation when a `MatchInitiation` (this spec) or `GrantProposal` (spec 003) creates a `pending` ack on this intent. Decremented on withdraw/supersede/consume. NOT codified in T-Box (Audit § 2 O5); implementation-only on each MCP's `intents` table. |

This feature **mutates** `status` and `liveAcknowledgementCount` on the intent rows (via cross-MCP system-delegation when the two intents have different owners). All other fields are read-only. The `expressed → acknowledged` transition fires when `liveAcknowledgementCount` rises to 1; `acknowledged → expressed` fires when it drops to zero.

---

### MatchCandidate (computed — not persisted)

A tuple representing a counter-intent presentation. Computed on demand; cache is implementation choice.

| Field | Type | Notes |
|-------|------|-------|
| `intent` | Intent | the counter-intent |
| `score` | number | composite rank |
| `rationale` | RankBasis | for the "why this rank" cue |

```typescript
type RankBasis = {
  proximityHops: number;          // hops in AgentRelationship graph
  proximityScore: number;         // 1 / (1 + hops)
  priorOutcomes: { fulfilled: number; abandoned: number };
  outcomeScore: number;           // (fulfilled + 1) / (fulfilled + abandoned + 2)
  composite: number;              // 0.6 * proximity + 0.4 * outcome
  isColdStart: boolean;           // true when fulfilled === 0 && abandoned === 0
};
```

---

### MatchInitiation (new — persisted in initiator's MCP)

The terminal artifact of this spec; consumed by the downstream commitment spec. **Per spec.md Clarification Q3 the field shape is fixed.**

**Persistence model** (per IA § 2.1):
- **Body**: row in initiator's MCP `match_initiations` table — `apps/person-mcp/src/db/schema.ts` for individual initiators; org-mcp twin for org initiators. Owner-routed by `principal` = `initiatorAgentId`.
- **Conditional on-chain anchor**: `sa:MatchInitiationAssertion` minted via `emitOnChainAssertion` only when the row's `visibility` is `public` or `public-coarse` (which is the cascade-derived strictest of the two referenced intents' visibilities). Coarse tier omits `sa:basis`. SHACL `sa:PrivateIntentInitiationNoAnchorShape` enforces this.
- **GraphDB mirror**: only the on-chain → GraphDB sync indexes `sa:MatchInitiationAssertion` triples in `DATA_GRAPH`. No direct MCP→GraphDB writes (P4).

**TS field → T-Box predicate mapping** (Audit § 3): TS field names use the `*AgentId` and `*Id` JS conventions; T-Box predicates use bare IRI references:

| TS field | T-Box predicate |
|----------|-----------------|
| `id` | row IRI |
| `viewedIntentId` | `sa:viewedIntent` |
| `candidateIntentId` | `sa:candidateIntent` |
| `initiatorAgentId` | `sa:initiator` |
| `initiationKind` | `sa:initiationKind` |
| `proposedAt` | `sa:proposedAt` |
| `basis` | `sa:basis` |
| `status` | `sa:status` |
| `visibility` | `sa:visibility` |
| `onChainAssertionId` | `sa:onChainAssertionId` |

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | IRI | yes | stable identifier |
| `viewedIntentId` | IRI | yes | the intent the initiator was looking at |
| `candidateIntentId` | IRI | yes | the chosen counter-intent |
| `initiatorAgentId` | IRI | yes | the agent who proposed; equals row `principal` |
| `initiationKind` | `'self' \| 'connector'` | yes | `self` if initiator is one of the two expressers; `connector` otherwise |
| `proposedAt` | xsd:dateTime | yes | ISO timestamp |
| `basis` | JSON literal | yes | snapshot of `RankBasis` at proposal time |
| `status` | `'pending' \| 'superseded' \| 'consumed'` | yes | discovery only ever sets `pending`; downstream advances |
| `visibility` | `'public' \| 'public-coarse' \| 'private' \| 'off-chain'` | yes | derived as strictest of the two source intents' visibilities (cascade per IA § 3.1) |
| `onChainAssertionId` | IRI? | conditional | set iff the row was anchored |

#### Lifecycle

```
[creation] → pending ──┬─→ superseded   (replaced by a later initiation on the same pair, OR an underlying intent withdrew)
                       └─→ consumed     (downstream commitment spec acted on it)
```

This spec writes `pending` only. Status advances are owned by future specs.

#### Validation rules

- `viewedIntentId !== candidateIntentId`.
- `viewedIntent.direction !== candidateIntent.direction` (always opposite directions; SHACL `sa:MatchInitiationOppositeDirectionsShape`).
- `viewedIntent.object === candidateIntent.object` (same object, except for the optional broadening-match path documented in FR-010).
- `viewedIntent.expressedByAgent !== candidateIntent.expressedByAgent` (self-match excluded, per FR-008).
- If `initiationKind === 'self'`, then `initiatorAgentId === viewedIntent.expressedByAgent` OR `initiatorAgentId === candidateIntent.expressedByAgent`.
- If `initiationKind === 'connector'`, then `initiatorAgentId !== viewedIntent.expressedByAgent` AND `initiatorAgentId !== candidateIntent.expressedByAgent`.
- No existing MatchInitiation with `status === 'pending'` may exist for the same `{viewedIntentId, candidateIntentId}` pair from this initiator (FR-019, Q5; authoritative via initiator's MCP).
- If `visibility === 'public' | 'public-coarse'`: both referenced intents MUST already have minted public on-chain assertions (Audit § 5 invariant). Otherwise the row stays MCP-only.

#### Side effects on creation

- `intent:bump_ack_count` system-delegation issued to **each** of the two intent owners' MCPs, incrementing each intent's `liveAcknowledgementCount`. The owning MCP transitions intent `status: 'expressed' → 'acknowledged'` when its count rises from 0 to 1 (per IA § 3.10).
- A notification is dispatched to both intent expressers when `initiationKind === 'connector'` (per spec.md Story 4 AC#4) via the standard `notifications:create` system-delegation pattern. No PII embedded.
- If `visibility !== 'private'` and both source intents are public-tier: emit `sa:MatchInitiationAssertion` on chain via the existing `emitOnChainAssertion` path; capture `onChainAssertionId` on the row.

#### Side effects on `superseded` / `consumed`

- `intent:bump_ack_count` system-delegation issued with `delta: -1` to each of the two intent owners' MCPs. Reverts `acknowledged → expressed` only when the count hits zero.

---

## Relationships

```
Intent.expressedByAgent ──→ Agent
Agent ──sa:relatesTo+──→ Agent              (existing AgentRelationship graph)
MatchInitiation.viewedIntent ──→ Intent       (sa:viewedIntent)
MatchInitiation.candidateIntent ──→ Intent    (sa:candidateIntent)
MatchInitiation.initiator ──→ Agent           (sa:initiator; functional, owl:FunctionalProperty per Audit § 2 O10)
MatchInitiationAssertion ──prov:wasGeneratedBy──→ Agent   (only for anchored rows)
```

## Storage

- **Body**: `match_initiations` table in person-mcp (`apps/person-mcp/src/db/schema.ts`) and the org-mcp twin. Per IA § 2.1; same shape as the existing `intents` table.
- **On-chain assertion**: `sa:MatchInitiationAssertion` minted via the existing AgentAssertion contract; emitter helper at `apps/web/src/lib/onchain/matchInitiationAssertion.ts` (NEW).
- **GraphDB mirror**: indexed by the on-chain → GraphDB sync (`apps/web/src/lib/ontology/sync.ts`); discovery reads via `packages/discovery` `listPublicMatchInitiationAssertions(...)`.
- **T-Box** (Audit § 1.1): `docs/ontology/tbox/matches.ttl` (extended), `docs/ontology/tbox/intents.ttl` (extended for `saint:visibility`), `docs/ontology/cbox/controlled-vocabularies.ttl` (extended for the two SKOS schemes).
- **SHACL**: `docs/ontology/tbox/shacl/visibility.ttl` — `sa:PrivateIntentInitiationNoAnchorShape` and `sa:MatchInitiationOppositeDirectionsShape`.

## Indexing & query patterns

The hot-path queries are:
1. `listIntents(hubId, filters)` — paginated; uses existing intent SPARQL + per-MCP visibility filters where the caller is the owner.
2. `listCandidatesForIntent(intentId)` — counter-intent SPARQL on the public mirror; joins to `expressedByAgent` for the proximity hop.
3. `match_initiation:create` (initiator's MCP tool) — writes the MCP row, conditionally emits the on-chain assertion, and dispatches the two `intent:bump_ack_count` system-delegations.
4. `match_initiation:read_self` (initiator's MCP) — owner-only read.
5. `match_initiation:list_referencing_intent` (initiator's MCP) — derived authority: caller proves they're an expresser of the referenced intent via their own intent-read authority.
6. `listPublicMatchInitiationAssertions(filter)` (discovery) — public-tier mirror only; used for the cross-connector `EXISTS` and the "view existing match" surface (FR-019, AC#2) on public pairs.

GraphDB indexing is the engine's responsibility; we do not introduce indices here.
