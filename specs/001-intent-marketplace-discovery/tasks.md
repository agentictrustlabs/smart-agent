# Tasks: Intent Marketplace — Discovery & Match (Direct / Relationship Lane)

**Input**: Design documents from `/specs/001-intent-marketplace-discovery/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: NOT requested. No test tasks generated. Validate via the quickstart walkthrough.

**Organization**: Tasks are grouped by user story. Spec 001 pioneers the persistence + ranking patterns reused by specs 002 and 003.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on earlier in-phase incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US5)
- File paths in every task are absolute / repo-relative

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the canonical inputs are landed and prep the route tree.

- [ ] T001 Verify T-Box edits are present at `docs/ontology/tbox/matches.ttl` (covers `sa:MatchInitiation`, `sa:MatchInitiationAssertion`, `sa:initiator`, `sa:viewedIntent`, `sa:candidateIntent`, `sa:initiationKind`, `sa:proposedAt`, `sa:basis`, `sa:status`, `sa:visibility`, `sa:onChainAssertionId`) per Audit § 1.1.
- [ ] T002 [P] Verify `docs/ontology/tbox/intents.ttl` carries `saint:visibility` (Audit § 4 F1) — required by the cascade rule.
- [ ] T003 [P] Verify `docs/ontology/cbox/controlled-vocabularies.ttl` declares `sa:MatchInitiationKind` and `sa:MatchInitiationStatus` SKOS schemes (Audit § 1.1).
- [ ] T004 [P] Verify `docs/ontology/tbox/shacl/visibility.ttl` declares `sa:PrivateIntentInitiationNoAnchorShape` and `sa:MatchInitiationOppositeDirectionsShape` (Audit § 5).
- [ ] T005 Confirm the existing route tree under `apps/web/src/app/h/[hubId]/(hub)/intents/` (page.tsx, [id]/page.tsx, [id]/new) compiles cleanly before extension.
- [ ] T006 [P] Add empty `apps/web/src/app/h/[hubId]/(hub)/intents/(components)/` directory and ensure it compiles as part of the existing route group.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, delegation scopes, on-chain emit helper, sync wiring, SDK ranking module — everything specs 002/003 will reuse. No US work begins until this phase is green.

**CRITICAL**: This phase publishes the shared `@smart-agent/sdk/matchmaker/ranking` module and the `intent:bump_ack_count` system-delegation scope used by specs 001 and 003.

### MCP table migrations

- [ ] T007 Add `match_initiations` table migration to `apps/person-mcp/src/db/schema.ts` with columns `id` (IRI PK), `principal` (NOT NULL, = initiator agent id), `viewedIntentId` (IRI), `candidateIntentId` (IRI), `initiatorAgentId` (IRI; redundant mirror of `principal`), `initiationKind` (enum 'self'|'connector'), `proposedAt` (timestamp), `basis` (json), `status` (enum 'pending'|'superseded'|'consumed'), `visibility` (enum 'public'|'public-coarse'|'private'|'off-chain'), `onChainAssertionId` (IRI nullable), `createdAt`, `updatedAt` — per IA § 2.1 body layout.
- [ ] T008 [P] Add identical `match_initiations` table migration to `apps/org-mcp/src/db/schema.ts` (org-mcp twin; tenant-keyed by `org_principal = initiatorAgentId`) — per IA § 2.1.
- [ ] T009 Add `liveAcknowledgementCount: integer` column (default 0) to the existing `intents` table in `apps/person-mcp/src/db/schema.ts` — per IA § 3.10 / Audit § 2 O5 (implementation-only; not codified in T-Box).
- [ ] T010 [P] Add the same `liveAcknowledgementCount` column to the existing `intents` table in `apps/org-mcp/src/db/schema.ts`.

### Delegation scope registration

- [ ] T011 Register `match_initiation:create` delegation scope in `apps/person-mcp/src/delegations/` catalog (write; owner's session OR explicit delegation) per match-initiation.ts contract.
- [ ] T012 [P] Register `match_initiation:read` delegation scope in `apps/person-mcp/src/delegations/` (owner-only self-read).
- [ ] T013 [P] Register `intent:bump_ack_count` system-delegation scope in `apps/person-mcp/src/delegations/` (system; cross-MCP increment/decrement of `liveAcknowledgementCount`) — IA § 3.10. Shared with spec 003.
- [ ] T014 [P] Register the same three scopes (`match_initiation:create`, `match_initiation:read`, `intent:bump_ack_count`) in `apps/org-mcp/src/delegations/` catalog.

### On-chain assertion wiring

- [ ] T015 Create `apps/web/src/lib/onchain/matchInitiationAssertion.ts` exposing a conditional-emit helper that mints `sa:MatchInitiationAssertion` only when both referenced intents have public on-chain assertions and the row's `visibility` is `public` or `public-coarse` — mirrors the existing `emitOnChainAssertion` path in `apps/person-mcp/src/tools/intents.ts`. Coarse tier omits `sa:basis`.
- [ ] T016 [P] Extend the on-chain → GraphDB sync at `apps/web/src/lib/ontology/sync.ts` to index `sa:MatchInitiationAssertion` triples into `DATA_GRAPH` (verify the sync is class-agnostic; if not, add the class to its allow-list).

### Shared SDK ranking module (consumed by specs 001, 002, 003)

- [ ] T017 Create `packages/sdk/src/matchmaker/ranking.ts` implementing `rankCandidates(candidates: Candidate[]): RankedCandidate[]` per the `matchmaker.ts` contract — pure function, formula `composite = 0.6 * 1/(1+hops) + 0.4 * (fulfilled+1)/(fulfilled+abandoned+2)`, ties within `1e-6` broken on recency, exports `DEFAULT_RANK_WEIGHTS = { proximity: 0.6, outcome: 0.4 }` and `RANK_TIE_TOLERANCE = 1e-6`. Implements FR-012, FR-013, FR-015, FR-016.
- [ ] T018 Create `packages/sdk/src/matchmaker/candidates.ts` with `selectCandidates(intent, hubScope, params): Candidate[]` shape from `contracts/matchmaker.ts`.
- [ ] T019 Create `packages/sdk/src/matchmaker/index.ts` re-exporting `rankCandidates`, `selectCandidates`, `RankBasis`, `Candidate`, `RankedCandidate`, weights, and tolerance.
- [ ] T020 [P] Re-export the matchmaker module from `packages/sdk/src/index.ts` so specs 002/003 can import `@smart-agent/sdk/matchmaker`.

### SHACL shapes synced to GraphDB (cross-spec; lands here since spec 001 ships first)

- [ ] T021 Sync `docs/ontology/tbox/matches.ttl`, `docs/ontology/tbox/intents.ttl`, `docs/ontology/cbox/controlled-vocabularies.ttl`, and `docs/ontology/tbox/shacl/visibility.ttl` to the GraphDB SmartAgents ontology graph (named graph `https://smartagent.io/graph/ontology`) per Audit § 7.

### Discovery service surface

- [ ] T022 Add `MatchInitiation` + `MatchInitiationAssertion` mirror types to `packages/discovery/src/types.ts`.
- [ ] T023 Add `packages/discovery/src/queries/matchInitiationAssertions.ts` with SPARQL for `listPublicMatchInitiationAssertions(filter)` and `getPublicMatchInitiationAssertion(id)` — public mirror reads only, never MCP.

**Checkpoint**: `match_initiations` schema lives in both MCPs; delegation scopes registered; `@smart-agent/sdk/matchmaker/ranking` is published; on-chain emit helper + sync indexing wired; SHACL shapes are in GraphDB. Specs 002 and 003 may now begin (they depend on this Foundational phase).

---

## Phase 3: User Story 1 — Browse & filter open intents in the hub (Priority: P1) MVP

**Goal**: Members can land on the hub's intents page and narrow open expressed intents by direction, kind, priority, geo, and free-text — with sensitive intents excluded for non-credentialed viewers.

**Independent Test**: Seed a hub with ≥10 expressed intents of mixed direction/type/priority/geo. Verify filter combinations and free-text return correct subsets; sensitive intents are hidden from non-addressee/non-credentialed viewers; empty filter combos show a helpful empty state.

### Implementation for User Story 1

- [ ] T024 [US1] Extend `packages/discovery/src/queries/intents.ts` with the filter SPARQL covering direction, intent type (SKOS leaf), priority, geo, and free-text across `title`/`topic`/`detail` — implements FR-001, FR-002, FR-003. Apply the existing `saint:visibility` filter for FR-004.
- [ ] T025 [US1] Add `listIntents(hubId, opts)` and `getIntentDetail(id)` methods to `packages/discovery/src/DiscoveryService.ts` returning `KBIntent[]` typed in `packages/discovery/src/types.ts`; resolves `addressedTo` against hub-membership for FR-001 + FR-023.
- [ ] T026 [US1] Add `IntentFilters.tsx` client component to `apps/web/src/app/h/[hubId]/(hub)/intents/(components)/IntentFilters.tsx` rendering direction / intent-type / priority / geo / free-text controls with direction-specific count chips (FR-005).
- [ ] T027 [US1] Add `EmptyState.tsx` to `apps/web/src/app/h/[hubId]/(hub)/intents/(components)/EmptyState.tsx` with guidance copy for FR-006 (widen filters or express intent).
- [ ] T028 [US1] Modify `apps/web/src/app/h/[hubId]/(hub)/intents/page.tsx` (server component) to consume `DiscoveryService.listIntents` with filter params from the URL query, render `IntentFilters` + result list + `EmptyState`, and apply the visibility gate (FR-004).

**Checkpoint**: US1 fully functional and testable — browse + filter + search + empty-state work end-to-end against seeded data.

---

## Phase 4: User Story 2 — See compatible counter-intents for a specific intent (Priority: P1)

**Goal**: A viewer of a single intent sees compatible counter-intents (opposite direction on the same `object`), with self-matches and withdrawn/abandoned/fulfilled candidates excluded, and sensitive candidates hidden.

**Independent Test**: For a seeded receive-shaped intent on `resourceType:Worker` with `intentType:NeedCoaching`, the detail page shows a "Compatible offers" section listing every same-object give-shaped intent and excluding different-object or self-expressed candidates.

### Implementation for User Story 2

- [ ] T029 [US2] Add `packages/discovery/src/queries/candidates.ts` with the counter-intent SPARQL: opposite-direction filter, same-object filter, self-match exclusion (`FILTER (?expA != ?expB)`), and exclusion of `withdrawn` / `abandoned` / `fulfilled` candidates — implements FR-007, FR-008, FR-009. Optional broadening via SKOS parent path (FR-010).
- [ ] T030 [US2] Add `listCandidatesForIntent(intentId, viewerAgentId)` to `packages/discovery/src/DiscoveryService.ts` joining the candidate query to `expressedByAgent` for downstream proximity computation; applies the sensitive-intent gate (FR-011).
- [ ] T031 [US2] Add `CandidateList.tsx` server component to `apps/web/src/app/h/[hubId]/(hub)/intents/(components)/CandidateList.tsx` rendering the candidate set or an empty-state ("No matches yet…") per Story 2 AC#4.
- [ ] T032 [US2] Modify `apps/web/src/app/h/[hubId]/(hub)/intents/[id]/page.tsx` to mount `CandidateList` for `expressed`/`acknowledged` intents only — withdrawn intents render no candidates section per Story 2 AC#2.

**Checkpoint**: US2 fully functional and testable — opening any active intent shows compatible counter-intents with the documented exclusions.

---

## Phase 5: User Story 3 — Rank candidates by trust + prior outcomes (Priority: P2)

**Goal**: Candidates are ordered by the composite `0.6 * proximity + 0.4 * outcome` formula with a per-candidate "why this rank" cue.

**Independent Test**: Seed two compatible give-shaped intents from agents at relational distances 1 and 4 with prior outcomes differing by ≥2 levels; verify ordering and that the cue is present and accurate.

### Implementation for User Story 3

- [ ] T033 [US3] Add `packages/discovery/src/queries/relationships.ts` with hop-distance SPARQL using `sa:relatesTo` transitive property capped at 6 hops (Research R2) — supports FR-012's `proximityHops` signal.
- [ ] T034 [US3] Add `getProximityHops(viewerAgentId, targetAgentId)` and `getPriorOutcomes(agentId)` helpers to `packages/discovery/src/DiscoveryService.ts` returning the `(hops)` and `(fulfilled, abandoned)` signals per Candidate.
- [ ] T035 [US3] Compose ranked candidates server-side in `apps/web/src/app/h/[hubId]/(hub)/intents/[id]/page.tsx` by hydrating Candidates from `listCandidatesForIntent` + `getProximityHops` + `getPriorOutcomes` and feeding them to `rankCandidates` from `@smart-agent/sdk/matchmaker` (the function ships as part of foundational T017).
- [ ] T036 [US3] Add `CandidateRow.tsx` client component to `apps/web/src/app/h/[hubId]/(hub)/intents/(components)/CandidateRow.tsx` rendering each `RankedCandidate` with the rank cue ("1 hop · 4 fulfilled / 0 abandoned" or "no prior history yet" when cold-start), a hover/expand showing contributing factors per FR-014, FR-015.

**Checkpoint**: US3 fully functional and testable — candidates render in deterministic ranked order with the rank cue legible.

---

## Phase 6: User Story 4 — Initiate a match from a candidate (Priority: P1)

**Goal**: A viewer can click "Propose match" and emit a stable, contract-shaped `MatchInitiation` artifact; both intents transition to `acknowledged`; connector mode is first-class.

**Independent Test**: From an intent detail page with at least one candidate, click "Propose match" and verify a `MatchInitiation` row exists referencing both intent IDs, the initiating agent, the timestamp, the `basis` snapshot, and a stable identifier consumable by the commitment workflow. Both intents move to `acknowledged`.

### Implementation for User Story 4

- [ ] T037 [US4] Add the `match_initiation:create` MCP tool in `apps/person-mcp/src/tools/matchInitiations.ts` that: validates per data-model.md (opposite directions, same object, no self-match, no existing `pending` initiation for the pair from this initiator — FR-019/Q5), derives `visibility` as the strictest of the two intents' tiers (cascade per IA § 3.1), inserts the `match_initiations` row, conditionally calls the on-chain emit helper from T015, issues `intent:bump_ack_count` (delta +1) system-delegations to each intent owner's MCP (IA § 3.10), and dispatches connector-mode notifications when `initiationKind === 'connector'` (per Spec Story 4 AC#4). Implements FR-017, FR-018, FR-020, FR-021.
- [ ] T038 [P] [US4] Add the same `match_initiation:create` tool in `apps/org-mcp/src/tools/matchInitiations.ts` (org-mcp twin) for org-tenant initiators.
- [ ] T039 [US4] Add `match_initiation:read_self` (owner-only) and `match_initiation:list_referencing_intent` (derived authority — caller proves intent-read authority) tools to `apps/person-mcp/src/tools/matchInitiations.ts` and the org-mcp twin file.
- [ ] T040 [US4] Create `packages/sdk/src/matchInitiation/types.ts` exporting `MatchInitiation`, `MatchInitiationKind`, `MatchInitiationStatus`, `MatchInitiationVisibility`, `ProposeMatchRequest`, `ProposeMatchError`, `ProposeMatchResult` per the `match-initiation.ts` contract.
- [ ] T041 [US4] Create `packages/sdk/src/matchInitiation/client.ts` implementing `MatchInitiationClient` per the contract: `propose` writes via initiator's MCP, `getById` reads from MCP for private rows or `@smart-agent/discovery.getPublicMatchInitiationAssertion` for the public mirror, `listForIntent` federates appropriately. Handles `ProposeMatchError` shapes including `stale-candidate`, `duplicate-pending`, `self-match-excluded`, `visibility-blocked`.
- [ ] T042 [P] [US4] Create `packages/sdk/src/matchInitiation/index.ts` re-exporting types and client; update `packages/sdk/src/index.ts` to publish the module.
- [ ] T043 [US4] Add server route `apps/web/src/app/h/[hubId]/(hub)/intents/[id]/propose-match/route.ts` that authenticates the caller, calls `MatchInitiationClient.propose` against the initiator's MCP, and returns the `ProposeMatchResult` to the UI.
- [ ] T044 [US4] Add `ProposeMatchButton.tsx` client component to `apps/web/src/app/h/[hubId]/(hub)/intents/(components)/ProposeMatchButton.tsx` rendering "Propose match" / "View existing match" based on the per-pair `pending` check and surfacing `stale-candidate` errors with a list refresh.
- [ ] T045 [US4] Wire `ProposeMatchButton` into `CandidateRow` and ensure the parent intent detail page surfaces the FR-019 already-paired affordance: action reads "view existing match" when an active `pending` initiation exists for this pair (Story 4 AC#2).

**Checkpoint**: US4 fully functional and testable — propose-match emits the `MatchInitiation` artifact end-to-end (MCP write → conditional on-chain anchor → ack-count fan-out → GraphDB mirror sync), with self and connector modes both working.

---

## Phase 7: User Story 5 — Network-scope discovery within the issuing hub (Priority: P3)

**Goal**: Hub members can opt in to network-scope discovery, surfacing intents addressed `network:<currentHub>` alongside `hub:<currentHub>`. Visibility never crosses the hub boundary in v1.

**Independent Test**: With seed data containing `hub:H1`, `network:H1`, and `hub:H2` intents, verify a member of H1 sees only `hub:H1` by default, sees both `hub:H1` and `network:H1` with the network-scope toggle on, and never sees `hub:H2`. A non-member of H1 never sees H1-addressed intents.

### Implementation for User Story 5

- [ ] T046 [US5] Extend the filter SPARQL in `packages/discovery/src/queries/intents.ts` to accept a `scope: 'hub' | 'network'` option that toggles the `addressedTo` filter between `hub:<id>` only and `hub:<id> | network:<id>` — implements FR-022, FR-023.
- [ ] T047 [US5] Extend `IntentFilters.tsx` in `apps/web/src/app/h/[hubId]/(hub)/intents/(components)/IntentFilters.tsx` with a network-scope toggle; default is hub-scope per FR-022.
- [ ] T048 [US5] Update `apps/web/src/app/h/[hubId]/(hub)/intents/page.tsx` to read the `scope` query param, pass it to `listIntents`, and enforce non-issuing-hub members never see H1-addressed `network:` intents (defensive double-check on top of the SPARQL filter).

**Checkpoint**: US5 fully functional and testable — network-scope toggle correctly broadens within issuing-hub visibility and never crosses the hub boundary.

---

## Phase N: Polish & Cross-Cutting Concerns

- [ ] T049 Run SHACL validation against the GraphDB ontology graph for `sa:PrivateIntentInitiationNoAnchorShape` and `sa:MatchInitiationOppositeDirectionsShape`; verify zero violations on seed data.
- [ ] T050 Walk through `specs/001-intent-marketplace-discovery/quickstart.md` end-to-end against the seeded demo hub; confirm steps 1–6 (browse → candidates → self-mode propose → connector-mode propose → already-paired guard → stale-candidate handling) behave as documented.
- [ ] T051 [P] Run `pnpm lint` and `pnpm typecheck` across the monorepo; fix any new violations introduced by spec 001.
- [ ] T052 Run `./scripts/fresh-start.sh` to verify the new `match_initiations` table and `liveAcknowledgementCount` column are picked up by the canonical reset (no edits expected — both tables live inside existing person-mcp / org-mcp DBs whose paths are already in `WIPE_PATHS`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories AND blocks specs 002 + 003** (they consume `@smart-agent/sdk/matchmaker/ranking` and the `intent:bump_ack_count` system-delegation scope shipped here).
- **User Stories (Phase 3+)**: Depend on Foundational completion.
- **Polish (Phase N)**: After all desired user stories.

### Cross-Spec Dependencies

- **Spec 002 is BLOCKED BY** Phase 2 of this spec (matchmaker module + `intent:bump_ack_count` scope; see spec 002 tasks.md "blocked by" note).
- **Spec 003 is BLOCKED BY** Phase 2 of this spec for the same reasons; spec 003 also uses `intent:bump_ack_count` directly (proposal submit/withdraw bumps the same counter).
- **SHACL sync (T021)** uploads the visibility/cascade shapes that specs 002 + 003 also rely on — both downstream specs reference T021 in their cross-spec dependencies and do not duplicate the upload.

### User Story Dependencies

- **US1 (P1)**: After Foundational. Independent.
- **US2 (P1)**: After Foundational. Independent of US1, but co-implementing improves UX coherence.
- **US3 (P2)**: After Foundational. Builds on US2's candidate query but is independently testable (re-rank a static candidate set).
- **US4 (P1)**: After Foundational. Hardest dependency — needs the MCP tool, the SDK client, the route, and the UI button. Reads candidates from US2 in practice.
- **US5 (P3)**: After Foundational. Independent of US2/US3/US4.

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (T002–T004, T006).
- Within Foundational: schema migrations for person-mcp and org-mcp run in parallel (T007 || T008, T009 || T010); delegation scope registrations run in parallel across the two MCP delegation catalogs (T012, T013, T014); on-chain helper and sync extension are independent (T015 || T016); SDK module tasks (T017–T020) are mostly sequential within the same package but the index re-export (T020) is parallelisable.
- Within US4: `apps/org-mcp/src/tools/matchInitiations.ts` (T038) is parallel with the corresponding person-mcp work (T037).

---

## Parallel Example: Foundational Schema + Scopes

```bash
# Run in parallel — different files in person-mcp vs org-mcp:
Task: "Add match_initiations table migration to apps/person-mcp/src/db/schema.ts"
Task: "Add match_initiations table migration to apps/org-mcp/src/db/schema.ts"
Task: "Add liveAcknowledgementCount to apps/person-mcp/src/db/schema.ts intents table"
Task: "Add liveAcknowledgementCount to apps/org-mcp/src/db/schema.ts intents table"

# Then in parallel — different scope catalogs:
Task: "Register match_initiation:read in apps/person-mcp/src/delegations/"
Task: "Register intent:bump_ack_count in apps/person-mcp/src/delegations/"
Task: "Register all three scopes in apps/org-mcp/src/delegations/"
```

---

## Implementation Strategy

### MVP scope (User Story 1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational) — note this also unblocks specs 002/003.
3. Complete Phase 3 (US1).
4. **STOP and VALIDATE**: browse + filter + search work against seed data.
5. Demo the browse surface; defer counter-intent + ranking + propose to subsequent phases.

### Recommended incremental order

1. Setup + Foundational → unblocks specs 002/003 + US implementation.
2. US1 → MVP (browse).
3. US2 → counter-intent surfacing (closes the matchmaker loop for read-only).
4. US4 → propose-match terminal action (closes the BDI loop end-to-end).
5. US3 → ranking quality multiplier on top of US2's list.
6. US5 → network-scope refinement.
7. Polish.

### Parallel team strategy

After Foundational lands:
- Developer A: US1 + US5 (filter surface).
- Developer B: US2 + US3 (candidates + rank).
- Developer C: US4 (propose-match write path; the heaviest story).

---

## Notes

- Spec 001 pioneers the persistence pattern; specs 002/003 reuse the foundational ranking module and `intent:bump_ack_count` scope.
- No test tasks were generated — the spec did not request TDD; validate via `quickstart.md`.
- `liveAcknowledgementCount` is intentionally NOT codified in T-Box (Audit § 2 O5); it is an MCP implementation primitive that supports FR-019 and the spec 003 cross-spec invariant.
- Connector-mode initiations live in the connector's MCP only — never replicated to the two intent expressers' MCPs (Audit § 2 O10; preserves owner-routing).
