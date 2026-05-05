# Feature Specification: Intent Marketplace — Proposal Lane (Discovery & Submission)

**Feature Branch**: `003-intent-marketplace-proposal`
**Created**: 2026-05-04
**Status**: Draft
**Input**: User description: "Proposal lane discovery and submission — within a hub. Let agents browse open grant rounds / RFPs / proposal windows scoped to a fund's mandate; see each round's eligibility, deadline, budget ceiling, decision cadence, and prior award stats; draft and submit a Proposal artifact with budget, milestones, desired outcomes, validators, and reporting obligations against a chosen round (or open call). Builds on spec 001's intent foundation: a Proposal references the underlying NeedIntent it operationalises. Ranking applies in two directions — for proposers, surface rounds whose mandate matches their intent; for stewards, surface proposals matching their fund's mandate (using the same proximity + prior-outcome composite from 001). This spec terminates at proposal submitted."

## Clarifications

### Session 2026-05-04

- Q: For a proposer with multiple eligible open rounds, how does the system rank rounds? → A: Reuses spec 001 composite — `score = 0.6 * proximityScore + 0.4 * outcomeScore`, where `proximityScore = 1 / (1 + hops)` is computed to the round's *fund agent* (not the round itself), and `outcomeScore = (fulfilled + 1) / (fulfilled + abandoned + 2)` is measured over the fund's *prior awards that the proposer's outcomes match in domain* — i.e., funds that have historically delivered fulfilled outcomes in this proposer's intent domain rank higher. Falls back to fund-wide outcome score when no domain match exists.
- Q: For a steward viewing incoming proposals on a round, how are proposals ranked for review? → A: Same composite. `proximityScore` is hops from the *fund agent* to the *proposer agent*; `outcomeScore` is the *proposer's* prior fulfilled/abandoned ratio (Laplace-smoothed). Stewards may override the rank in their own UI but the default order is the formula's output.
- Q: Can a proposer submit the same Proposal artifact to multiple rounds simultaneously? → A: No — a Proposal references exactly one round (or `null` for an "open call" submission to a fund without a specific round). To submit to a second round, the proposer must clone the Proposal (the system MAY offer a clone affordance). Cloning produces a new artifact with a fresh `id` and a `clonedFromProposalId` back-reference; outcomes, awards, and review state do not carry across.
- Q: Can a Proposal be edited after submission? → A: Yes, in two distinct modes. **Pre-deadline**: while the round is `open` and the deadline has not passed, the proposer may freely edit and the artifact's `version` increments; the steward sees the latest version. **Post-deadline / under-review**: edits require steward consent (out of scope for this spec — handled by the steward-review spec); discovery shows the artifact frozen at the submission-deadline snapshot. Withdrawals are always allowed and transition `status` to `withdrawn`.
- Q: For an "open call" submission (no specific round), what determines eligibility and validation? → A: Eligibility is checked against the *fund's mandate* directly (kinds, geo, budget bounds, organisational requirements). Open-call proposals carry `roundId: null` and `fundMandateId` instead. The fund declares whether it accepts open-call submissions; when the fund's `acceptsOpenCalls` is `false`, only round-bound proposals are accepted.

## Overview

Spec 001 covers the **Relationship lane** (direct 1:1 intent matches). Spec 002 covers the **Pool lane** (many-to-many via stewarded pools). This spec covers the **Proposal lane**: the formal grant-cycle shape of generosity, where a recipient drafts a structured proposal (budget, milestones, outcomes, validators, reporting cadence) and submits it to a *round* operated by a fund, or to a fund directly via open call. The fund's stewards later review, decide, and award — those steps are downstream.

This feature delivers the discovery + submission surface — closing the loop from *round published* to *proposal submitted*. It does **not** review proposals, decide awards, structure tranches, gate disbursement on milestone completion, validate outcomes, or trigger trust updates — those each belong to downstream specs that consume the **Grant Proposal** artifact this feature produces.

The Proposal lane reuses two contracts already established by 001 and 002: the artifact-handoff pattern (terminal step → handoff to next spec) and the composite ranking formula (`0.6 * proximity + 0.4 * outcome`, Laplace-smoothed). Both are tuned for the lane's two-sided ranking — proposers ranking rounds, stewards ranking incoming proposals.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Browse open rounds eligible for your intent (Priority: P1)

A hub member with an active `NeedIntent` (e.g., "$50,000 to train 40 trauma-care leaders in Northern Colorado") opens the rounds page. They see open rounds — funds that are currently accepting proposals — with each round's mandate match against their intent surfaced clearly: "✓ matches your trauma-care intent · deadline 14d · budget ceiling $250k". Filters narrow by domain (funding, coaching, etc.), deadline horizon (closing this week / month / quarter), budget range, and free-text.

**Why this priority**: Without browsing, proposers can't find rounds. This is the entry point of the lane.

**Independent Test**: Seed a hub with ≥4 open rounds across at least 2 fund domains, with different deadlines and budget ceilings. Seed a proposer with one `NeedIntent`. Verify the proposer can land on the rounds index, see all eligible rounds with mandate-match indicators, apply filters, and read enough of each round's metadata to choose where to submit.

**Acceptance Scenarios**:

1. **Given** a proposer with `NeedIntent { kind: trauma-care, geo: us/colorado, amount: 50000 }` and 3 open rounds — A (`mandate: trauma-care, geo: us/colorado, ceiling: 250000`), B (`mandate: church-planting, ceiling: 100000`), C (`mandate: trauma-care, geo: global, ceiling: 30000`), **When** the proposer browses with default eligibility filter on, **Then** rounds A and C appear (mandate match) with "✓ matches" badges; round C carries a soft warning ("budget below your stated need").
2. **Given** the same setup, **When** the proposer filters by deadline = "closing this week", **Then** only rounds with `deadline <= now + 7d` appear.
3. **Given** rounds with mandate "Northern Colorado trauma-care" and "global maternal health", **When** the proposer types "Colorado" into search, **Then** only the matching round appears.
4. **Given** a closed round (deadline past), **When** the proposer browses with default filter, **Then** the closed round is hidden; an opt-in "include closed rounds" toggle reveals it.
5. **Given** a private round addressed to specific applicants only, **When** any non-addressed proposer views the index, **Then** the private round is not shown.

---

### User Story 2 — View round detail: eligibility, budget, milestones template, prior awards (Priority: P1)

A proposer considering a round opens its detail page. They want to see eligibility criteria (mandate, geo, organisational requirements, credentials needed), the budget envelope (ceiling, expected award size, tranche structure), the round's expected proposal shape (milestones template, validators expected, reporting cadence required), the deadline and decision date, and statistics from prior rounds (proposals received → awards made, typical award size, prior recipient profiles). This is the *informed effort decision* surface — proposers expend significant time on submissions and need to know whether to invest.

**Why this priority**: P1 — proposers won't submit without seeing the mandate match, the effort required, and the historical likelihood. ECFA-style stewardship + grant-cycle convention require this transparency.

**Independent Test**: Open a seeded round detail page. Verify mandate text, eligibility list, budget envelope, milestone template, validator requirements, reporting cadence, deadlines, and prior-round stats render. Private rounds gate the page to addressed applicants.

**Acceptance Scenarios**:

1. **Given** a round with mandate "Northern Colorado trauma-care training", ceiling $250k, expected awards 6, milestone template (3 tranches: kickoff 30% / mid 40% / completion 30%), reporting cadence quarterly, **When** the user opens detail, **Then** all five blocks render with their values.
2. **Given** a round whose prior cycle awarded 8 of 24 proposals, with median award $35k, **When** the user views detail, **Then** the prior-stats block shows `8/24 awarded · median $35k`.
3. **Given** a brand-new round with no prior cycles, **When** the user views detail, **Then** the prior-stats block shows an explicit empty state ("first cycle — no prior data").
4. **Given** a round with `requiredCredentials: [VerifiedHuman]`, **When** the user views detail, **Then** the eligibility block names the required credentials and indicates whether the viewer holds them.

---

### User Story 3 — Draft & submit a Proposal artifact (Priority: P1)

A proposer composes a Proposal: budget (line items + total), plan (narrative + Plan reference), milestones (each with `dueDate`, `evidenceRequired`, `trancheAmount`), desired outcomes (each `statement`, `measurable`, `validators`), reporting obligations (cadence + format), organisational background (prior track record). The proposer references the underlying `NeedIntent` and chooses the target round (or `null` for an open call to a fund). On submit, the system creates a **Grant Proposal** artifact handed to the downstream review/award spec, and transitions the underlying intent to `acknowledged` (per the existing intent state model — same transition spec 001 uses for direct matches).

**Why this priority**: P1 — without submission, discovery is read-only. The artifact is the explicit handoff contract to the steward-review spec.

**Independent Test**: From a round detail page, the proposer drafts a complete proposal, submits, and receives a confirmation referencing the steward-review timeline. Verify a Grant Proposal artifact is created with all fields, the round's `proposalsReceived` counter increments, the underlying intent transitions to `acknowledged`, and the proposer can find the proposal in their "your proposals" list.

**Acceptance Scenarios**:

1. **Given** a complete draft (budget, plan, milestones, outcomes, reporting, background) targeting an open round and referencing an `expressed` `NeedIntent`, **When** the proposer submits, **Then** a Grant Proposal artifact is created with `status = 'submitted'`, the round's counter increments, the intent transitions to `acknowledged`, and the proposer sees a confirmation with the steward decision-date.
2. **Given** a draft missing required fields per the round's expected proposal shape (e.g., milestones), **When** the proposer attempts to submit, **Then** the form blocks submission and lists the missing required fields.
3. **Given** a proposer attempting to submit to a round with `requiredCredentials: [VerifiedHuman]` they don't hold, **When** they attempt to submit, **Then** the action is blocked and the error explains which credential is missing and how to obtain it.
4. **Given** a draft targeting an "open call" (no specific round) on a fund whose `acceptsOpenCalls = true`, **When** the proposer submits, **Then** the artifact carries `roundId: null` and `fundMandateId: <fund>`.
5. **Given** a fund with `acceptsOpenCalls = false`, **When** the proposer attempts an open-call submission, **Then** the action is blocked with an explanation that this fund accepts only round-bound submissions.
6. **Given** a draft whose budget total exceeds the round's `budgetCeiling`, **When** the proposer attempts to submit, **Then** the form warns and blocks (or routes to the fund's overage policy if declared).

---

### User Story 4 — Rank rounds for proposers; rank proposals for stewards (Priority: P2)

When several rounds are eligible for a proposer, ranking surfaces the best fits first. When a steward views incoming proposals on a round, ranking surfaces the strongest applicants first. Both directions use the same composite formula as specs 001/002, with the side-specific signals defined in Clarifications Q1/Q2.

**Why this priority**: P2 — Stories 1 and 3 already deliver usable browse and submit. Ranking is a quality multiplier on both sides. Without ranking, proposers see all eligible rounds and stewards see all incoming proposals; with ranking, both sides see the most-aligned and most-trusted first.

**Independent Test**:
- *Proposer side*: seed two same-mandate rounds whose fund agents are at distance 1 and 4 from the proposer, with different prior-outcome scores in the proposer's domain. Verify the closer + better-domain-track-record fund's round ranks first, and the rank cue shows the contributing factors.
- *Steward side*: seed two proposals on the same round, from proposers at distance 1 and 4 from the fund agent, with different prior-fulfilled ratios. Verify the closer + better-record proposer's proposal ranks first.

**Acceptance Scenarios**:

1. **Given** a proposer with intent in domain X and two open eligible rounds — fund A (1 hop, prior outcomes in domain X = 0.9) and fund B (4 hops, prior outcomes in domain X = 0.4), **When** the rounds index renders, **Then** fund A's round appears first, with rank cue "1 hop · 9 fulfilled / 1 abandoned in trauma-care".
2. **Given** a steward viewing a round with two incoming proposals from proposers at distance 1 and 4 with prior fulfilled ratios 0.85 and 0.45, **When** the steward views the proposals list, **Then** the closer + better-record proposer's proposal appears first, with rank cue.
3. **Given** ties within composite-score tolerance, **When** ordered, **Then** ties break on recency (most recently created round / most recently submitted proposal first).
4. **Given** a brand-new fund or proposer (no prior outcomes), **When** ranked, **Then** the Laplace-smoothed cold-start outcome score (0.5) applies and the cue states "no prior history yet".

---

### User Story 5 — Manage your draft & submitted proposals (Priority: P2)

A proposer wants a "your proposals" page listing drafts (in-progress), submitted (under review), withdrawn, and decided (downstream-spec status: awarded / declined). They can resume editing a draft, withdraw a submitted proposal (transition to `withdrawn`), or clone an existing proposal as the seed for a new submission to a different round. Edits to a *submitted* proposal are gated: pre-deadline edits are free; post-deadline edits require steward consent (downstream spec).

**Why this priority**: P2 — proposers may have several proposals in flight; without a self-service overview, the lane becomes opaque.

**Independent Test**: From "your proposals", verify each state renders, draft editing resumes correctly, withdraw transitions cleanly, and clone produces a new artifact pre-filled from the source.

**Acceptance Scenarios**:

1. **Given** a proposer with 1 draft, 2 submitted (1 pre-deadline, 1 post-deadline), 1 withdrawn, and 1 decided proposal, **When** they open "your proposals", **Then** all 5 are listed with current state and the appropriate action affordance (resume / edit-pre-deadline / view-only / view-only / view-decision).
2. **Given** a submitted, pre-deadline proposal, **When** the proposer edits and saves, **Then** the artifact's `version` increments, `lastEditedAt` updates, and the steward sees the latest version.
3. **Given** a submitted, post-deadline proposal, **When** the proposer attempts to edit, **Then** the form is read-only with a notice that post-deadline edits require steward consent.
4. **Given** any proposal, **When** the proposer withdraws it, **Then** the artifact transitions to `withdrawn` with `withdrawnAt` timestamp, the round's counter decrements, and the underlying intent's status reverts to `expressed` if the only acknowledgement was this proposal.
5. **Given** a submitted or decided proposal, **When** the proposer clones it, **Then** a new draft Proposal artifact is created with `clonedFromProposalId` set; outcomes, awards, and review state do not carry across.

---

### Edge Cases

- **Closed round** (deadline past): hidden from default browse; opt-in toggle to view. Submission rejected.
- **Private round**: excluded from public browse; surfaced only to addressed applicants.
- **Missing required credential**: submission blocked with a path to obtain the credential.
- **Budget overage**: rejected by default; can be routed by the fund's overage policy if declared.
- **Open-call to a fund that doesn't accept them**: rejected with explanation.
- **Withdrawal effect on intent**: if this proposal was the *only* acknowledgement of the underlying intent, the intent reverts to `expressed`. If the intent has other live acknowledgements (e.g., a direct match from spec 001), the intent stays `acknowledged`.
- **Duplicate submission to same round**: blocked by virtue of the artifact's one-round constraint (Q3) — proposer must clone instead.
- **Cold-start fund / proposer**: ranked using Laplace-smoothed score (0.5 with zero data).
- **Tied ranks**: break on recency (most recently created round / most recently submitted proposal).
- **Cross-hub visibility**: deferred (matches spec 001 Q2 — issuing-hub members only).
- **Connector-style proposing** (someone proposing on behalf of another agent): out of scope for v1; only the proposer themselves submits.

## Requirements *(mandatory)*

### Functional Requirements

**Browse open rounds (User Story 1):**

- **FR-001**: System MUST list open rounds scoped to the current hub, with each round's mandate match against the viewer's expressed `NeedIntent`s surfaced as a per-round badge.
- **FR-002**: System MUST allow filtering by domain, deadline horizon (this week / month / quarter / custom), budget range, free-text across mandate / fund name / description, and "include closed rounds" opt-in.
- **FR-003**: System MUST exclude private rounds from public browse, surfacing them only to addressed applicants.
- **FR-004**: System MUST surface an empty-state with guidance when filters yield zero results.

**Round detail (User Story 2):**

- **FR-005**: System MUST render a round detail page exposing mandate, eligibility (geo, organisational requirements, required credentials), budget envelope (ceiling, expected award size, tranche template), milestone template, validator requirements, reporting cadence, deadline, decision date, and prior-round statistics (proposals received, awards made, median award size, prior recipient profiles aggregated to honor any `storyPermissions`).
- **FR-006**: System MUST gate private round detail pages to addressed applicants only.
- **FR-007**: System MUST surface viewer credential ownership inline against each `requiredCredential` (e.g., "✓ VerifiedHuman" / "✗ VerifiedOrg — obtain via …").

**Submit a Proposal (User Story 3):**

- **FR-008**: System MUST allow a proposer to draft a Proposal with: reference to underlying `NeedIntent` (existing); target `roundId` (or `null` for open-call); budget (line items + total); plan (narrative + reference to a Plan artifact); milestones (each with name, due-date, evidence-required, tranche-amount); desired outcomes (each with statement, measurable, validators); reporting obligations (cadence + format); organisational background.
- **FR-009**: System MUST validate the draft against the target round's expected proposal shape (or against the fund's mandate for open-call submissions): all required fields present, budget total within ceiling, required credentials held, milestone count within bounds.
- **FR-010**: System MUST reject submissions that fail validation, returning the failed checks in the response.
- **FR-011**: System MUST gate submission on viewer holding all `requiredCredentials` declared by the round (or fund, for open-call).
- **FR-012**: System MUST gate submission to addressed applicants for private rounds.
- **FR-013**: Upon successful submission, system MUST produce a Grant Proposal artifact per the field shape defined in Key Entities, increment the target round's `proposalsReceived` counter, and transition the underlying intent's status to `acknowledged`.
- **FR-014**: System MUST reject open-call submissions when the target fund's `acceptsOpenCalls = false`.
- **FR-015**: System MUST be deterministic for a given input snapshot in ranking (re-running the rank with no underlying changes yields the same order).

**Ranking (User Story 4):**

- **FR-016**: System MUST rank rounds for a proposer using `score = 0.6 * proximityScore + 0.4 * outcomeScore`, where `proximityScore = 1 / (1 + hops)` is hops from the proposer to the round's *fund agent*, and `outcomeScore = (fulfilled + 1) / (fulfilled + abandoned + 2)` is measured over the fund's prior awards in the proposer's *intent domain*; falls back to fund-wide outcome score when no domain match exists. Per Clarification Q1.
- **FR-017**: System MUST rank proposals for a steward viewing a round using the same composite, where `proximityScore` is hops from the *fund agent* to the *proposer agent* and `outcomeScore` is the proposer's prior fulfilled/abandoned ratio. Per Clarification Q2.
- **FR-018**: System MUST expose a per-row "why this rank" cue summarising the contributing signals (e.g., "1 hop · 9 fulfilled / 1 abandoned in trauma-care").
- **FR-019**: System MUST break rank ties (composite scores within `1e-6`) on recency (most recently created round / most recently submitted proposal first).

**Manage proposals (User Story 5):**

- **FR-020**: System MUST present a "your proposals" view listing the viewer's drafts, submitted, withdrawn, and decided proposals with current state and the appropriate action affordance.
- **FR-021**: System MUST allow editing a draft (no version increment; mutates draft in place) and editing a submitted-but-pre-deadline proposal (version increments; latest version visible to stewards).
- **FR-022**: System MUST present a submitted, post-deadline proposal as read-only in this spec; further edits require steward consent (downstream spec).
- **FR-023**: System MUST allow withdrawing any submitted proposal (transition `status` to `withdrawn` with `withdrawnAt` timestamp; decrement the round's `proposalsReceived` counter; revert the intent to `expressed` if and only if no other acknowledgements exist).
- **FR-024**: System MUST allow cloning any existing proposal (draft, submitted, withdrawn, or decided) into a new draft Proposal with `clonedFromProposalId` set; outcomes, awards, and review state MUST NOT carry across.
- **FR-025**: System MUST prevent the same Proposal artifact from being submitted to multiple rounds. Proposers must clone for cross-round submission.

**Cross-cutting:**

- **FR-026**: System MUST default discovery scope to the current hub. Cross-hub round visibility is deferred (matches spec 001 Q2).
- **FR-027**: System MUST prevent connector / on-behalf-of proposing in v1 (only the proposer agent submits).

### Key Entities

- **Round** *(new — thin first-class entity, subClassOf `prov:Plan`)*: A grant round / RFP / proposal window operated by a fund. Carries `id`, `fundAgentId`, `mandate` (domain, geo, organisational requirements, required credentials), `budgetCeiling`, `expectedAwards`, `milestoneTemplate`, `validatorRequirements`, `reportingCadence`, `deadline`, `decisionDate`, `acceptsOpenCallsFromFund` (inherited from fund), `visibility` (`public | private`), `addressedApplicants` (private-round only), `proposalsReceived` counter. Public rounds anchor on chain at creation/close; the body lives in the fund's org-mcp tenant. Private rounds anchor a coarse on-chain assertion; the addressed-applicants list stays in the fund's org-mcp only. Discovery reads but does not mutate this entity (round authoring is out of scope).
- **Fund** *(existing first-class agent — typed `sa:Fund subClassOf sa:Pool`)*: A Pool with `governanceModel: 'fund'`. Carries `mandate`, `acceptsOpenCalls`, and a stewardship agent. The Pool-as-agent pattern from spec 002 applies — funds are first-class agents in the relationship graph; `proximityScore` is computed against this agent. The `fundMandateId` referenced by an open-call submission resolves directly to a Fund (no separate Mandate entity).
- **Grant Proposal** *(new)*: An artifact recording a proposer's structured ask. **The shape of this artifact is the explicit contract handed to the downstream steward-review spec.** Always private at submission and remains so under steward review — the body lives in the proposer's MCP (almost always org-mcp; person-mcp for solo human applicants), with steward read access via a cross-delegation issued at submit time. No on-chain anchor in v1. Fields:
  - `id` — stable identifier consumable by the review workflow.
  - `proposerAgentId` — the proposer (in v1, must equal the submitter; connector mode out of scope).
  - `roundId` — the target round, or `null` for an open-call submission.
  - `fundMandateId` — for open-call submissions; must match a fund with `acceptsOpenCalls: true`.
  - `basedOnIntentId` — the underlying `NeedIntent` this proposal operationalises (existing entity from spec 001 / current intent layer).
  - `budget` — `{ lineItems: [{ name, amount, unit, justification }], total }`.
  - `plan` — `{ narrative, planArtifactRef? }`.
  - `milestones` — `[{ name, dueDate, evidenceRequired, trancheAmount }]`.
  - `desiredOutcomes` — `[{ statement, measurable, validators: [agentId] }]`.
  - `reportingObligations` — `{ cadence: 'quarterly' | 'milestone' | 'annual' | 'none', format: 'written' | 'written+financial' | 'written+financial+testimony' }`.
  - `organisationalBackground` — narrative + optional reference to prior-track-record artifacts.
  - `submittedAt` — timestamp.
  - `version` — integer; increments on each pre-deadline edit after first submission.
  - `lastEditedAt` — timestamp of latest version.
  - `status` — `'draft'` (not yet submitted), `'submitted'` (under review; downstream spec advances further), `'withdrawn'` (proposer-withdrawn), `'awarded'` / `'declined'` (downstream-set; visible here for read-only display in "your proposals").
  - `withdrawnAt` — timestamp when status moved to `withdrawn`; null otherwise.
  - `clonedFromProposalId` — null if originally drafted; set if cloned. Outcomes / awards do not carry across the clone boundary.
  - `basis` — point-in-time snapshot of the rank-cue components shown to the proposer at submit-time (e.g., `{ proximityHops: 1, fundOutcomeScore: 0.9, domainMatch: true }`); preserves the rationale at proposal time.

  Award-side fields (decision date, awarded amount, tranche release schedule, conditions, review-feedback) are not part of this artifact — they belong to the downstream steward-review / award-decision spec, which references this artifact by `id`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A proposer with an active `NeedIntent` can find at least one eligible open round within 30 seconds of opening the rounds page (assumes ≥1 mandate-matching open round exists in seed data).
- **SC-002**: A round detail page renders mandate, budget, milestones template, and prior stats within 2 seconds at the 95th percentile under typical hub load (single-digit hundreds of rounds, single-digit thousands of proposals).
- **SC-003**: 0% of private rounds leak into public browse for non-addressed applicants, verified by automated test against seeded private rounds.
- **SC-004**: A proposal draft → submission round-trip completes in fewer than 8 minutes for a prepared proposer with all materials ready (measured from "open submit form" to "confirmation visible").
- **SC-005**: A Grant Proposal artifact produced by this feature is consumed without further transformation by the downstream review/award workflow — i.e., the artifact contains every field the review spec needs.
- **SC-006**: For seeded round/proposer pairs that experts agree are good fits, the expert-preferred fund appears in the top 3 of the proposer's ranked rounds list at least 70% of the time.
- **SC-007**: For seeded steward/proposal pairs, the steward-preferred proposal appears in the top 3 of the steward's ranked proposals list at least 70% of the time.
- **SC-008**: Proposers report (qualitative review) that the round detail page makes the effort/likelihood tradeoff legible — "I understand whether this round is worth my time" — for at least 8 of 10 sampled rounds.

## Assumptions

- **Hub-scope is the default**, cross-hub round/proposal discovery is deferred (matches spec 001 Q2).
- **Connector / on-behalf-of proposing** is out of scope for v1.
- **The `NeedIntent` referenced by a proposal already exists** (from the current intent layer / spec 001's foundation); this spec consumes but does not author intents.
- **Ranking signals** reuse the spec 001 composite verbatim; the side-specific signal definitions in Clarifications Q1/Q2 specialise *what counts as fulfilled/abandoned* without changing the formula.
- **Fund-as-agent**: funds are first-class agents in the existing relationship graph (per the Pool-as-agent pattern from spec 002), with `mandate`, `acceptsOpenCalls`, and stewardship-agent fields.
- **Round shape**: a Round is an existing or thin new entity with the fields enumerated in Key Entities; if not yet present, this spec implies its creation by the implementing developer. The exact storage model is implementation, not spec, concern.
- **Pre-deadline edits version the artifact**; post-deadline edits are gated to the steward-review spec.
- **Open-call submissions** are accepted only when the target fund has `acceptsOpenCalls = true`; round-bound submissions are always accepted (subject to validation).
- **Existing UI routes** are extended in place under `apps/web/src/app/h/[hubId]/(hub)/rounds/` and `apps/web/src/app/h/[hubId]/(hub)/proposals/` rather than replaced.

## Dependencies

- Existing `NeedIntent` entity and lifecycle from spec 001 / the current intent layer.
- Existing `AgentRelationship` graph (used for trust-proximity to fund agents and proposer agents).
- Existing visibility / addressed-membership gates (used to enforce private-round privacy).
- Existing hub membership and `addressedTo` semantics.
- Existing credential infrastructure (used for `requiredCredentials` enforcement).
- Spec 001's ranking formula (reused; see FR-016/017).
- Spec 002's Pool-as-agent pattern (Fund-as-agent applies the same pattern).
- Downstream **steward-review / award-decision spec** (consumes the Grant Proposal artifact). This feature defines the artifact's contract; the review spec consumes it.
- Downstream **milestone-validation / outcome-reporting spec** (operates on awarded proposals).

## Out of Scope (handed to other specs)

- Steward review process: assigning reviewers, scoring, deliberation, decision.
- Award decision: who is funded, at what amount, with what conditions or tranches.
- Tranche release: gating disbursement on milestone completion.
- Outcome validation: validators marking outcomes as fulfilled/partial/abandoned.
- Trust-graph mutation triggered by validated outcomes.
- Post-deadline proposal edits (require steward consent; downstream).
- Multi-year renewal flows: re-applying for year 2/3 of a multi-year award.
- Connector / on-behalf-of proposing.
- Cross-hub round/proposal discovery.
- Round creation / fund mandate authoring (handled by separate fund-admin specs).
