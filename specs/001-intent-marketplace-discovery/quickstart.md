# Quickstart — Intent Marketplace (Direct Lane)

End-to-end walkthrough exercising User Stories 1–4 against the seeded demo hub.

## Setup

```bash
./scripts/fresh-start.sh        # full reset, deploy, seed demo community
pnpm dev                         # http://localhost:3000
```

Sign in as **Sofia** (the G2 apprentice in the seeded Catalyst NoCo hub).

## Walkthrough

### 1. Browse the hub's intents

Navigate to `http://localhost:3000/h/catalyst-noco/intents`.

Expected:
- Index lists all expressed intents in the hub, sourced from the GraphDB public mirror via `@smart-agent/discovery`.
- Filter chips: direction (receive/give/both), intent type, priority, geo, free-text.
- Direction-specific count chips reflect the seed (e.g. "8 receive · 6 give").

Apply `direction = receive`. Sofia's "Need coaching for Berthoud" appears.

### 2. View an intent's candidates

Click Sofia's "Need coaching for Berthoud" detail.

Expected:
- A "Compatible offers" section lists give-shaped intents on the same object (`resourceType:Worker`).
- Maria's `OfferCoaching` appears at rank 1 with cue `1 hop · 4 fulfilled / 0 abandoned`.
- A more distant offerer appears below, with their cue.
- A `Prayer`-object give intent does NOT appear (different object).

### 3. Propose a match (self mode) — write path

Click **Propose match** on Maria's offer.

Expected sequence (per IA § 2.1 and the existing `apps/person-mcp/src/tools/intents.ts` emit pattern):

1. **MCP write** — POST to `/h/catalyst-noco/intents/<sofia-intent-id>/propose-match`. The route calls Sofia's person-mcp `match_initiation:create` tool, writing a row to the `match_initiations` table (Sofia is the initiator → her MCP is the body owner).
2. **Visibility cascade** — both intents are public-tier, so the row's `visibility` is `public`.
3. **Conditional on-chain anchor** — the MCP tool calls the existing `emitOnChainAssertion` path to mint a `sa:MatchInitiationAssertion` on chain. SHACL `sa:PrivateIntentInitiationNoAnchorShape` would block this if either source intent were non-public.
4. **Ack-count fan-out** — the MCP issues `intent:bump_ack_count` system-delegations to *each* of the two intents' owning MCPs (Sofia's own intent on Sofia's MCP; Maria's offer on Maria's MCP). Each owning MCP increments `liveAcknowledgementCount` on the row, transitioning the intent's `status: 'expressed' → 'acknowledged'` on the 0→1 edge (IA § 3.10).
5. **GraphDB mirror** — the on-chain → GraphDB sync indexes the new assertion. After sync, a SPARQL read returns:
  ```turtle
  <urn:mi:001> a sa:MatchInitiationAssertion ;
    sa:viewedIntent <sofia-intent> ;
    sa:candidateIntent <maria-intent> ;
    sa:initiator <sofia> ;
    sa:initiationKind sac:MatchInitiationKindSelf ;
    sa:proposedAt "2026-05-04T..."^^xsd:dateTime ;
    sa:basis "{...}"^^xsd:string ;
    sa:status sac:MatchInitiationStatusPending ;
    sa:visibility sageoc:VisibilityPublic .
  ```
6. **Confirmation** — the user is told the next step is "commitment" (the downstream spec).

### 4. Propose a match (connector mode)

Sign in as a third-party hub member (e.g. **David**, who expressed neither Sofia's nor Maria's intent).

Open Sofia's intent detail. The same "Propose match" affordance is present.

Click **Propose match** on Maria's offer.

Expected:
- The artifact body is written to **David's** MCP (he's the initiator; per Audit § 2 O10, `sa:initiator` is `owl:FunctionalProperty` and the artifact has exactly one owner — replicating into Sofia's and Maria's MCPs would break P4).
- The row carries `initiationKind = "connector"`, `initiator = david`, and contains only IDs + the basis snapshot (no copies of Sofia's or Maria's intent bodies — IA § 3.2).
- Sofia and Maria are notified via the standard `notifications:create` system-delegation pattern. No PII embedded — just the IRI reference and a "you have a new MatchInitiation referencing your intent" note.
- If both intents are public-tier, the on-chain assertion mints with `sa:initiationKind sac:MatchInitiationKindConnector` (Audit § 2 O7 — single assertion class with a discriminator predicate).

### 5. Already-paired guard

Re-open Sofia's intent detail (still signed in as anyone).

Expected:
- The "Compatible offers" section indicates the intent is already paired with Maria (per FR-019).
- The action button reads **View existing match** (not Propose match).
- For public-tier pairs, the cross-connector check is answered via `listPublicMatchInitiationAssertions(...)` against the GraphDB mirror. For private-tier pairs the duplicate-check is authoritative only for the initiating principal (IA § 2.1).

### 6. Stale-candidate handling

In another browser, withdraw Maria's offer (status → `withdrawn`).

Back on Sofia's detail, click **Propose match** again on Maria's (now stale) offer.

Expected:
- A graceful error appears (`stale-candidate` / `withdrawn` per `ProposeMatchError`).
- The candidates list refreshes; Maria's offer is removed.

## What this exercise covers

| Spec element | Covered by step |
|--------------|-----------------|
| Story 1 (browse + filter)   | 1 |
| Story 2 (counter-intent surface) | 2 |
| Story 3 (rank + cue)        | 2 |
| Story 4 (propose match: self) — full MCP→on-chain→GraphDB pipeline | 3 |
| Story 4 (propose match: connector — owner-routing) | 4 |
| FR-019 / Q5 (already-paired) | 5 |
| FR-021 (stale candidate)    | 6 |
| `liveAcknowledgementCount` ack-count primitive (IA § 3.10) | 3 — fan-out step |

Story 5 (network scope) is exercised by toggling the network-scope filter on the index page; not in the seed-hub walkthrough above (deferred per spec scope).
