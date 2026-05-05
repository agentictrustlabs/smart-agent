# Feature Specification: Intent Marketplace — Pool Lane (Discovery & Pledge)

**Feature Branch**: `002-intent-marketplace-pool`
**Created**: 2026-05-04
**Status**: Draft
**Input**: User description: "Pool lane discovery and pledge — within a hub. Let agents browse and search active pools (giving funds, coaching networks, prayer chains, skills benches, hospitality networks); see each pool's mandate, restrictions, current capacity, and recent allocations; and pledge into a pool with optional restrictions (kind / geo / not-for-admin) and a cadence (one-time, monthly, annual / faith-promise). Builds on the same trust-graph proximity + prior-outcome ranking as spec 001 but applied to pools, and reuses the artifact-handoff pattern (a Pool Pledge artifact handed to the downstream allocation/disbursement spec). Ratio is many givers : one pool : many recipients; this spec terminates at pledge committed."

## Clarifications

### Session 2026-05-04

- Q: How does the `unit` taxonomy extend beyond the v1 enumerated set (`USD | hours | prayer-commitments | nights`)? → A: Each pool declares its `acceptedUnits` as an open string-enum with a v1 baseline set; new units (e.g., `meals`, `rides`, `translation-hours`) are added by registering them on the pool's domain configuration. A pledge's `unit` MUST be one of the target pool's `acceptedUnits`. Forward-compatible without schema migration; matches the project's existing credential-registry pattern for evolving taxonomies.
- Q: For multi-steward pools (giving circles, boards), against which agent is trust-proximity computed? → A: Proximity is computed to the pool's own first-class agent (`Pool` is itself an agent in the relationship graph; pool-level relationships represent the collective stewardship). For pools without a pool-level agent, fall back to the *minimum* hop distance across the set of individual stewards (a deterministic min, not a per-viewer pick). This guarantees rank determinism and avoids the ordering ambiguity of "pick a steward".
- Q: When a pool author has not declared a capacity-ceiling policy, what is the default behaviour? → A: Default is `accept` (no ceiling enforced; pledges always succeed subject to other gates). Donors are never blocked by a default a pool author didn't opt into. Pools that want a hard ceiling or waitlist behaviour must explicitly declare it on the pool.
- Q: For an `annual` pledge amended mid-cycle, does the duration window reset? → A: It depends on which field is amended. **Amount-only** amendments preserve the existing duration window (the amount-from-this-date forward becomes the new amount). **Cadence** amendments start a new window from the amendment date (the artifact's active terms reflect the new cadence going forward). **Duration** amendments replace the existing window with the new value. All amendments are recorded as versioned entries in `history`; the artifact's top-level fields always reflect the *latest active* terms.
- Q: When a pledge is stopped, where is the bright line between "future obligations cease" and "already-allocated capacity not recalled"? → A: `stoppedAt` is the cut-off. Disbursements with `disburseAt <= stoppedAt` are already-committed and proceed normally; disbursements scheduled `> stoppedAt` are cancelled. Allocations made by stewards *before* `stoppedAt` are honored regardless of disbursement timing (that is a stewardship decision the pledge cannot retroactively undo). The downstream allocation/disbursement spec reads `stoppedAt` and applies this rule.

## Overview

Spec 001 covers the **Relationship lane** — direct 1:1 matches between counter-intents. This spec covers the **Pool lane**: the many-to-many shape of generosity in which givers pledge capacity to a *pool* (a fund, coaching network, prayer chain, skills bench, hospitality network), and the pool's stewardship authority later allocates that capacity to recipients. The donor's intent is honored via *advisory authority* (recommendations, restrictions, votes); the pool holds *stewardship authority* over actual allocation; the recipient has *execution authority*. This authority gradient (per `docs/specs/faith-funding-and-stewardship.md` § 3.4) is the load-bearing principle of the lane.

This feature delivers the discovery + pledge surface — closing the loop from *pool published* to *pledge committed*. It does **not** allocate funds, disburse, acknowledge donors, validate outcomes, or trigger trust updates — those each belong to downstream specs that consume the **Pool Pledge** artifact this feature produces.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Browse & filter active pools in the hub (Priority: P1)

A hub member opens the hub's pools page and wants to see which pools are accepting pledges right now — funds, coaching networks, prayer chains, skills benches, hospitality networks — and narrow that list by domain (funding, coaching, prayer, skills, hospitality), governance model (DAF, giving circle, mission cooperative, mutual aid), geo, and free-text. Pools are first-class agents in the existing graph; this story renders them as a filterable index.

**Why this priority**: Without browsing, the pool lane is invisible. Members can't pledge if they can't find pools.

**Independent Test**: Seed a hub with ≥6 pools across at least 3 domains and 3 governance models. Verify a member can land on the index, apply combinations of filters and free-text search, and see the correct subset. Public pools are visible to all hub members; private pools are visible only to addressed members.

**Acceptance Scenarios**:

1. **Given** a hub with 4 funding pools, 2 coaching pools, and 1 prayer pool, **When** the user filters by domain = "coaching", **Then** only the 2 coaching pools appear and the count chip reflects 2.
2. **Given** pools tagged with governance models DAF, giving-circle, and mission-cooperative, **When** the user filters by governance = "giving-circle", **Then** only giving-circle pools appear.
3. **Given** pools mandated for "Northern Colorado trauma-care" and "Togo business coaching", **When** the user types "Colorado" into search, **Then** only the matching pool appears.
4. **Given** a private pool addressed only to specific hub members, **When** any other hub member views the index, **Then** the private pool is not shown.
5. **Given** a filter combination yielding no results, **When** the user sees the result list, **Then** they see an empty-state with guidance to widen filters or propose a new pool.

---

### User Story 2 — View pool detail: mandate, restrictions, capacity, recent allocations (Priority: P1)

A member considering whether to pledge opens a pool's detail page. They want to see what the pool is for (mandate), what restrictions it accepts and rejects (e.g., "trauma-care only", "no admin overhead"), how much capacity it currently holds (pledged total, allocated total, available), and recent allocation history (what proposals or recipients it has supported, with appropriate aggregation for privacy). This is the *informed consent* surface that precedes pledging.

**Why this priority**: P1 — pledging without seeing mandate + recent activity is fiduciary malpractice. ECFA-style stewardship (§ 3.4) requires donors can see what the pool is doing before committing.

**Independent Test**: Open a seeded pool detail page. Verify the mandate, restriction policy, current capacity (pledged / allocated / available), and the last N (default 5) allocations are visible at appropriate aggregation. For private pools, verify the page renders only for addressed members.

**Acceptance Scenarios**:

1. **Given** a pool with mandate "Northern Colorado trauma-care training" and restrictions {`kinds: [trauma-care]`, `notForAdmin: true`}, **When** the user opens the detail page, **Then** mandate text and restriction list are visible.
2. **Given** a pool that has received pledges totalling $12,400 and allocated $8,100 across 3 awards, **When** the user views the detail page, **Then** capacity widgets show `pledged: $12,400`, `allocated: $8,100`, `available: $4,300`.
3. **Given** a pool with prior allocations carrying `storyPermissions: anonymizeBeneficiaries`, **When** the user views recent allocations, **Then** beneficiary identities are aggregated (e.g., "12 leaders trained") rather than named.
4. **Given** a pool with zero allocations to date, **When** the user views recent allocations, **Then** an empty-state explains the pool is new or has no completed allocations yet.

---

### User Story 3 — Pledge into a pool with optional restrictions and cadence (Priority: P1)

A member commits capacity to a pool by pledging. They pick a cadence (one-time, monthly, annual / faith-promise), state an amount or unit (dollars for funding pools, hours for coaching/skills, prayer commitments for prayer pools, nights for hospitality), optionally attach restrictions inheriting from the pool's allowed restriction set, and choose `storyPermissions` (public attribution vs anonymous vs share-with-fund-only). On submit, the system creates a **Pool Pledge** artifact handed to the downstream allocation/disbursement spec.

**Why this priority**: P1 — without pledging, discovery is read-only. The artifact this story produces is the explicit handoff contract to the allocation spec.

**Independent Test**: From a pool detail page, the member submits a pledge with cadence = monthly, amount = $100, restriction = "trauma-care only", `storyPermissions: shareWithSupportTeam`. Verify a Pool Pledge artifact is created with all fields, the pool's `pledged` capacity widget increments accordingly, and the pledger sees a confirmation referencing the next step ("the pool's stewards will allocate per their mandate").

**Acceptance Scenarios**:

1. **Given** a pool accepting `kinds: [trauma-care, church-planting]` restrictions, **When** the user pledges $100/month with restriction `kinds: [trauma-care]`, **Then** a Pool Pledge artifact is created with `cadence: monthly`, `unit: USD`, `amount: 100`, `restrictions: { kinds: [trauma-care] }`, and the pool's pledged total increments by the appropriate cadence-aware total.
2. **Given** a pool that does NOT accept `kinds: [foreign-mission]`, **When** the user attempts a pledge with that restriction, **Then** the form rejects with a message naming the pool's allowed restriction set.
3. **Given** a faith-promise campaign pool with a campaign window of 12 months, **When** the user pledges $1,200 annual, **Then** the Pool Pledge artifact records `cadence: annual`, `duration: 12 months`, and the pool's pledged total reflects the full annual commitment.
4. **Given** a private pool addressed to specific members, **When** a non-addressed member somehow reaches the pledge form, **Then** the submit action is blocked with an authorization error.
5. **Given** a pool that has reached or exceeded its declared capacity ceiling (if any), **When** the user attempts to pledge, **Then** the form warns and offers to pledge to a waitlist or pick a different pool. (Pool authors may declare a ceiling; not all pools have one.)

---

### User Story 4 — Rank pools by trust + prior outcomes (Priority: P2)

When several pools share a domain, the order matters. The system orders pools by the same composite formula spec 001 established for candidate ranking — trust-graph proximity (relational distance to the pool's stewardship agent, or to a designated steward) and prior outcome quality (proportion of the pool's prior allocations that reached `fulfilled`). Each pool exposes a "why this rank" cue.

**Why this priority**: P2 (not P1) because Story 1 already delivers a usable browse/search; ranking is a quality multiplier. Without ranking, members still see all eligible pools; with ranking, they see the most trust-aligned + outcome-proven first.

**Independent Test**: Seed two same-domain pools — one whose steward is at relational distance 1, with prior allocation success rate 0.9; another at distance 4 with success rate 0.4. Verify the closer + better-outcome pool ranks first, and the rank cue states the contributing factors.

**Acceptance Scenarios**:

1. **Given** two coaching pools whose stewards are 1 hop and 4 hops from the viewer, with prior outcome scores 0.9 and 0.4, **When** the index is rendered with default ranking, **Then** the 1-hop / 0.9 pool appears first.
2. **Given** two pools whose ranking signals tie within tolerance, **When** ordered, **Then** ties break on recency (most recently active pool first).
3. **Given** a brand-new pool with zero prior allocations, **When** ranked, **Then** the cold-start outcome score (0.5 from Laplace smoothing) applies and the cue states "no prior history yet".
4. **Given** the user is curious about a rank, **When** they expand the rank cue, **Then** they see the contributing factors (proximity = N hops; prior outcomes = X fulfilled / Y abandoned).

---

### User Story 5 — Manage your active pledges (Priority: P2)

A member who has pledged to one or more pools wants to see what they've pledged, change a recurring cadence, increase / decrease an amount, or stop a pledge going forward. Stopping is **soft** — it terminates future obligations but does not retroactively unpledge already-allocated capacity. (Recall of already-allocated capacity is governance-dependent and lives in the downstream spec.)

**Why this priority**: P2 — pledging is meaningless if pledges can't be reviewed and adjusted. Self-service management reduces support burden.

**Independent Test**: From a "your pledges" page, verify a member sees all their active pledges grouped by pool, can edit cadence/amount on a recurring pledge, and can stop a pledge with a clear explanation of what stopping does (and does not) do.

**Acceptance Scenarios**:

1. **Given** a member with 2 active recurring pledges and 1 one-time pledge, **When** they open "your pledges", **Then** all 3 are listed with current state (next-disbursement-due, total-pledged-to-date, restrictions).
2. **Given** a member adjusts a recurring pledge from $100/month to $150/month, **When** they save, **Then** the Pool Pledge artifact records the adjustment as a versioned amendment (does not erase history).
3. **Given** a member stops a recurring pledge, **When** they confirm, **Then** the pledge transitions to `stopped`, future obligations cease, and the user sees an explanation that already-allocated capacity is not recalled by this action.

---

### Edge Cases

- **Private pool**: excluded from public browse; surfaced only to addressed members. Pledging to a private pool is gated to addressed members.
- **Pool with capacity ceiling reached**: pledging is blocked or routed to waitlist (pool author's choice).
- **Restriction not in pool's allowed set**: pledge form rejects with the allowed list shown.
- **Recurring pledge whose underlying pool is closed/withdrawn by stewards**: pledge transitions to `stopped` automatically; member is notified.
- **Connector / on-behalf-of pledging**: out of scope for v1 — only the donor agent pledges. Delegation-based proxy pledging deferred.
- **Multi-cadence amendments**: history preserved as ordered amendments; the artifact carries the latest active terms plus a history list.
- **Tied ranks**: break on recency (most recently active pool first).
- **Cold-start pool**: rank uses Laplace-smoothed outcome score (0.5 with zero data) plus proximity.
- **Pool with no recent allocations**: detail page explicit empty state.
- **Cross-hub visibility**: deferred (see Q2 of spec 001 — issuing-hub members only).

## Requirements *(mandatory)*

### Functional Requirements

**Browse & filter (User Story 1):**

- **FR-001**: System MUST list active pools scoped to the current hub (pool's `addressedTo` resolves to the hub or to a private membership list within it).
- **FR-002**: System MUST allow filtering by domain (funding, coaching, prayer, skills, hospitality, etc., per the existing intent-kinds taxonomy), governance model (DAF, giving-circle, mission-cooperative, mutual-aid, faith-promise), geo, and free-text across name / mandate / description.
- **FR-003**: System MUST exclude private pools from public browse results, surfacing them only to members on the pool's addressed-membership list.
- **FR-004**: System MUST surface an empty-state with guidance when filters yield zero results.

**Pool detail (User Story 2):**

- **FR-005**: System MUST render a pool detail page exposing mandate text, accepted restriction set, capacity widgets (pledged total, allocated total, available), and a recent-allocations list.
- **FR-006**: System MUST honour each allocation's `storyPermissions` when rendering recent allocations: public attribution renders names; anonymized aggregation renders counts and outcomes without identities; "share with fund only" suppresses the entry from non-steward viewers.
- **FR-007**: System MUST gate private pool detail pages to addressed members only.

**Pledge (User Story 3):**

- **FR-008**: System MUST allow an authorised hub member to submit a Pool Pledge with cadence (`one-time | monthly | annual`), unit (one of the target pool's declared `acceptedUnits` — open string-enum, v1 baseline set is `USD | hours | prayer-commitments | nights`; pools may declare additional units on their domain configuration), amount, optional restrictions (subset of the pool's accepted set), `storyPermissions` (`public | shareWithSupportTeam | anonymous`), and optional duration (for recurring/annual pledges). Pledges whose `unit` is not in the pool's `acceptedUnits` MUST be rejected.
- **FR-009**: System MUST reject pledges whose restrictions are outside the pool's allowed restriction set, returning the allowed set in the error.
- **FR-010**: System MUST gate pledging to addressed members for private pools.
- **FR-011**: System MUST update the pool's pledged-total capacity widget upon successful pledge in a way appropriate to cadence (one-time = amount; monthly with N-month duration = amount × N; annual = amount × duration-years).
- **FR-012**: System MUST handle pool capacity-ceiling conditions per the pool's declared policy: `block` (reject pledges that would exceed the ceiling), `waitlist` (queue overage pledges in a separate `waitlisted` state), or `accept` (allow overage). When a pool has not declared a ceiling policy, the default is `accept` (no ceiling enforced; donors are never blocked by an unset default).
- **FR-013**: System MUST produce a Pool Pledge artifact per the field shape defined in Key Entities.
- **FR-014**: System MUST be deterministic for a given input snapshot — re-running the rank with no underlying changes yields the same order.

**Ranking (User Story 4):**

- **FR-015**: System MUST rank pools using the same composite formula as spec 001 — `score = 0.6 * proximityScore + 0.4 * outcomeScore`, where `proximityScore = 1 / (1 + hops)` and `outcomeScore = (fulfilled + 1) / (fulfilled + abandoned + 2)` (Laplace-smoothed; "fulfilled / abandoned" measured over the pool's prior allocations rather than its individual pledges). `hops` is computed to the pool's own first-class agent (Pool-as-agent in the relationship graph). For pools without a pool-level agent, `hops` is the *minimum* hop distance across the set of individual stewards (deterministic minimum, not a per-viewer pick) — guaranteeing rank determinism per FR-014.
- **FR-016**: System MUST expose a per-pool "why this rank" cue summarising the contributing signals (e.g., "1 hop · 12 fulfilled / 1 abandoned").
- **FR-017**: System MUST break rank ties on recency (most recently active pool first; "active" = most recent pledge or allocation).

**Pledge management (User Story 5):**

- **FR-018**: System MUST present a "your pledges" view listing the viewer's active pledges grouped by pool, with current state (cadence, amount, next-disbursement-due, total-pledged-to-date, restrictions).
- **FR-019**: System MUST allow amending a recurring pledge's amount, cadence, or duration. Amendments are recorded as versioned entries in the artifact's `history` array; the top-level fields reflect the latest active terms. Window-reset semantics: amount-only amendments preserve the existing duration window; cadence amendments start a new window from the amendment date; duration amendments replace the existing window.
- **FR-020**: System MUST allow stopping a recurring pledge (transition to `status = 'stopped'` with `stoppedAt` timestamp). Disbursements scheduled with `disburseAt <= stoppedAt` proceed normally; disbursements scheduled after `stoppedAt` are cancelled. Allocations made by stewards before `stoppedAt` are honored regardless of disbursement timing. The user-facing confirmation MUST explain this rule plainly.
- **FR-021**: System MUST auto-stop a member's pledge when its underlying pool transitions to `closed` or `withdrawn`, and notify the member.

**Cross-cutting:**

- **FR-022**: System MUST default discovery scope to the current hub. Cross-hub pool visibility is deferred (matches spec 001 Q2 — issuing-hub members only).
- **FR-023**: System MUST prevent connector / on-behalf-of pledging in v1 (only the donor agent pledges).

### Key Entities

- **Pool** *(existing first-class agent — now formally typed)*: A fund / coaching network / prayer chain / skills bench / hospitality network with mandate, governance model, accepted restriction set, `acceptedUnits` (open string-enum declaring which pledge units the pool accepts), capacity ceiling and ceiling-policy (`block | waitlist | accept`; default `accept` when undeclared), `addressedTo`, `visibility` (`public | private`), and a stewardship agent (the Pool itself acts as the agent for ranking purposes; for pools without a pool-level agent, the set of individual stewards is used per FR-015). A **Fund** is a Pool with `governanceModel: 'fund'` (treated as a typed sub-shape — Funds operate Rounds in spec 003). Discovery reads but does not mutate this entity.
- **Pool Pledge** *(new)*: An artifact recording a member's commitment to a pool. **The shape of this artifact is the explicit contract handed to the downstream allocation spec.** Fields:
  - `id` — stable identifier consumable by the allocation workflow.
  - `pledgerAgentId` — the donor (in v1, must equal the submitter; connector mode out of scope).
  - `poolAgentId` — the pool the pledge is into.
  - `cadence` — `'one-time' | 'monthly' | 'annual'`.
  - `unit` — one of the target pool's declared `acceptedUnits` (open string-enum; v1 baseline: `'USD' | 'hours' | 'prayer-commitments' | 'nights'`; pools may declare additional units).
  - `amount` — numeric amount per cadence period.
  - `duration` — for `monthly` / `annual`, the commitment horizon (e.g., `12 months`). Null for `one-time`.
  - `restrictions` — subset of the pool's accepted restriction set (e.g., `{ kinds: ['trauma-care'], geoRoot: 'us/colorado', notForAdmin: true }`); empty if unrestricted.
  - `storyPermissions` — `'public' | 'shareWithSupportTeam' | 'anonymous'`.
  - `pledgedAt` — timestamp.
  - `status` — `'active'` (current), `'waitlisted'` (on a `waitlist`-policy pool past its ceiling), `'stopped'` (member-stopped; future obligations cease), `'auto-stopped'` (pool closed/withdrawn), `'fulfilled'` (one-time pledges completed; only meaningful post-allocation).
  - `stoppedAt` — timestamp when the pledge transitioned to `stopped` or `auto-stopped`; null otherwise. Bright-line for the "future obligations cease" rule (FR-020).
  - `history` — ordered list of prior versions if the pledge has been amended, each with the old value and amendment timestamp. Discovery may advance through `'active' | 'waitlisted' | 'stopped' | 'auto-stopped'`; `'fulfilled'` is set by the downstream allocation/disbursement spec.
  - `visibility` — privacy tier; derived at write time from the pool's visibility and the donor's `storyPermissions`. **Anonymous donors and private-pool pledges remain owner-private** and are not anchored on chain, even though the pool's aggregate capacity widget continues to reflect their contribution.

  Allocation-side fields (which proposals were funded, which recipients received, acknowledgment cadence, etc.) are not part of this artifact — they belong to the downstream allocation spec, which references this artifact by `id`.
- **Pledge Amendment** *(implicit, embedded in `history`)*: A prior version of a pledge's terms. Not a separate top-level entity; lives inside Pool Pledge's `history` array.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A hub member can find at least one pool aligned with a typical domain (funding, coaching, prayer, etc.) within 30 seconds of opening the hub's pools page (assumes ≥1 matching pool exists in seed data).
- **SC-002**: For seeded pools with at least one prior allocation, the pool detail page renders mandate, capacity, and recent allocations within 2 seconds at the 95th percentile under typical hub load (single-digit thousands of pools).
- **SC-003**: 0% of private pools leak into public browse for non-addressed viewers, verified by automated test against seeded private pools.
- **SC-004**: Pledge submission round-trips (form open → confirmation visible) in under 5 seconds at the 95th percentile.
- **SC-005**: A Pool Pledge artifact produced by this feature is consumed without further transformation by the downstream allocation workflow — i.e., the artifact contains every field the allocation spec needs to honour the pledge's restrictions and storyPermissions.
- **SC-006**: Across a representative seeded hub, 80% of members who land on the pools index proceed to at least one pool detail page (browse-to-detail conversion).
- **SC-007**: Members can edit or stop a recurring pledge in fewer than 3 clicks from the "your pledges" page.

## Assumptions

- **Hub-scope is the default**, cross-hub pool discovery is deferred (matches spec 001 Q2). A pool addressed `network:<hubId>` is visible only to issuing-hub members in v1.
- **Connector / on-behalf-of pledging** is out of scope for v1. Delegation-based proxy pledging (a steward pledging for someone via delegation) is deferred to a future spec.
- **Stewardship authority** lives entirely on the pool side — this spec records the donor's *advisory* intent (restrictions, recommendations encoded as `storyPermissions` + restrictions); the pool's stewards decide allocations in a downstream spec.
- **Acknowledgment cadence and content** (donor receipts, impact summaries) are downstream — the pledge merely declares acknowledgment expectations indirectly via `storyPermissions`. Explicit acknowledgment policy lives on the pool, not on the pledge, and is rendered to donors at pledge time.
- **Ranking signals** reuse the spec 001 composite (`0.6 * proximity + 0.4 * outcome`, Laplace-smoothed). Tuning the weights is configuration, not model change.
- **Trust-graph signal** is computed against the pool's stewardship agent (or designated head-steward) — pools are first-class agents with relationship edges in the existing graph.
- **Prior-outcome signal** is the proportion of the pool's *prior allocations* (downstream spec) that reached `fulfilled` — for v1, this signal will be empty for new pools and will populate as the allocation spec ships. Cold-start handled by Laplace smoothing (FR-015).
- **Amount units** are domain-driven: `USD` for funding pools, `hours` for coaching/skills, `prayer-commitments` for prayer, `nights` for hospitality. The pool declares its accepted unit; pledges must match.
- **Pool capacity ceilings** are optional. When absent, pledges always succeed (subject to other gates). When present, behaviour is per pool author's policy (block / waitlist / accept overage).
- **Existing UI routes** are extended in place (`apps/web/src/app/h/[hubId]/(hub)/pools/`) rather than replaced.

## Dependencies

- Existing pool agents in the knowledge graph (fund agents, coaching-network agents, prayer-chain agents, skills-bench agents, hospitality-network agents).
- Existing `AgentRelationship` graph (used for trust-proximity to the pool's stewardship agent).
- Existing visibility / addressed-membership gates (used to enforce private-pool privacy and gate pledging on private pools).
- Existing hub membership and `addressedTo` semantics (`hub:<id>`, `network:<id>`, `agent:<addr>`).
- Spec 001's ranking formula (reused; see FR-015).
- Downstream **allocation / disbursement spec** (consumes the Pool Pledge artifact). This feature defines the artifact's contract; the allocation spec consumes it.
- Downstream **acknowledgment spec** (renders donor receipts and impact summaries). The pledge's `storyPermissions` is the input.

## Out of Scope (handed to other specs)

- Allocation: the pool's stewards deciding which proposals / recipients receive capacity.
- Disbursement: actual transfer of capacity from pool to recipient.
- Acknowledgment: donor receipts, impact summaries, story rendering with `storyPermissions` enforcement.
- Trust-graph mutation triggered by allocation outcomes.
- Recall of already-allocated capacity when a donor stops a pledge (governance-dependent; downstream).
- Connector / on-behalf-of pledging via delegation.
- Cross-hub pool discovery (members of one hub seeing another hub's pools).
- Campaign-wrapper timing and matching pools (see `docs/specs/faith-funding-and-stewardship.md` § 5 — distinct future spec).
- Stewardship governance flows (steward votes, mandate amendments, board reviews).
