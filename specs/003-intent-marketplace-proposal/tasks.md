# Tasks: Intent Marketplace — Proposal Lane (Discovery & Submission)

**Input**: Design documents from `/specs/003-intent-marketplace-proposal/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: NOT requested. No test tasks generated. Validate via the quickstart walkthrough.

**Organization**: Tasks are grouped by user story. Spec 003 reuses spec 001's foundational ranking module and the `intent:bump_ack_count` system-delegation scope. The Round entity references `sa:Fund subClassOf sa:Pool` typing established by spec 002.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on earlier in-phase incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US5)
- File paths in every task are absolute / repo-relative

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm canonical inputs and prep two new route trees (`rounds/` and `proposals/`).

- [ ] T001 Verify `docs/ontology/tbox/proposal.ttl` declares `sa:Round subClassOf prov:Plan, p-plan:Plan`; `sa:RoundOpenedAssertion`, `sa:RoundClosedAssertion`; `sa:GrantProposal` (renamed from `ProposalSubmission` per Audit § 2 O1); plus the proposal predicates (`sa:proposer`, `sa:targetRound`, `sa:fundMandate`, `sa:basedOnIntent`, `sa:budget`, `sa:plan`, `sa:milestones`, `sa:desiredOutcomes`, `sa:reportingObligations`, `sa:organisationalBackground`, `sa:proposalSubmittedAt`, `sa:version`, `sa:lastEditedAt`, `sa:proposalStatus`, `sa:withdrawnAt`, `sa:clonedFromProposal`) and the round predicates (`sa:operatedByFund`, `sa:roundMandate`, `sa:milestoneTemplate`, `sa:validatorRequirements`, `sa:reportingCadence`, `sa:deadline`, `sa:decisionDate`, `sa:requiredCredentials`, `sa:addressedApplicants`, `sa:proposalsReceived`) per Audit § 1.1.
- [ ] T002 [P] Verify `docs/ontology/cbox/controlled-vocabularies.ttl` declares `sa:GrantProposalStatus` and `sa:ReportingCadence` SKOS schemes.
- [ ] T003 [P] Verify `docs/ontology/tbox/shacl/visibility.ttl` declares `sa:GrantProposalAlwaysPrivateShape` (Audit § 5).
- [ ] T004 Confirm `@smart-agent/sdk/matchmaker/ranking` is published (foundational dependency from spec 001 Phase 2). If not, this spec is blocked.
- [ ] T005 [P] Confirm `sa:Fund subClassOf sa:Pool` typing and the `sa:acceptsOpenCalls` predicate are in place (foundational dependency from spec 002). If not, this spec is blocked on the round → fund linkage.
- [ ] T006 Create the route tree skeleton under `apps/web/src/app/h/[hubId]/(hub)/rounds/` (page.tsx, [roundId]/page.tsx, [roundId]/apply/page.tsx, [roundId]/(steward)/proposals/page.tsx) — empty server components that compile.
- [ ] T007 [P] Create the route tree skeleton under `apps/web/src/app/h/[hubId]/(hub)/proposals/` (page.tsx, [proposalId]/page.tsx) — empty server components that compile.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema for proposals + rounds, delegation scopes, on-chain emit helper for round assertions, sync wiring. Reuses spec 001's matchmaker module + `intent:bump_ack_count` scope; reuses spec 002's `sa:Fund` typing and `acceptsOpenCalls` predicate.

**CRITICAL — Cross-spec dependencies**:
- Spec 001's Phase 2 must be complete: `@smart-agent/sdk/matchmaker/ranking` is published; the `intent:bump_ack_count` system-delegation scope exists in both person-mcp and org-mcp delegation catalogs (spec 003 issues this scope on submit and withdraw).
- Spec 002's Phase 2 must be complete: `sa:Fund subClassOf sa:Pool` is wired; `sa:acceptsOpenCalls` is mintable on pool-agent metadata (spec 003 reads this for FR-014 / Q5).

### MCP table migrations

- [ ] T008 Add `proposal_submissions` table migration to `apps/org-mcp/src/db/schema.ts` with columns `id` (IRI PK), `principal` (NOT NULL, = proposerAgentId; usually `org_principal`), `roundId` (IRI nullable), `fundMandateId` (IRI nullable; required when `roundId` null), `basedOnIntentId` (IRI), `budget` (json), `plan` (json), `milestones` (json), `desiredOutcomes` (json), `reportingObligations` (json), `organisationalBackground` (json), `submittedAt` (timestamp), `version` (integer), `lastEditedAt` (timestamp), `status` (enum 'draft'|'submitted'|'withdrawn'|'awarded'|'declined'), `withdrawnAt` (timestamp nullable), `clonedFromProposalId` (IRI nullable), `basis` (json — `RankBasis` snapshot), `visibility` (always `'private'`), `createdAt` — per IA § 2.3.
- [ ] T009 [P] Add identical `proposal_submissions` table migration to `apps/person-mcp/src/db/schema.ts` for solo human applicants.
- [ ] T010 Add `rounds` table migration to `apps/org-mcp/src/db/schema.ts` with columns `id` (IRI PK), `org_principal` (NOT NULL, = fundAgentId), `mandate` (json), `milestoneTemplate` (json), `validatorRequirements` (json), `reportingCadence` (enum 'quarterly'|'milestone'|'annual'|'none'), `deadline` (timestamp), `decisionDate` (timestamp), `requiredCredentials` (string[]), `visibility` (enum 'public'|'private'), `addressedApplicants` (string[] nullable), `proposalsReceived` (integer), `onChainAssertionId` (IRI), `createdAt`, `updatedAt` — per IA § 2.4. Round authoring is out of scope for this spec, but the schema is the canonical home for pre-seeded rounds.

### Delegation scope registration

- [ ] T011 Register `grant_proposal:draft`, `grant_proposal:submit`, `grant_proposal:edit_pre_deadline`, `grant_proposal:withdraw`, `grant_proposal:clone`, `grant_proposal:read_self` (proposer-only) scopes in `apps/org-mcp/src/delegations/` per the `grant-proposal.ts` contract.
- [ ] T012 [P] Register the same six scopes in `apps/person-mcp/src/delegations/` for solo human applicants.
- [ ] T013 Register `proposal:read_for_review` cross-delegation scope (issued by proposer at submit time; scope: one round or one fund-mandate; readable by stewards until proposal hits a terminal state) in both `apps/org-mcp/src/delegations/` and `apps/person-mcp/src/delegations/`.
- [ ] T014 Register `round:increment_proposals_received` system-delegation scope in `apps/org-mcp/src/delegations/` (proposer's MCP issues to fund's org-mcp on submit/withdraw) and matching scope in `apps/person-mcp/src/delegations/`.
- [ ] T015 [P] Register `round:read_addressed_list` cross-delegation scope (issued by fund's stewards at round creation; scope: one round) in `apps/org-mcp/src/delegations/`.
- [ ] T016 Confirm the `intent:bump_ack_count` system-delegation scope (foundational from spec 001) is available in both `apps/org-mcp/src/delegations/` and `apps/person-mcp/src/delegations/` for spec 003 submit/withdraw use; if missing, escalate as a spec 001 dependency violation.

### On-chain assertion wiring

- [ ] T017 Create `apps/web/src/lib/onchain/roundAssertion.ts` with emit helpers `emitRoundOpenedAssertion(round)` (full for public rounds; coarse — no `addressedApplicants` — for private rounds) and `emitRoundClosedAssertion(roundId)`. Round authoring is out of scope, but the helper exists for the round-creation spec to reuse and for the `proposalsReceived` counter sync where applicable.
- [ ] T018 Extend the on-chain → GraphDB sync at `apps/web/src/lib/ontology/sync.ts` to index `sa:RoundOpenedAssertion` and `sa:RoundClosedAssertion` triples; if class-agnostic, no change; otherwise add the classes to the allow-list. **No** `sa:GrantProposal` sync ever — SHACL `sa:GrantProposalAlwaysPrivateShape` enforces.

### On-chain assertion class confirmation

- [ ] T019 Confirm `sa:RoundOpenedAssertion` and `sa:RoundClosedAssertion` classes are wired into the existing `AgentAssertion` contract path used by `emitOnChainAssertion` — no new ABI required (per IA § 3.7); document this fact in the emit helper's header comment. **Confirm** no on-chain emit helper exists for `sa:GrantProposal` (FR-013, Audit § 1.1, IA § 2.3 — proposals never anchor in v1).

### Discovery service surface (rounds only — proposals never reach GraphDB)

- [ ] T020 Add `Round`, `RoundListItem`, `RoundMandate`, `RoundMilestoneTemplate`, `RoundValidatorRequirements`, `ReportingCadence`, `RoundPriorStats`, `RoundListFilters` types to `packages/discovery/src/types.ts` per the `round.ts` contract. **Do not** add `GrantProposal` types to discovery — proposals are read via proposer MCPs only (IA P5).
- [ ] T021 Add `packages/discovery/src/queries/rounds.ts` with SPARQL for `listRounds(filters, viewerIntents)` and `getRoundDetail(id)` reading public round mirrors from GraphDB; mandate-match badging joins viewer's intents to round mandates per FR-001 / Research R2.
- [ ] T022 [P] Add `packages/discovery/src/queries/fundMandate.ts` reading `sa:Fund` mandate fields + `sa:acceptsOpenCalls` from the public agent metadata (used by Q5 / FR-014 open-call eligibility checks).
- [ ] T023 [P] Add `packages/discovery/src/queries/priorStats.ts` returning fund/proposer prior outcomes by domain (read-only here; populated as the downstream award spec ships) — supports the FR-016/FR-017 outcome signals.
- [ ] T024 Add `listRounds(filters)` and `getRoundDetail(roundId, viewerAgentId)` methods to `packages/discovery/src/DiscoveryService.ts` returning `RoundListItem[]` / `Round | null`.

**Checkpoint**: `proposal_submissions` schema lives in both MCPs; `rounds` table lives in org-mcp; delegation scopes registered; round-side on-chain emit + sync wired; **no** proposal-side on-chain path. Spec 002's `sa:Fund` typing and `sa:acceptsOpenCalls` are confirmed available; spec 001's `intent:bump_ack_count` scope is confirmed available.

---

## Phase 3: User Story 1 — Browse open rounds eligible for your intent (Priority: P1) MVP

**Goal**: A proposer browses open rounds with mandate-match badges against their `NeedIntent`s; filters by domain, deadline horizon, budget range, and free-text; private rounds hidden from non-addressed viewers.

**Independent Test**: Seed a hub with ≥4 open rounds across ≥2 fund domains with different deadlines and budget ceilings; verify a proposer can see eligible rounds with match badges, filter, and read each round's metadata.

### Implementation for User Story 1

- [ ] T025 [US1] Extend `packages/discovery/src/queries/rounds.ts` with filter SPARQL covering domain, deadline horizon (this-week/this-month/this-quarter/all), budget range, free-text across mandate / fund name / description, and an `includeClosed` toggle — implements FR-001, FR-002. Apply the visibility + addressed-applicants gate for FR-003.
- [ ] T026 [US1] Create `packages/sdk/src/rounds/types.ts` re-exporting `Round`, `RoundMandate`, `RoundMilestoneTemplate`, `RoundValidatorRequirements`, `ReportingCadence`, `RoundPriorStats`, `RoundListFilters`, `RoundListItem` from the `round.ts` contract.
- [ ] T027 [US1] Create `packages/sdk/src/rounds/client.ts` implementing `RoundClient.list(filters)` — reads public mirror via `@smart-agent/discovery`; private-round addressee list reads from fund's org-mcp via the `round:read_addressed_list` cross-delegation.
- [ ] T028 [US1] Create `packages/sdk/src/rounds/index.ts` re-exporting; update `packages/sdk/src/index.ts`.
- [ ] T029 [US1] Add `RoundFilters.tsx` client component to `apps/web/src/app/h/[hubId]/(hub)/rounds/(components)/RoundFilters.tsx` rendering domain / deadline horizon / budget range / free-text / `includeClosed` toggle (FR-002).
- [ ] T030 [US1] Add `RoundCard.tsx` server component to `apps/web/src/app/h/[hubId]/(hub)/rounds/(components)/RoundCard.tsx` with the mandate-match badge ("✓ matches your trauma-care intent · deadline 14d · budget ceiling $250k") and soft warnings (`budget-below-intent`, `deadline-imminent`) per FR-001 + Research R2.
- [ ] T031 [US1] Add `EmptyState.tsx` to `apps/web/src/app/h/[hubId]/(hub)/rounds/(components)/EmptyState.tsx` per FR-004.
- [ ] T032 [US1] Implement `apps/web/src/app/h/[hubId]/(hub)/rounds/page.tsx` (server) consuming `RoundClient.list` with `viewerIntentIds` for badging, rendering `RoundFilters` + `RoundCard[]` + `EmptyState`.

**Checkpoint**: US1 fully functional and testable — round browse with match badges and filters works end-to-end.

---

## Phase 4: User Story 2 — View round detail (Priority: P1)

**Goal**: A round detail page exposes mandate, eligibility (with credential ownership inline), budget envelope, milestone template, validator requirements, reporting cadence, deadline, decision date, and prior-round stats.

**Independent Test**: Open a seeded round detail page; verify all five blocks render with their values; private rounds gate to addressed applicants.

### Implementation for User Story 2

- [ ] T033 [US2] Add `getById(roundId, viewerAgentId)` to `packages/sdk/src/rounds/client.ts` — public-tier reads from GraphDB mirror; private-round addressee list reads from fund's org-mcp (FR-006).
- [ ] T034 [US2] Add `EligibilityBlock.tsx` server component to `apps/web/src/app/h/[hubId]/(hub)/rounds/(components)/EligibilityBlock.tsx` rendering geo / organisational requirements / required credentials with the viewer's credential ownership shown inline ("✓ VerifiedHuman" / "✗ VerifiedOrg — obtain via …") per FR-007 — uses the existing AnonCreds verifier (Research R4).
- [ ] T035 [US2] Add `PriorStatsBlock.tsx` server component to `apps/web/src/app/h/[hubId]/(hub)/rounds/(components)/PriorStatsBlock.tsx` rendering proposals received / awards made / median award size; explicit empty state on first-cycle rounds per Spec Story 2 AC#3.
- [ ] T036 [US2] Implement `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/page.tsx` (server) composing mandate, `EligibilityBlock`, budget envelope, milestone template, validator requirements, reporting cadence, deadline + decision date, and `PriorStatsBlock` — implements FR-005. Gate private round detail to addressed applicants.

**Checkpoint**: US2 fully functional and testable — round detail renders all blocks with credential ownership inline.

---

## Phase 5: User Story 3 — Draft & submit a Proposal artifact (Priority: P1)

**Goal**: A proposer composes and submits a Grant Proposal; the artifact is consumed by the downstream review/award spec; the round counter increments; the underlying intent transitions to `acknowledged`.

**Independent Test**: From a round detail, draft a complete proposal, submit, and verify the artifact, the counter increment, the intent transition, and the proposer's "your proposals" listing.

### Implementation for User Story 3

- [ ] T037 [US3] Add the `grant_proposal:submit` MCP tool in `apps/org-mcp/src/tools/grantProposals.ts` that: validates the draft against `round.milestoneTemplate` and `round.validatorRequirements`, budget total `<= round.mandate.budgetCeiling`, viewer holds all `round.requiredCredentials` (FR-009/FR-011), private-round addressee membership (FR-012), open-call eligibility against `fund.mandate` when `roundId === null` and `fund.acceptsOpenCalls === true` (FR-014/Q5), exclusivity of `roundId` vs `fundMandateId` (Q3). Inserts the row with `version: 0` and `status: 'submitted'`, captures `basis` from `proposerSideSignals`. Issues `round:increment_proposals_received` system-delegation to the fund's org-mcp (FR-013), issues `intent:bump_ack_count` (delta +1) system-delegation to the `basedOnIntent` owner's MCP (IA § 3.10; reuses spec 001's foundational scope), and issues `proposal:read_for_review` cross-delegation to the round's stewards. Implements FR-008, FR-013.
- [ ] T038 [P] [US3] Add the same `grant_proposal:submit` tool in `apps/person-mcp/src/tools/grantProposals.ts` for solo human applicants.
- [ ] T039 [US3] Add `grant_proposal:draft` (proposer-only; allows in-progress edits to a draft row) and `grant_proposal:read_self` tools in `apps/org-mcp/src/tools/grantProposals.ts` and the person-mcp twin.
- [ ] T040 [US3] Add `apps/org-mcp/src/tools/rounds.ts` with read tools for the round body (read by the proposer's MCP at submit-time validation) and the `round:increment_proposals_received` / decrement system-delegation handler that bumps `sa:proposalsReceived` on the fund's org-mcp tenant.
- [ ] T041 [US3] Create `packages/sdk/src/grantProposals/types.ts` exporting `GrantProposal`, `GrantProposalStatus`, `Budget`, `BudgetLineItem`, `Milestone`, `DesiredOutcome`, `ReportingObligations`, `OrganisationalBackground`, `SubmitGrantProposalRequest`, `EditGrantProposalRequest`, `SubmitGrantProposalError`, `SubmitGrantProposalResult`, `WithdrawGrantProposalResult` per the `grant-proposal.ts` contract.
- [ ] T042 [US3] Create `packages/sdk/src/grantProposals/client.ts` implementing `GrantProposalClient.submit` per the contract — routes through the proposer's MCP, surfaces `SubmitGrantProposalError` shapes (`missing-required-fields`, `budget-overage`, `missing-credential`, `open-call-not-accepted`, `private-round-not-addressed`).
- [ ] T043 [P] [US3] Create `packages/sdk/src/grantProposals/index.ts` re-exporting; update `packages/sdk/src/index.ts`.
- [ ] T044 [US3] Create `packages/sdk/src/matchmaker/side-signals.ts` implementing `proposerSideSignals(input)` per the `matchmaker-side-signals.ts` contract (proposer-side: hops to fund agent + fund's prior outcomes filtered by proposer's intent domains, fallback to fund-wide). Returns a `RankBasis` consumable by spec 001's `rankCandidates`.
- [ ] T045 [US3] Add `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/apply/page.tsx` rendering the multi-step proposal composer (budget line items, plan narrative, milestones with `dueDate` / `evidenceRequired` / `trancheAmount`, desired outcomes with validators, reporting cadence + format, organisational background).
- [ ] T046 [US3] Add `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/apply/route.ts` server submit handler that calls `GrantProposalClient.submit`, computes `proposerSideSignals` for the `basis` snapshot, surfaces error shapes, and returns confirmation with the steward `decisionDate`.

**Checkpoint**: US3 fully functional and testable — proposal composer round-trips MCP write → counter increment → `liveAcknowledgementCount` increment → cross-delegation issuance, with no on-chain or GraphDB writes.

---

## Phase 6: User Story 4 — Two-sided ranking (Priority: P2)

**Goal**: For proposers, eligible rounds rank by proximity to fund agent + fund's prior outcomes in the proposer's intent domain. For stewards, incoming proposals on a round rank by proximity from fund to proposer + proposer's prior fulfilled/abandoned ratio. Both sides expose a "why this rank" cue.

**Independent Test (proposer side)**: Two same-mandate rounds at distances 1 and 4 with prior-outcome scores 0.9 and 0.4 in the proposer's domain — verify the closer + better-domain-record fund's round ranks first. **Independent Test (steward side)**: Two proposals on a round from proposers at distances 1 and 4 with prior fulfilled ratios 0.85 and 0.45 — verify the closer + better-record proposer ranks first.

### Implementation for User Story 4

- [ ] T047 [US4] Implement `stewardSideSignals(input)` in `packages/sdk/src/matchmaker/side-signals.ts` per the contract: hops from fund to proposer + proposer's prior fulfilled/abandoned ratio (Laplace-smoothed by the shared ranking function). Reuses `getProximityHops` and `getPriorOutcomes` from `packages/discovery/src/DiscoveryService.ts`.
- [ ] T048 [US4] Add a fund-domain-filtered prior-outcome helper in `packages/discovery/src/queries/priorStats.ts` returning `(fulfilled, abandoned)` for a fund restricted to a given intent-domain set (per Q1 / Research R6 — falls back to fund-wide outcomes when no domain match).
- [ ] T049 [US4] Compose ranked rounds server-side in `apps/web/src/app/h/[hubId]/(hub)/rounds/page.tsx`: hydrate `Candidate[]`-shaped tuples per round via `proposerSideSignals` and feed to `rankCandidates` from `@smart-agent/sdk/matchmaker`. Tie-break on `round.deadline` desc per FR-019 / Research R10. Implements FR-016, FR-018.
- [ ] T050 [US4] Extend `RoundCard.tsx` in `apps/web/src/app/h/[hubId]/(hub)/rounds/(components)/RoundCard.tsx` to render the rank cue ("1 hop · 9 fulfilled / 1 abandoned in trauma-care" or "no prior history yet") with an expand affordance per FR-018.
- [ ] T051 [US4] Implement `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/(steward)/proposals/page.tsx` (server, steward-side): federate reads across each submitting proposer's MCP using each proposer's `proposal:read_for_review` cross-delegation (no GraphDB read — IA P5), compute `stewardSideSignals` per proposal, feed to `rankCandidates`, tie-break on `submittedAt` desc per FR-019. Implements FR-017, FR-018.
- [ ] T052 [US4] Add `listForRound(roundId, stewardAgentId)` method to `packages/sdk/src/grantProposals/client.ts` per the contract — federation logic lives in the action-layer route, the client just exposes the entry point.

**Checkpoint**: US4 fully functional and testable — proposer-side and steward-side ranks both deterministic with rank cues.

---

## Phase 7: User Story 5 — Manage your draft & submitted proposals (Priority: P2)

**Goal**: A "your proposals" view lists drafts / submitted / withdrawn / decided proposals; proposers can resume editing a draft, edit a submitted-but-pre-deadline proposal (versioned), withdraw a submitted proposal, or clone any proposal as a fresh draft.

**Independent Test**: From "your proposals", resume editing a draft, edit a pre-deadline submitted proposal and verify the version bump, withdraw a submitted proposal and verify the intent reversion logic (only when no other live acknowledgements), clone an existing proposal and verify outcomes/awards do not carry across.

### Implementation for User Story 5

- [ ] T053 [US5] Add the `grant_proposal:edit_pre_deadline` MCP tool in `apps/org-mcp/src/tools/grantProposals.ts` and the person-mcp twin: validates `now <= round.deadline` against the round body in fund's org-mcp (Research R5), bumps `sa:version`, updates `sa:lastEditedAt`, mutates the patch fields (FR-021). Returns 403 with "post-deadline edits require steward consent" past the deadline (FR-022).
- [ ] T054 [US5] Add the `grant_proposal:withdraw` MCP tool in `apps/org-mcp/src/tools/grantProposals.ts` and the person-mcp twin: transitions `status` to `withdrawn`, sets `withdrawnAt`, issues `round:increment_proposals_received` decrement to fund's org-mcp, and issues `intent:bump_ack_count` (delta -1) system-delegation to the basedOnIntent owner's MCP (IA § 3.10). **Cross-spec touch-point**: the intent owner's MCP transitions `acknowledged → expressed` only when `liveAcknowledgementCount` returns to 0 — meaning if a still-pending spec 001 `MatchInitiation` exists on the same intent, the intent stays `acknowledged`. Returns `WithdrawGrantProposalResult.intentRevertedToExpressed: true | false` reflecting the count-hit-zero check (FR-023, Research R7).
- [ ] T055 [US5] Add the `grant_proposal:clone` MCP tool in `apps/org-mcp/src/tools/grantProposals.ts` and the person-mcp twin: creates a new row with fresh `id`, `version: 0`, `status: 'draft'`, `submittedAt` unset, `clonedFromProposalId` set; copies all non-state fields; outcomes / awards / review state NOT copied (Q3 / Research R8). Implements FR-024, FR-025.
- [ ] T056 [US5] Add `grant_proposal:list_for_member(agentId)` tool in `apps/org-mcp/src/tools/grantProposals.ts` and the person-mcp twin returning all the proposer's drafts / submitted / withdrawn / decided proposals (FR-020).
- [ ] T057 [US5] Add `edit`, `withdraw`, `clone`, `getById`, `listForMember` methods to `packages/sdk/src/grantProposals/client.ts` per the `GrantProposalClient` interface in the contract.
- [ ] T058 [US5] Implement `apps/web/src/app/h/[hubId]/(hub)/proposals/page.tsx` (server) listing the viewer's proposals grouped by state with the appropriate action affordance per state (resume / edit-pre-deadline / view-only / view-only / view-decision) per FR-020.
- [ ] T059 [US5] Implement `apps/web/src/app/h/[hubId]/(hub)/proposals/[proposalId]/page.tsx` showing one proposal with state-aware actions; mounts the appropriate edit form for `draft` and pre-deadline `submitted`, read-only for post-deadline submitted / withdrawn / decided per FR-022.
- [ ] T060 [US5] Add server route `apps/web/src/app/h/[hubId]/(hub)/proposals/[proposalId]/edit/route.ts` calling `GrantProposalClient.edit`.
- [ ] T061 [US5] Add server route `apps/web/src/app/h/[hubId]/(hub)/proposals/[proposalId]/withdraw/route.ts` calling `GrantProposalClient.withdraw` and surfacing `WithdrawGrantProposalResult.intentRevertedToExpressed` to the user — the cross-spec touch-point with spec 001's `MatchInitiation` count means the message must be conditional ("intent reverted to `expressed`" vs "intent remains `acknowledged` because another live acknowledgement exists").
- [ ] T062 [US5] Add server route `apps/web/src/app/h/[hubId]/(hub)/proposals/[proposalId]/clone/route.ts` calling `GrantProposalClient.clone` and redirecting to the new draft for re-targeting.

**Checkpoint**: US5 fully functional and testable — manage flows (resume / edit-pre-deadline / withdraw / clone) work end-to-end with the cross-spec intent-reversion logic correct.

---

## Phase N: Polish & Cross-Cutting Concerns

- [ ] T063 Run SHACL validation against the GraphDB ontology graph for `sa:GrantProposalAlwaysPrivateShape` (uploaded with spec 001 T021); verify no `sa:GrantProposal` instances ever appear in GraphDB on seed data — should be zero.
- [ ] T064 Walk through `specs/003-intent-marketplace-proposal/quickstart.md` end-to-end against the seeded demo hub; confirm Flow A (proposer: A1–A7) and Flow B (steward) behave as documented; specifically verify the cross-spec intent-reversion correctness in A5.
- [ ] T065 [P] Run `pnpm lint` and `pnpm typecheck` across the monorepo; fix any new violations introduced by spec 003.
- [ ] T066 Run `./scripts/fresh-start.sh` to verify the new `proposal_submissions` and `rounds` tables are picked up by the canonical reset; confirm the demo seed includes pre-seeded rounds for the quickstart flow.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup AND on **spec 001's Phase 2** (matchmaker module + `intent:bump_ack_count` scope) AND **spec 002's Phase 2** (`sa:Fund subClassOf sa:Pool` typing + `sa:acceptsOpenCalls` predicate on pool agent metadata).
- **User Stories (Phase 3+)**: Depend on Foundational completion.

### Cross-Spec Dependencies (BLOCKED BY)

- **Spec 003 is BLOCKED BY** spec 001's Phase 2: shared `@smart-agent/sdk/matchmaker/ranking` module + `intent:bump_ack_count` system-delegation scope (T037 issues +1 on submit; T054 issues -1 on withdraw — IA § 3.10).
- **Spec 003 is BLOCKED BY** spec 002's Phase 2: `sa:Fund subClassOf sa:Pool` typing (Round.fundAgentId references a Fund — Audit § 4 F2) and the `sa:acceptsOpenCalls` predicate on pool-agent metadata (FR-014 / Q5 / Research R9).
- **Spec 003 is BLOCKED BY** spec 001's T021 SHACL upload: spec 003's `sa:GrantProposalAlwaysPrivateShape` ships as part of the same `docs/ontology/tbox/shacl/visibility.ttl` upload.

### Cross-Spec Touch-Points (Reciprocal Notes)

- US5 / T054 (`grant_proposal:withdraw`) **cross-references spec 001's `MatchInitiation` count** for the FR-023 outcome flag `intentRevertedToExpressed: true | false`. The reverse touch-point is documented in spec 001's tasks.md "Cross-Spec Dependencies" section (T037 increments the same `liveAcknowledgementCount` column that spec 003's withdraw decrements). The shared `intent:bump_ack_count` scope is the single integration surface — no fan-out queries.
- T020's "do NOT add `GrantProposal` types to discovery" is reciprocal to spec 002's discovery surface — both downstream specs intentionally keep proposal bodies out of GraphDB (IA P5 / IA § 2.3).

### User Story Dependencies

- **US1 (P1)**: After Foundational. Independent.
- **US2 (P1)**: After Foundational. Builds on US1's `RoundClient` (extends with `getById`).
- **US3 (P1)**: After Foundational. Reads round data from US2's surface; the heaviest write story.
- **US4 (P2)**: After Foundational + US3 (steward-side reads from proposals submitted in US3).
- **US5 (P2)**: After Foundational + US3 (manage operates on rows produced by US3's submit).

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel.
- Foundational schema for org-mcp and person-mcp run in parallel (T008 || T009). Delegation registrations marked [P] are parallel across the two MCP catalogs. Discovery query files (T021, T022, T023) are parallel.
- Within US3: org-mcp tool work (T037) is parallel with person-mcp tool work (T038); SDK index re-export (T043) is parallel with the side-signals helper (T044).
- Within US5: server routes (T060, T061, T062) are parallel — different files.

---

## Parallel Example: User Story 3 Dual-MCP Tooling + SDK

```bash
# Run in parallel — different files / packages:
Task: "Add grant_proposal:submit MCP tool in apps/org-mcp/src/tools/grantProposals.ts"
Task: "Add grant_proposal:submit MCP tool in apps/person-mcp/src/tools/grantProposals.ts"
Task: "Create packages/sdk/src/grantProposals/index.ts and update sdk index"
Task: "Create packages/sdk/src/matchmaker/side-signals.ts implementing proposerSideSignals"
```

---

## Implementation Strategy

### MVP scope (User Story 1 only)

1. Setup + Foundational.
2. US1 (browse rounds with mandate-match badges).
3. **STOP and VALIDATE**: round browse + match badging work against seed data.
4. Demo and proceed.

### Recommended incremental order

1. Setup + Foundational (after specs 001 + 002 land).
2. US1 → MVP (browse rounds).
3. US2 → round detail surface.
4. US3 → proposal composer (closes the BDI loop).
5. US5 → manage flows (depends on US3's submit producing rows).
6. US4 → two-sided ranking (depends on US3 for the steward side).
7. Polish.

### Parallel team strategy

After Foundational lands:
- Developer A: US1 + US2 + US4 proposer side (read surfaces + proposer-side rank).
- Developer B: US3 (proposal composer + submit pipeline).
- Developer C: US5 + US4 steward side (manage flows + steward federation).

---

## Notes

- Spec 003's `GrantProposal` body NEVER anchors on chain in v1 — SHACL `sa:GrantProposalAlwaysPrivateShape` enforces. Reviewer must reject any PR that adds a proposal-side `emitOnChainAssertion` call.
- Steward views federate across proposer MCPs via `proposal:read_for_review` cross-delegations issued at submit time — never via a GraphDB join (IA P5).
- The class rename `ProposalSubmission → GrantProposal` (Audit § 2 O1) is propagated across spec text, plan, data-model, research, contracts, and TS types — there is no `ProposalSubmission` type to write.
- Round authoring (creating new rounds) is OUT of scope for this spec; T010 is the canonical schema home for pre-seeded rounds; T017 is a helper available for the future round-creation spec.
- The `liveAcknowledgementCount` primitive is shared with spec 001 — withdrawing a proposal correctly returns the intent to `expressed` ONLY when no other live acknowledgements exist (e.g., a still-pending spec 001 MatchInitiation keeps the intent at `acknowledged`).
- No test tasks generated — validate via `quickstart.md`.
