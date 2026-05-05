# Tasks: Intent Marketplace — Pool Lane (Discovery & Pledge)

**Input**: Design documents from `/specs/002-intent-marketplace-pool/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: NOT requested. No test tasks generated. Validate via the quickstart walkthrough.

**Organization**: Tasks are grouped by user story. Spec 002 reuses spec 001's foundational ranking module verbatim — no re-implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on earlier in-phase incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US5)
- File paths in every task are absolute / repo-relative

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm canonical inputs are present and prep the route tree.

- [ ] T001 Verify `docs/ontology/tbox/pool-pledge.ttl` declares `sa:Pool subClassOf sa:OrganizationAgent`, `sa:Fund subClassOf sa:Pool`, `sa:PoolPledge`, `sa:PledgeAssertion`, `sa:PoolPledgedTotalAssertion`, `sa:PledgeAmendment` (documentation-only), and the pool extension predicates (`sa:acceptsUnit`, `sa:ceilingPolicy`, `sa:capacityCeiling`, `sa:acceptsOpenCalls`, `sa:pledgedTotal`, `sa:availableTotal`, `sa:addressedMembers`, `sa:steward`, `sa:stewardshipAgent`) and pledge predicates (`sa:pledger`, `sa:targetPool`, `sa:pledgeCadence`, `sa:pledgeUnit`, `sa:pledgeAmount`, `sa:pledgeDuration`, `sa:pledgeRestrictions`, `sa:storyPermissions`, `sa:pledgedAt`, `sa:stoppedAt`, `sa:pledgeStatus`, `sa:pledgeHistory`) per Audit § 1.1.
- [ ] T002 [P] Verify `docs/ontology/cbox/controlled-vocabularies.ttl` declares the four SKOS schemes `sa:CeilingPolicy`, `sa:PledgeCadence`, `sa:PledgePoolStatus`, `sa:StoryPermission`.
- [ ] T003 [P] Verify `docs/ontology/tbox/shacl/visibility.ttl` declares `sa:AnonymousPledgeNoAnchorShape`, `sa:PrivatePoolPledgeNoAnchorShape`, `sa:FundGovernanceModelConsistencyShape` (Audit § 5).
- [ ] T004 Create the route tree skeleton under `apps/web/src/app/h/[hubId]/(hub)/pools/` (page.tsx, [poolId]/page.tsx, [poolId]/pledge/page.tsx, pledges/page.tsx) — empty server components that compile.
- [ ] T005 [P] Confirm `@smart-agent/sdk/matchmaker/ranking` is published (foundational dependency from spec 001 Phase 2). If not, this spec is blocked.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, delegation scopes, on-chain emit helpers, sync wiring. Reuses spec 001's matchmaker module — does not re-implement it.

**CRITICAL — Cross-spec dependency**: Spec 001's Phase 2 must be complete (the `@smart-agent/sdk/matchmaker/ranking` module is published, the `intent:bump_ack_count` scope exists if reused, and the SHACL upload happened). This spec adds pool-specific shapes on top.

### MCP table migrations

- [ ] T006 Add `pool_pledges` table migration to `apps/person-mcp/src/db/schema.ts` with columns `id` (IRI PK), `principal` (NOT NULL, = pledgerAgentId), `poolAgentId` (IRI), `cadence` (enum 'one-time'|'monthly'|'annual'), `unit` (string), `amount` (decimal), `duration` (integer nullable), `restrictions` (json), `storyPermissions` (enum 'public'|'shareWithSupportTeam'|'anonymous'), `pledgedAt` (timestamp), `stoppedAt` (timestamp nullable), `status` (enum 'active'|'waitlisted'|'stopped'|'auto-stopped'|'fulfilled'), `history` (json — `PledgeAmendment[]`), `visibility` (enum derived from pool + storyPermissions), `onChainAssertionId` (IRI nullable), `createdAt`, `updatedAt` — per IA § 2.2.
- [ ] T007 [P] Add identical `pool_pledges` table migration to `apps/org-mcp/src/db/schema.ts` (org-mcp twin for org donors) — per IA § 2.2.
- [ ] T008 Extend the pool-tenant profile in `apps/org-mcp/src/db/schema.ts` with aggregate counter columns `pledgedTotal` (decimal), `allocatedTotal` (decimal), `availableTotal` (decimal), and `addressedMembers` (string[] nullable; private pools only — IA § 2.5) on the pool-agent profile row.

### Delegation scope registration

- [ ] T009 Register `pool_pledge:submit` (donor-only; v1 forbids connector mode per FR-023), `pool_pledge:amend` (donor-only), `pool_pledge:stop` (donor-only), and `pool_pledge:read_self` (donor-only) scopes in `apps/person-mcp/src/delegations/` per the `pool-pledge.ts` contract.
- [ ] T010 [P] Register the same four scopes in `apps/org-mcp/src/delegations/` for org-donor tenants.
- [ ] T011 Register `pool:read_pledge` cross-delegation scope (issued by donor at submit time when `storyPermissions != 'anonymous'`; scope: one pool) in both `apps/person-mcp/src/delegations/` and `apps/org-mcp/src/delegations/`.
- [ ] T012 Register `pool:contribute_to_total` system-delegation scope in both `apps/person-mcp/src/delegations/` and `apps/org-mcp/src/delegations/` (donor's MCP issues to pool's org-mcp on submit; IA § 2.2 + § 3.3).
- [ ] T013 [P] Register `pool_pledge:auto_stop` system-delegation scope (used by the pool-closure cascade for FR-021) in `apps/org-mcp/src/delegations/`.

### On-chain assertion wiring

- [ ] T014 Create `apps/web/src/lib/onchain/pledgeAssertion.ts` with two emit helpers: `emitPledgeAssertion(pledge)` (full when `storyPermissions = 'public'` and pool is public; coarse — donor IRI omitted — when `storyPermissions = 'shareWithSupportTeam'`; no-op otherwise) and `emitPoolPledgedTotalAssertion(poolAgentId, total)` (donor-less aggregate, signed by the pool's stewardship agent). Mirrors the `apps/person-mcp/src/tools/intents.ts` `emitOnChainAssertion` path.
- [ ] T015 Extend the pool-agent metadata mint at `apps/web/src/lib/ontology/sync.ts` to anchor `acceptedUnits`, `ceilingPolicy`, `capacityCeiling`, `acceptsOpenCalls` as part of public pool agent profile fields (IA § 2.5).
- [ ] T016 [P] Verify the on-chain → GraphDB sync at `apps/web/src/lib/ontology/sync.ts` indexes `sa:PledgeAssertion` and `sa:PoolPledgedTotalAssertion` triples; if class-agnostic, no change; otherwise add the classes to the allow-list.

### On-chain assertion class confirmation

- [ ] T017 Confirm `sa:PledgeAssertion` and `sa:PoolPledgedTotalAssertion` classes are wired into the existing `AgentAssertion` contract path used by `emitOnChainAssertion` — no new ABI required (per IA § 3.7); document this fact in the emit helper's header comment.

### Discovery service surface

- [ ] T018 Add `Pool`, `Fund`, `PoolPledge`, `PledgeAssertion`, `PoolPledgedTotalAssertion` mirror types to `packages/discovery/src/types.ts` per the `pool.ts` and `pool-pledge.ts` contracts.
- [ ] T019 Add `packages/discovery/src/queries/pools.ts` with SPARQL for `listPools(filters)` and `getPoolDetail(id)` reading public pool agent profile fields from GraphDB.
- [ ] T020 [P] Add `packages/discovery/src/queries/pledgeAssertions.ts` with SPARQL for `listPublicPledgeAssertions(filter)` and `getPublicPoolAggregate(poolId)` — both read public mirror only.
- [ ] T021 [P] Add `packages/discovery/src/queries/poolAllocations.ts` (read-only here; populated by downstream allocation spec) returning per-pool allocation summaries honoring `storyPermissions` aggregation.

**Checkpoint**: `pool_pledges` schema lives in both MCPs; pool tenant profile has aggregate columns; delegation scopes registered; on-chain emit helpers + agent-metadata extension wired. Pool-side cross-spec scope (`pool:read_pledge`, `pool:contribute_to_total`, `pool_pledge:auto_stop`) is published. SHACL pool-pledge shapes were uploaded as part of spec 001's T021.

---

## Phase 3: User Story 1 — Browse & filter active pools (Priority: P1) MVP

**Goal**: Members can browse active pools in the hub by domain, governance model, geo, and free-text — with private pools hidden from non-addressed viewers.

**Independent Test**: Seed a hub with ≥6 pools across 3 domains and 3 governance models; verify filter combinations and free-text return correct subsets; private pools appear only to addressed members.

### Implementation for User Story 1

- [ ] T022 [US1] Extend `packages/discovery/src/queries/pools.ts` with filter SPARQL covering domain, governance model, geo, and free-text across name/mandate/description — implements FR-001, FR-002. Apply the `sa:visibility` + `sa:addressedMembers` gate for FR-003.
- [ ] T023 [US1] Add `listPools(filters)` to `packages/discovery/src/DiscoveryService.ts` returning `Pool[]`; resolves `addressedTo` against hub membership.
- [ ] T024 [US1] Create `packages/sdk/src/pools/types.ts` exporting `Pool`, `Fund`, `PoolDomain`, `PoolGovernanceModel`, `AcceptedRestrictions`, `CeilingPolicy`, `PoolListFilters`, `PoolAllocationSummary` per the `pool.ts` contract.
- [ ] T025 [US1] Create `packages/sdk/src/pools/client.ts` implementing `PoolClient.list(filters)` — reads public mirror via `@smart-agent/discovery`, falls back to the pool's org-mcp for private-pool detail via membership entitlement.
- [ ] T026 [US1] Create `packages/sdk/src/pools/index.ts` re-exporting types and client; update `packages/sdk/src/index.ts`.
- [ ] T027 [US1] Add `PoolFilters.tsx` client component to `apps/web/src/app/h/[hubId]/(hub)/pools/(components)/PoolFilters.tsx` rendering domain / governance / geo / free-text controls with count chips.
- [ ] T028 [US1] Add `PoolCard.tsx` server component to `apps/web/src/app/h/[hubId]/(hub)/pools/(components)/PoolCard.tsx` rendering one pool's name, mandate snippet, capacity widgets, and governance badge.
- [ ] T029 [US1] Add `EmptyState.tsx` to `apps/web/src/app/h/[hubId]/(hub)/pools/(components)/EmptyState.tsx` per FR-004.
- [ ] T030 [US1] Implement `apps/web/src/app/h/[hubId]/(hub)/pools/page.tsx` (server) consuming `PoolClient.list`, rendering `PoolFilters` + `PoolCard[]` + `EmptyState`.

**Checkpoint**: US1 fully functional and testable — pool browse + filter + search work end-to-end.

---

## Phase 4: User Story 2 — View pool detail (Priority: P1)

**Goal**: A pool detail page exposes mandate, accepted restrictions, capacity widgets (cadence-aware), and recent allocations honoring `storyPermissions`.

**Independent Test**: Open a seeded pool detail page; verify mandate text, restriction list, capacity widgets, and recent allocations render; private pools gate to addressed members only.

### Implementation for User Story 2

- [ ] T031 [US2] Add `getById(id, viewerAgentId)` and `getRecentAllocations(poolId, viewerAgentId, limit)` methods to `packages/sdk/src/pools/client.ts` — public-tier reads from GraphDB mirror; private-pool aggregate reads from the pool's org-mcp via membership check (FR-005, FR-007).
- [ ] T032 [US2] Add `MandateBlock.tsx`, `RestrictionsBlock.tsx`, `CapacityWidgets.tsx`, `RecentAllocations.tsx` server components under `apps/web/src/app/h/[hubId]/(hub)/pools/[poolId]/(components)/`. `CapacityWidgets` shows `pledged / allocated / available` (cadence-aware totals). `RecentAllocations` honors each allocation's `storyPermissions` per FR-006.
- [ ] T033 [US2] Implement `apps/web/src/app/h/[hubId]/(hub)/pools/[poolId]/page.tsx` (server) composing the four blocks above against `PoolClient.getById` + `PoolClient.getRecentAllocations`; gate private pool detail to addressed members (FR-007).

**Checkpoint**: US2 fully functional and testable — pool detail renders mandate / restrictions / capacity / recent allocations with privacy gates working.

---

## Phase 5: User Story 3 — Pledge into a pool (Priority: P1)

**Goal**: A member can submit a Pool Pledge with cadence/unit/amount/restrictions/storyPermissions; the artifact is consumed by the downstream allocation spec.

**Independent Test**: From a pool detail, submit a `monthly` `$100` `kinds: [trauma-care]` `shareWithSupportTeam` pledge; verify the artifact, the pool's pledged-total increment, and the cross-delegation issuance.

### Implementation for User Story 3

- [ ] T034 [US3] Add the `pool_pledge:submit` MCP tool in `apps/person-mcp/src/tools/poolPledges.ts` that: validates `unit ∈ pool.acceptedUnits` (FR-008/Q1), `restrictions ⊆ pool.acceptedRestrictions` (FR-009), `pledgerAgentId === submitter` (FR-023), private-pool addressee membership (FR-010), and ceiling policy (`block` rejects, `waitlist` sets status, `accept` always passes per FR-012/Q3 default `accept`). Inserts the row, derives `visibility` per the IA § 2.2 matrix, conditionally calls the `emitPledgeAssertion` helper (full / coarse / no-op), issues `pool:contribute_to_total` system-delegation to the pool's org-mcp (cadence-aware total per FR-011), issues `pool:read_pledge` cross-delegation when `storyPermissions != 'anonymous'`. Implements FR-013.
- [ ] T035 [P] [US3] Add the same `pool_pledge:submit` tool in `apps/org-mcp/src/tools/poolPledges.ts` for org-donor tenants.
- [ ] T036 [US3] Add `pool_pledge:read_self` (owner-only) and `pool_pledge:list_for_member(agentId)` tools in `apps/person-mcp/src/tools/poolPledges.ts` and the org-mcp twin.
- [ ] T037 [US3] Add `apps/org-mcp/src/tools/poolAggregate.ts` exposing the `pool:contribute_to_total` handler (increments `pledgedTotal` by `cadenceAwareTotal(pledge)` on the pool's org-mcp tenant — IA § 3.3) and the `pool:read_pledge` handler for steward-side reads.
- [ ] T038 [P] [US3] Add `apps/org-mcp/src/tools/poolMetadata.ts` extending the pool-agent metadata mint with `acceptedUnits`, `ceilingPolicy`, `capacityCeiling`, `acceptsOpenCalls` (FR-008 baseline + Q1 open enum).
- [ ] T039 [US3] Create `packages/sdk/src/poolPledge/types.ts` exporting `PoolPledge`, `PledgeCadence`, `PledgeStoryPermission`, `PledgeStatus`, `PledgeRestrictions`, `PledgeAmendmentKind`, `PledgeAmendment`, `PledgeVisibility`, `SubmitPledgeRequest`, `AmendPledgeRequest`, `SubmitPledgeError`, `SubmitPledgeResult` per the `pool-pledge.ts` contract; export the pure `cadenceAwareTotal(p)` helper.
- [ ] T040 [US3] Create `packages/sdk/src/poolPledge/client.ts` implementing `PoolPledgeClient` per the contract: `submit` writes via donor's MCP, `getById` / `listForMember` route through donor MCP for self or pool's org-mcp for steward views (via cross-delegation).
- [ ] T041 [P] [US3] Create `packages/sdk/src/poolPledge/index.ts` re-exporting; update `packages/sdk/src/index.ts`.
- [ ] T042 [US3] Add `apps/web/src/app/h/[hubId]/(hub)/pools/[poolId]/pledge/page.tsx` rendering the pledge composer (cadence picker, unit dropdown filtered by `pool.acceptedUnits`, amount, duration when recurring, restrictions multi-select scoped to `pool.acceptedRestrictions`, `storyPermissions` radio).
- [ ] T043 [US3] Add `apps/web/src/app/h/[hubId]/(hub)/pools/[poolId]/pledge/route.ts` server submit handler that calls `PoolPledgeClient.submit`, surfaces `SubmitPledgeError` shapes (`unit-not-accepted`, `restriction-not-accepted`, `ceiling-blocked`, `private-pool-not-addressed`), and returns confirmation referencing the next step.

**Checkpoint**: US3 fully functional and testable — pledge composer round-trips MCP write → conditional anchor → aggregate increment → cross-delegation issuance.

---

## Phase 6: User Story 4 — Rank pools (Priority: P2)

**Goal**: Pool list ranks by the same composite formula as spec 001 — proximity to the pool-as-agent (or min-hop fallback to stewards) plus prior allocation outcome score; rank cue per pool.

**Independent Test**: Seed two same-domain pools at hop distances 1 and 4 with prior outcome scores 0.9 and 0.4; verify the closer + better-record pool ranks first and the cue is present.

### Implementation for User Story 4

- [ ] T044 [US4] Add a pool-side proximity helper to `packages/discovery/src/DiscoveryService.ts` — `getPoolProximityHops(viewerAgentId, poolAgentId)` — using SPARQL that targets the pool-as-agent path with `MIN(hops_to_steward)` fallback when no pool-level relationship exists (Research R4 / Q2). Implements FR-015 determinism.
- [ ] T045 [US4] Add `getPoolPriorOutcomes(poolAgentId)` returning `(fulfilled, abandoned)` over the pool's prior allocations — falls through to zero-zero for cold-start pools (FR-015 Laplace smoothing handled by the shared ranking function).
- [ ] T046 [US4] Compute side signals server-side in `apps/web/src/app/h/[hubId]/(hub)/pools/page.tsx`: hydrate `Candidate[]`-shaped tuples per pool and feed them to `rankCandidates` from `@smart-agent/sdk/matchmaker` (foundational from spec 001). Tie-break on most recently active pool per FR-017.
- [ ] T047 [US4] Extend `PoolCard.tsx` in `apps/web/src/app/h/[hubId]/(hub)/pools/(components)/PoolCard.tsx` to render the rank cue ("1 hop · 12 fulfilled / 1 abandoned" or "no prior history yet") with an expand affordance per FR-016.

**Checkpoint**: US4 fully functional and testable — pools render in deterministic ranked order with the rank cue legible.

---

## Phase 7: User Story 5 — Manage your active pledges (Priority: P2)

**Goal**: A "your pledges" view lists active pledges grouped by pool; donors can amend cadence/amount/duration (history-tracked) or stop a recurring pledge; auto-stop fires when the underlying pool closes.

**Independent Test**: From "your pledges", amend an existing recurring pledge from $100/month to $150/month and verify a versioned history entry; stop a pledge and verify `stoppedAt` + the explanation copy.

### Implementation for User Story 5

- [ ] T048 [US5] Add `pool_pledge:amend` MCP tool to `apps/person-mcp/src/tools/poolPledges.ts` and the org-mcp twin: appends `{ kind, prevValue, newValue, amendedAt, windowResetAt? }` to `history`, bumps top-level fields per Q4 window-reset semantics (amount-only preserves window; cadence resets window from amendment date; duration replaces window), and re-issues `pool:contribute_to_total` for the cadence-aware delta. Implements FR-019.
- [ ] T049 [US5] Add `pool_pledge:stop` MCP tool to `apps/person-mcp/src/tools/poolPledges.ts` and the org-mcp twin: sets `stoppedAt`, transitions `status` to `stopped`, and issues a negative `pool:contribute_to_total` if appropriate. The user-facing copy explains the Q5 cut-off rule. Implements FR-020.
- [ ] T050 [US5] Implement the auto-stop cascade in `apps/org-mcp/src/tools/poolPledges.ts` (and the listing tool in `apps/person-mcp/src/tools/poolPledges.ts`): when the pool's stewardship action closes the pool, donor-side `list_for_member` lazily transitions affected pledges to `auto-stopped` on next read, setting `stoppedAt` to the pool closure timestamp (FR-021; via the `pool_pledge:auto_stop` system-delegation).
- [ ] T051 [US5] Add `amend` and `stop` methods to `packages/sdk/src/poolPledge/client.ts` per the `PoolPledgeClient` interface in the contract.
- [ ] T052 [US5] Implement `apps/web/src/app/h/[hubId]/(hub)/pools/pledges/page.tsx` listing the viewer's active pledges grouped by pool with `cadence`, `amount`, `next-disbursement-due`, `total-pledged-to-date`, `restrictions` (FR-018).
- [ ] T053 [US5] Implement `apps/web/src/app/h/[hubId]/(hub)/pools/pledges/[pledgeId]/page.tsx` showing one pledge with amend / stop affordances; invokes `apps/web/src/app/h/[hubId]/(hub)/pools/pledges/[pledgeId]/amend/route.ts` and `apps/web/src/app/h/[hubId]/(hub)/pools/pledges/[pledgeId]/stop/route.ts` server handlers respectively.

**Checkpoint**: US5 fully functional and testable — pledge management flows (amend / stop / auto-stop) work end-to-end.

---

## Phase N: Polish & Cross-Cutting Concerns

- [ ] T054 Run SHACL validation for `sa:AnonymousPledgeNoAnchorShape`, `sa:PrivatePoolPledgeNoAnchorShape`, `sa:FundGovernanceModelConsistencyShape` against the GraphDB ontology graph (uploaded as part of spec 001 T021). Verify zero violations on seed data.
- [ ] T055 Walk through `specs/002-intent-marketplace-pool/quickstart.md` end-to-end against the seeded demo hub; confirm steps 1–7 (browse → detail → submit → amend → stop → auto-stop → ranking) behave as documented.
- [ ] T056 [P] Run `pnpm lint` and `pnpm typecheck` across the monorepo; fix any new violations introduced by spec 002.
- [ ] T057 Run `./scripts/fresh-start.sh` to verify the new `pool_pledges` table and pool-tenant aggregate columns are picked up by the canonical reset.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup AND on **spec 001's Foundational phase being complete** (the `@smart-agent/sdk/matchmaker/ranking` module is published; SHACL shapes uploaded). Spec 001's `intent:bump_ack_count` scope is NOT used directly by spec 002 (no intent-ack semantics here).
- **User Stories (Phase 3+)**: Depend on Foundational completion.

### Cross-Spec Dependencies (BLOCKED BY / BLOCKS)

- **Spec 002 is BLOCKED BY** spec 001's Phase 2: matchmaker module + SHACL upload (`docs/ontology/tbox/shacl/visibility.ttl` includes pool-pledge shapes that ship in the same upload).
- **Spec 002 BLOCKS** spec 003: spec 003's Round entity is `sa:operatedByFund` where `sa:Fund subClassOf sa:Pool` — this typing is established here in T001 + T015 + T038 (via Audit § 4 F2). Spec 003 references the `acceptsOpenCalls` predicate in pool-extension form which is also published here (T015, T038).

### User Story Dependencies

- **US1 (P1)**: After Foundational. Independent.
- **US2 (P1)**: After Foundational. Builds on US1's `PoolClient` (extends with `getById` + `getRecentAllocations`).
- **US3 (P1)**: After Foundational. Reads pool data from US2's surface; the heaviest write story.
- **US4 (P2)**: After Foundational. Rank cue layered on top of US1's list.
- **US5 (P2)**: After Foundational + US3 (amend/stop operate on rows produced by US3's submit).

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel.
- Foundational schema for person-mcp and org-mcp run in parallel (T006 || T007). Delegation registrations marked [P] are parallel across the two MCP catalogs.
- Within US3: person-mcp tool work (T034) is parallel with org-mcp tool work (T035); pool aggregate handler (T037) and metadata extension (T038) are parallel.
- Within US4: discovery helpers (T044, T045) are parallel.

---

## Parallel Example: User Story 3 Dual-MCP Tooling

```bash
# Run in parallel — different MCP packages:
Task: "Add pool_pledge:submit MCP tool in apps/person-mcp/src/tools/poolPledges.ts"
Task: "Add pool_pledge:submit MCP tool in apps/org-mcp/src/tools/poolPledges.ts"
Task: "Add pool aggregate handler in apps/org-mcp/src/tools/poolAggregate.ts"
Task: "Add pool metadata extension in apps/org-mcp/src/tools/poolMetadata.ts"
```

---

## Implementation Strategy

### MVP scope (User Story 1 only)

1. Setup + Foundational.
2. US1 (browse pools).
3. **STOP and VALIDATE**: pool browse + filter work against seed data.
4. Demo and proceed.

### Recommended incremental order

1. Setup + Foundational.
2. US1 → MVP (browse).
3. US2 → pool detail surface.
4. US3 → pledge composer (closes the BDI loop).
5. US4 → ranking.
6. US5 → manage pledges.
7. Polish.

### Parallel team strategy

After Foundational lands:
- Developer A: US1 + US2 + US4 (read surfaces + ranking).
- Developer B: US3 (pledge composer; the heaviest story).
- Developer C: US5 (manage flows; depends on US3's submit landing).

---

## Notes

- Spec 002 reuses spec 001's `rankCandidates` function verbatim — only the side signals differ (proximity to pool-as-agent; outcome over pool's prior allocations).
- Anonymous pledges MUST NOT anchor on chain (signer linkability) — enforced both in T034 and by SHACL `sa:AnonymousPledgeNoAnchorShape`.
- Pool-tenant aggregate writes are coordinated via the `pool:contribute_to_total` system-delegation (IA § 3.3) — never direct cross-MCP writes.
- `PledgeAmendment` lives as JSON in `sa:pledgeHistory`; not reified as separate triples (Audit § 8.1).
- No test tasks generated — validate via `quickstart.md`.
