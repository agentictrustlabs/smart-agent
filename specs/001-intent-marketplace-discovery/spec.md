# Feature Specification: Intent Marketplace — Discovery & Match

**Feature Branch**: `001-intent-marketplace-discovery`
**Created**: 2026-05-04
**Status**: Draft
**Input**: User description: "Intent marketplace — discovery and match (within a hub). Let agents browse, filter, and search published intents; surface complementary needs/offers based on intent shape (need ↔ offer, domain, capacity, time window); rank candidates using trust-graph proximity and prior outcome quality; let a user initiate a match from a candidate (handoff point to a separate commitment spec). Builds on the existing ExpressIntentForm + intents list/detail routes under apps/web/src/app/h/[hubId]/(hub)/intents/, and consumes the intent ontology in docs/ontology/ and the design in docs/specs/generalized-intent-matchmaking.md. Match initiation is the terminal step — committing, engaging, validating, and trust updates are out of scope."

## Clarifications

### Session 2026-05-04

- Q: Can a third party — an agent who expressed neither of the two intents — propose a match between them? → A: Permitted in v1; the match-initiation artifact records `initiator` as a distinct field from the two intent expressers, and connector mode is a first-class flow.
- Q: For intents addressed `network:<hubId>`, who can discover them from outside that hub? → A: Members of the issuing hub only. `network:<hubId>` is a labelling hint that broadens the *addressed audience inside that hub*, but visibility does not cross the hub boundary in v1. Cross-hub discovery is deferred to a future spec.
- Q: What is the explicit field shape of the Match Initiation artifact (the contract handed to the commitment spec)? → A: Minimal stable contract — `id`, `viewedIntentId`, `candidateIntentId`, `initiatorAgentId`, `initiationKind` (`'self' | 'connector'`), `proposedAt`, `basis` (rank-cue snapshot at time of proposal), `status` (`'pending' | 'superseded' | 'consumed'`). Commitment-side fields (consent, scheduling, etc.) belong to the downstream commitment spec, not to this artifact.
- Q: How do the trust-proximity and prior-outcome signals combine into a single rank score? → A: Weighted sum of two normalized signals — `score = 0.6 * proximityScore + 0.4 * outcomeScore`, where `proximityScore = 1 / (1 + hops)` and `outcomeScore = (fulfilled + 1) / (fulfilled + abandoned + 2)` (Laplace smoothing handles cold-start in-line; default weights 0.6/0.4 are tunable in a later iteration without changing the model).
- Q: For FR-019 ("prevent duplicate match-initiations while a prior initiation is still active"), what counts as "active"? → A: Only artifact `status = 'pending'`. Both `'superseded'` and `'consumed'` unblock new initiations on the same intent pair. The duplicate-prevention rule is local to the discovery layer and does not depend on the downstream commitment lifecycle.

## Overview

The Intent layer already lets a hub member *express* an intent (a directed, addressed desire with a `receive` or `give` direction and an `object` like `Worker`, `Money`, `Skill`, `Prayer`, `Venue`, etc.). What's missing is the *next half* of the BDI cycle: helping members **find** complementary counter-intents and **initiate a match**.

This feature delivers the discovery + matchmaking surface that closes the loop from *expressed* to *match-initiated*. It does **not** create commitments, schedule engagement, log activity, validate outcomes, or update trust — those each belong to their own downstream specs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Browse & filter open intents in the hub (Priority: P1)

A hub member opens the hub's intents page and wants to see what's open right now — what people need, what people are offering — and narrow that list by direction (receive/give), kind (coaching, funding, prayer, …), priority, geo, or free-text. Today's index page exists but offers only direction + scope filters; this story extends it into a usable browse/search surface.

**Why this priority**: Without browsing, the marketplace is invisible. Every other matching pattern depends on members being able to see what's out there.

**Independent Test**: Seed a hub with ≥10 expressed intents of mixed directions, intent types, priorities, and geos. Verify a member can land on the index, apply combinations of filters and free-text search, and see the correct subset. Empty filter combinations show a helpful empty state.

**Acceptance Scenarios**:

1. **Given** a hub with 8 receive-shaped and 6 give-shaped expressed intents, **When** the user filters by direction = "give", **Then** only the 6 give-shaped intents appear and the count chip reflects 6.
2. **Given** a hub with intents tagged `intentType:NeedCoaching`, `intentType:NeedFunding`, `intentType:OfferPrayer`, **When** the user filters by intent type = "Coaching", **Then** only `NeedCoaching` and `OfferCoaching` intents appear.
3. **Given** intents with topics "Berthoud farm-worker discipleship" and "well-water filter project", **When** the user types "Berthoud" into search, **Then** only the matching intent appears in the results.
4. **Given** an intent flagged sensitive (private visibility), **When** any user other than the addressee or a credentialed agent views the index, **Then** the sensitive intent is not shown.
5. **Given** a filter combination that yields no results, **When** the user sees the result list, **Then** they see an empty-state with guidance to widen filters or express an intent.

---

### User Story 2 — See compatible counter-intents for a specific intent (Priority: P1)

A member viewing one intent wants to see the counter-intents that could fulfill it. If they're looking at a `receive`-shaped intent ("Need coaching for Berthoud"), the system surfaces `give`-shaped intents on the same object ("Offer coaching"). If looking at a `give`-shaped one, it surfaces matching `receive`-shaped ones. This is the matchmaking core — it turns the intent layer from a bulletin board into a marketplace.

**Why this priority**: Browsing alone is a weaker product than direct counter-intent surfacing. P1 alongside Story 1 because the core value is *finding a match*, not just a list.

**Independent Test**: For a seeded receive-shaped intent on `resourceType:Worker` with `intentType:NeedCoaching`, verify that the detail page shows a "Compatible offers" section listing every `give`-shaped intent on the same object (and not other objects). Same in reverse for give-shaped intents.

**Acceptance Scenarios**:

1. **Given** intent `I_recv` (`direction=receive`, `object=resourceType:Worker`, `intentType:NeedCoaching`) and intents `I_give_1` (`direction=give`, `object=resourceType:Worker`, `intentType:OfferSkill`), `I_give_2` (`OfferTeaching`), `I_give_3` (`OfferPrayer`, on `resourceType:Prayer`), **When** the user opens `I_recv`, **Then** the candidates section includes `I_give_1` and `I_give_2` (same object) but not `I_give_3` (different object).
2. **Given** intent `I_recv` exists with status `withdrawn`, **When** anyone opens it, **Then** no candidates section is shown (withdrawn intents do not surface candidates).
3. **Given** a candidate intent in the same object/direction match but expressed by the *same* agent as the viewing intent's expresser, **When** candidates are computed, **Then** that self-match is excluded.
4. **Given** no compatible counter-intents exist, **When** the user opens an intent, **Then** they see an empty-state in the candidates section ("No matches yet — when one is expressed, it will appear here").

---

### User Story 3 — Rank candidates by trust + prior outcomes (Priority: P2)

When several counter-intents are compatible, the order matters. The system orders candidates by a transparent composite of trust-graph proximity (how close the counter-party is in the agent relationship graph) and prior outcome quality (how well their prior intents fulfilled). Each candidate exposes a short "why this rank" cue so the member understands the ordering.

**Why this priority**: P2 (not P1) because Story 2 already delivers a usable list — ranking is a quality multiplier, not the first cut. Without ranking, members still see all candidates; with ranking, they see the *best* first.

**Independent Test**: Seed two compatible give-shaped intents from agents at relational distances 1 (direct coach) and 4 (network stranger), and seed prior outcome ratings differing by ≥2 levels. Verify ordering matches the documented composite (closer + better-prior = higher), and verify the "why" cue is present.

**Acceptance Scenarios**:

1. **Given** two compatible give-shaped intents from agents A (1 hop, prior outcome avg 0.9) and B (4 hops, prior outcome avg 0.4), **When** candidates are listed, **Then** A appears above B.
2. **Given** two compatible intents whose ranking signals tie within tolerance, **When** ordered, **Then** ties break on recency (most recently expressed first).
3. **Given** an agent with no prior outcomes (cold start), **When** they appear as a candidate, **Then** the rank uses trust-proximity alone and the "why" cue states "no prior history yet".
4. **Given** the user is curious about a rank, **When** they hover/expand the rank cue, **Then** they see the contributing factors (proximity = 2 hops; prior outcomes = 4 fulfilled, 0 abandoned).

---

### User Story 4 — Initiate a match from a candidate (Priority: P1)

After surfacing a candidate, the member clicks "Propose match" on a counter-intent. This emits a *match-initiation* artifact that pairs the two intents and records who initiated it, when, and on what basis. **It does not commit either party.** Commitment, engagement, activity, validation, and trust update are downstream specs that consume this artifact.

**Why this priority**: P1 because without this terminal action, discovery is read-only and the loop never closes. The artifact this story produces is the explicit handoff contract to the commitment spec.

**Independent Test**: From an intent detail page with at least one candidate, click "Propose match" on a candidate. Verify a match-initiation record exists referencing both intent IDs, the initiating agent, the timestamp, and a stable identifier the commitment workflow can consume. Both intents' status transitions to `acknowledged` (per the existing intent state model).

**Acceptance Scenarios**:

1. **Given** an `expressed` receive-shaped intent and an `expressed` compatible give-shaped intent, **When** the viewing member proposes a match, **Then** a match-initiation record is created linking both, both intents transition to `acknowledged`, and the initiator sees a confirmation referencing the next step ("commitment").
2. **Given** an intent already in a match-initiation with `status = 'pending'`, **When** the user opens it, **Then** the candidates section indicates the intent is already paired and the action is "view existing match" rather than "propose match". (Initiations in `'superseded'` or `'consumed'` status do not trigger this state.)
3. **Given** a sensitive (`private`) intent, **When** any non-credentialed agent attempts to propose a match, **Then** the action is unavailable and a help text explains routing goes through credentialed agents only.
4. **Given** the proposing agent is acting as a *connector* (initiating a match between two intents, neither of which they expressed), **When** they propose the match, **Then** the artifact records the initiator distinctly from the two intent expressers, and both expressers are notified of the connector-initiated match.

---

### User Story 5 — Network-scope discovery within the issuing hub (Priority: P3)

Some intents are addressed `network:<hubId>` rather than `hub:<hubId>`. The two are distinct addressed-audience labels — both visible only to members of the issuing hub in v1, but the network-scope label signals that the intent is open to the hub's broader network *concept* (relevant for downstream commitment + future cross-hub sharing). A member browsing should be able to filter on this scope distinction. Hub-scope is the default; network-scope is opt-in via a filter and broadens the *label*, not the *visibility boundary*.

**Why this priority**: P3 because hub-scope is sufficient for the MVP; the network-scope filter is a labelling refinement, not a cross-hub feature. Cross-hub discovery itself is deferred to a future spec.

**Independent Test**: With at least one intent addressed `hub:H1`, one addressed `hub:H2`, and one addressed `network:H1`, verify a member of H1 sees only H1-addressed intents by default, sees the `network:H1` intent when they opt in to network scope, and never sees the `hub:H2` intent regardless of scope. A non-member of H1 never sees either H1-addressed intent.

**Acceptance Scenarios**:

1. **Given** intents addressed `hub:H1`, `network:H1`, and `hub:H2`, **When** a member of H1 browses with default scope, **Then** only `hub:H1`-addressed intents appear.
2. **Given** the same setup, **When** the member of H1 switches to network scope, **Then** both `hub:H1`- and `network:H1`-addressed intents appear; the `hub:H2` intent does not appear.
3. **Given** a member of H2 (not H1) browses, **When** they apply any scope, **Then** no H1-addressed intent (whether `hub:H1` or `network:H1`) appears.

---

### Edge Cases

- **Sensitive intents** (private visibility): excluded from all public discovery; surfaced only to the addressee and credentialed agents.
- **Self-match**: a candidate expressed by the same agent as the viewed intent's expresser is excluded.
- **Already-matched intent**: candidates section reflects the existing pairing; "propose match" is replaced by "view existing match".
- **Withdrawn / abandoned / fulfilled intents**: do not appear as candidates; do not appear in default discovery (filter to include them is optional).
- **Cold-start agent** (no prior outcomes): ranked using trust-proximity alone; rank cue acknowledges absent history.
- **Tied ranks**: break ties on recency (most recent first).
- **No candidates**: explicit empty state with guidance.
- **Object-mismatch near-miss**: when no candidates exist on the exact object, the system MAY surface near-misses on a parent object in the SKOS taxonomy (e.g., `Worker` has children `Coach`, `Apprentice`); these are clearly labelled as broadening matches.
- **Stale data** (counter-party withdrew between rank and click): proposing a match against a no-longer-`expressed` intent shows a graceful error and refreshes the candidates list.

## Requirements *(mandatory)*

### Functional Requirements

**Browse & filter (User Story 1):**

- **FR-001**: System MUST list expressed intents in a hub, scoped by `addressedTo` resolving to the hub or to its network.
- **FR-002**: System MUST allow filtering by direction (`receive` | `give` | both), intent type (the SKOS `intentType:*` leaf vocabulary), priority, and geo.
- **FR-003**: System MUST allow free-text search across title, topic, and detail.
- **FR-004**: System MUST exclude intents with private visibility from results unless the viewer is the addressee or a credentialed agent for that intent type.
- **FR-005**: System MUST show direction-specific counts in filter chips so users can see at-a-glance volume.
- **FR-006**: System MUST surface an empty-state with guidance when filters yield zero results.

**Counter-intent surfacing (User Story 2):**

- **FR-007**: For a given intent in `expressed` or `acknowledged` state, system MUST compute a candidate list of intents in the *opposite* direction on the *same* `object` (and the same hub or network scope).
- **FR-008**: System MUST exclude self-matches (candidates expressed by the same agent as the viewed intent).
- **FR-009**: System MUST exclude candidates whose status is `withdrawn`, `abandoned`, or `fulfilled` from the default candidate view.
- **FR-010**: System MUST optionally surface near-miss candidates on parent SKOS objects, clearly labelled as broadening matches.
- **FR-011**: System MUST hide candidates from sensitive (private) intents from non-credentialed viewers.

**Ranking (User Story 3):**

- **FR-012**: System MUST rank candidates using a composite of trust-graph proximity (relational distance in the existing AgentRelationship graph) and prior outcome quality (proportion of the candidate's prior intents that reached `fulfilled`), combined as `score = 0.6 * proximityScore + 0.4 * outcomeScore`, where `proximityScore = 1 / (1 + hops)` and `outcomeScore = (fulfilled + 1) / (fulfilled + abandoned + 2)`. The 0.6/0.4 weights are documented defaults; tuning them is a configuration change, not a model change.
- **FR-013**: System MUST be deterministic for a given input snapshot — re-running the rank with no underlying changes yields the same order.
- **FR-014**: System MUST expose a per-candidate "why this rank" cue summarising the contributing signals (e.g., "1 hop · 4 fulfilled / 0 abandoned").
- **FR-015**: System MUST handle cold-start candidates (zero prior `fulfilled` and zero prior `abandoned` outcomes) via the Laplace-smoothed `outcomeScore` formula in FR-012 — which yields 0.5 at zero data — and the rank cue MUST indicate "no prior history yet" when both counts are zero.
- **FR-016**: System MUST break rank ties (composite scores within `1e-6`) on recency (most recently expressed first).

**Match initiation (User Story 4):**

- **FR-017**: System MUST allow an authorised viewer to propose a match between the viewed intent and a candidate, producing a match-initiation artifact that links both intent IDs, records the initiating agent and timestamp, and is consumable by the downstream commitment workflow. The initiator MAY be a connector (an agent who expressed neither intent); the artifact records `initiator` as a field distinct from the two intent expressers.
- **FR-018**: Upon successful match-initiation, system MUST transition both intents to `acknowledged` status (per the existing intent state model).
- **FR-019**: System MUST prevent duplicate match-initiations between the same intent pair while a prior initiation is in `status = 'pending'`. Initiations in `'superseded'` or `'consumed'` status do not block new initiations on the same pair.
- **FR-020**: System MUST gate match-initiation on sensitive intents to credentialed agents only.
- **FR-021**: System MUST detect stale candidates (status changed between display and click) and present a non-destructive error that refreshes the candidate list.

**Cross-hub scope (User Story 5):**

- **FR-022**: System MUST default discovery scope to the current hub (intents addressed `hub:<currentHub>`).
- **FR-023**: System MUST allow members of the issuing hub to opt in to network scope, which additionally surfaces intents addressed `network:<currentHub>`. Network-scope visibility does not cross the hub boundary in v1; non-members of the issuing hub never see its `network:`-addressed intents.

### Key Entities

- **Intent** *(existing)*: A directed, addressed, committed desire. Carries `direction` (`receive`/`give`), `object` (a `resourceType:*` concept), `intentType` (a SKOS leaf), `topic`, `expressedByAgent`, `addressedTo`, `priority`, `visibility`, `status`. Discovery reads but does not mutate the schema of this entity.
- **Match Candidate** *(computed; not persisted)*: For a given Intent, a tuple of (counter-intent, composite rank score, ranking-cue components). Computed on demand; cache is an implementation choice.
- **Match Initiation** *(new)*: An artifact pairing two Intents with the initiating agent and timestamp. **The shape of this artifact is the explicit contract handed to the commitment spec.** Fields:
  - `id` — stable identifier consumable by the commitment workflow.
  - `viewedIntentId` — the intent the initiator was looking at when they proposed (drives downstream UX framing).
  - `candidateIntentId` — the counter-intent that was selected from the candidate list.
  - `initiatorAgentId` — the agent who proposed; distinct from the two intent expressers when `initiationKind = 'connector'`. The artifact has **exactly one owner** (the initiator); the artifact body lives in the initiator's MCP and is not replicated to the two intent expressers' MCPs.
  - `initiationKind` — `'self'` (initiator is one of the two intent expressers) or `'connector'` (initiator expressed neither intent).
  - `proposedAt` — timestamp.
  - `basis` — point-in-time snapshot of the rank-cue components shown to the initiator (e.g., `{ proximityHops: 1, priorOutcomes: { fulfilled: 4, abandoned: 0 } }`); preserves the rationale at proposal time even if the underlying graph changes later.
  - `status` — `'pending'` (just created, not yet consumed), `'superseded'` (replaced by a later initiation on the same pair), or `'consumed'` (the commitment spec has acted on it). Discovery never advances past `'pending'`; downstream specs own further transitions.
  - `visibility` — privacy tier; cascades from the source intents (the strictest of the two intents' visibilities determines whether this artifact may be anchored on chain and therefore mirrored to the public discovery index). Private-tier initiations remain owner-private and are not discoverable across the network.

  Commitment-side fields (per-expresser consent, scheduling, terms) are not part of this artifact — they belong to the downstream commitment spec, which references this artifact by `id`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A hub member can find at least one relevant counter-intent for a typical receive- or give-shaped intent in the seeded demo within 30 seconds of opening the hub's intents page (assumes ≥1 compatible counter-intent exists in seed data).
- **SC-002**: For seeded intents that have at least one compatible counter-intent, the candidate list returns within 2 seconds at the 95th percentile under typical hub load (single-digit thousands of intents).
- **SC-003**: 0% of sensitive (`private`) intents leak into discovery results for non-addressee, non-credentialed viewers, verified by automated test against seeded sensitive intents.
- **SC-004**: For at least 70% of seeded intent pairs that experts agree are good matches, the expert-preferred candidate appears in the top 3 of the ranked list.
- **SC-005**: A match-initiation produced by this feature is consumed without further transformation by the downstream commitment workflow — i.e., the artifact contains every field the commitment spec needs.
- **SC-006**: Across a representative seeded hub, the share of `expressed` intents that reach at least one match-initiation within 7 days of expression is at least 50% for non-sensitive intents.
- **SC-007**: Members report (in qualitative review) that the rank cue makes the ordering legible — "I understand why this candidate is at the top" — for at least 8 out of 10 sampled candidates.

## Assumptions

- **Hub-scope is the default**, network-scope is opt-in *and visibility-bounded to the issuing hub's members* (per Clarification Q2). Cross-hub discovery (members of one hub seeing another hub's intents) is deferred to a future spec.
- **Trust-graph signal** is read from the existing `AgentRelationship` graph; weighting tuned later. Shared circles / oikos / coaching lineage are *not* used as additional signals in v1.
- **Prior outcome quality** is read from the existing intent status history (count of `fulfilled` vs. `abandoned`). Activity-log validation events from a future spec will refine this signal but are not required.
- **The downstream commitment spec exists or will be specified next**; the match-initiation artifact's exact field shape will be co-designed with that spec but is fixed enough here that consumers can begin work.
- **Existing UI pages and routes** (`/h/[hubId]/(hub)/intents`, `.../new`, `.../[id]`) are extended in place rather than replaced. The `ExpressIntentForm` is unchanged by this feature.
- **Connector-style match initiation** (a third party initiating a match between two intents, neither of which they expressed) is permitted in v1; the artifact's `initiator` field is recorded distinctly from the two intent expressers (per Clarification Q1).
- **Privacy enforcement** for sensitive intents reuses the existing visibility/credentialed-agent gates; this feature does not introduce a new privacy primitive.
- **Intent state machine** (`expressed` → `acknowledged` → `in-progress` → `fulfilled` | `withdrawn` | `abandoned`) is unchanged by this feature; match-initiation drives the `expressed` → `acknowledged` transition, downstream specs drive the rest.

## Dependencies

- Existing `Intent` schema and lifecycle (`drafted | expressed | acknowledged | in-progress | fulfilled | withdrawn | abandoned`).
- Existing `AgentRelationship` graph (used as the trust-proximity signal).
- Existing visibility / credentialed-agent gates (used to enforce sensitive-intent privacy).
- Existing hub membership and `addressedTo` semantics (`hub:<id>`, `network:<id>`, `agent:<addr>`, `self`).
- Downstream **commitment spec** (consumes the match-initiation artifact). This feature defines the artifact's contract; the commitment spec consumes it.

## Out of Scope (handed to other specs)

- Forming a Commitment from a match-initiation.
- Engagement scheduling, activity logging, outcome reporting, validation.
- Trust-graph mutation triggered by outcomes.
- Belief updates / next-cycle re-targeting of intents.
- Editing or expressing intents (already shipped).
- Multi-party matches (>1 give-side party converging on one receive-side intent) — flagged as future work.
