# Implementation Plan: Intent Marketplace — Proposal Lane (Discovery & Submission)

**Branch**: `003-intent-marketplace-proposal` | **Date**: 2026-05-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification at `specs/003-intent-marketplace-proposal/spec.md`

## Summary

Close the BDI loop from *round published* to *proposal submitted* in the **Proposal lane** (formal grant cycle). Add `apps/web/src/app/h/[hubId]/(hub)/rounds/` and `.../proposals/` route trees with: a rounds browse/filter index keyed to the viewer's `NeedIntent`s (mandate-match badging), a round detail page (eligibility/budget/milestones template/prior stats), a proposal composer (budget, plan, milestones, outcomes, validators, reporting), two-sided ranking (proposer-side ranks rounds; steward-side ranks proposals), and a "your proposals" management view with clone/withdraw/edit-pre-deadline. The terminal artifact is the **Grant Proposal** (T-Box: `sa:GrantProposal` — renamed from `ProposalSubmission` per Audit § 2 O1 to avoid collision with the existing on-chain `sag:Proposal` governance-vote class), consumed by the downstream steward-review/award spec.

Technical approach: server components throughout; reads of public rounds via `@smart-agent/discovery` (the GraphDB public mirror populated by sync from `sa:RoundOpenedAssertion` / `sa:RoundClosedAssertion`); proposer-side writes go through the **proposer's MCP** (almost always org-mcp; person-mcp for solo human applicants) via a new `grant_proposal:submit` tool. **No on-chain anchor for proposals in v1** — they remain confidential under steward review; SHACL `sa:GrantProposalAlwaysPrivateShape` enforces this. Steward read access via a `proposal:read_for_review` cross-delegation issued by the proposer at submit time. Round writes (round authoring is out of scope here, but the round's `proposalsReceived` counter increments via a system-delegation `round:increment_proposals_received` issued at submit time). Ranking reuses `@smart-agent/sdk/matchmaker/ranking` from spec 001 with side-specific signal definitions per Clarifications Q1/Q2. Persistence model follows the established Smart Agent pattern: **body in owner's MCP + conditional on-chain assertion (rounds only — never proposals in v1) + GraphDB mirror via the on-chain → GraphDB sync** — see `docs/information-architecture/10-intent-marketplace-classification.md` § 2.3 + § 2.4 for the canonical rules. No smart-contract changes (the existing AgentAssertion contract carries the new assertion classes).

## Technical Context

**Language/Version**: TypeScript 5.x strict; Solidity 0.8.28 (contracts; not modified)
**Primary Dependencies**: Next.js 15 App Router, React 19, viem (chain reads only), `@smart-agent/discovery`, `@smart-agent/sdk` (reuses `matchmaker/ranking` from spec 001), GraphDB
**Storage**:
- *Reads*: existing `NeedIntent` entities (from current intent layer / spec 001 foundation), fund agents (now typed `sa:Fund subClassOf sa:Pool`), `AgentRelationship`, prior award stats (where present from downstream spec). Public-tier round metadata read from GraphDB mirror via `@smart-agent/discovery`. Private-round addressee-list read from the fund's org-mcp. Proposer's own proposals read from the proposer's MCP. Steward views of incoming proposals read from each proposer's MCP via the `proposal:read_for_review` cross-delegation.
- *Writes*: a `proposal_submissions` table in **the proposer's MCP** (`apps/org-mcp/src/db/schema.ts` for org proposers; `apps/person-mcp/src/db/schema.ts` for solo human applicants). **No on-chain anchor** for proposals in v1 (SHACL `sa:GrantProposalAlwaysPrivateShape`). Round's `proposalsReceived` counter on the fund's org-mcp increments via a `round:increment_proposals_received` system-delegation issued by the proposer's MCP at submit time. Intent status transitions on submit/withdraw flow through the `intent:bump_ack_count` system-delegation (the same primitive spec 001 uses — IA § 3.10).
- *No new SQL in apps/web*; no smart-contract changes (existing AgentAssertion contract used for round-anchor classes).
**Testing**: Vitest (sdk + discovery); Playwright for browse → detail → draft → submit → withdraw → clone → resubmit flow.
**Target Platform**: Web (latest browsers) on Linux server.
**Project Type**: Web application (Next.js monorepo).
**Performance Goals**: SC-002 — round detail under 2s p95; SC-006/SC-007 — top-3 expert agreement at ≥70%; SC-004 — prepared proposer's draft → submit in under 8 minutes (UX target, not a server perf gate).
**Constraints**: TypeScript strict; server-side blockchain ops only; SPARQL only via `DiscoveryService`; rich text in proposals must be sanitised; required-credential checks reuse existing AnonCreds verifiers.
**Scale/Scope**: Tens of rounds open at any time per hub; hundreds of proposals across all rounds; tens of validators per proposal.

## Constitution Check

`.specify/memory/constitution.md` is the placeholder template. Project standards from `CLAUDE.md`:

- ✅ TypeScript strict; no `any`.
- ✅ Server Components by default; `'use client'` for the proposal composer (multi-step form state) and "your proposals" interactive shell.
- ✅ Blockchain ops server-side; no on-chain writes from this feature.
- ✅ App code through `@smart-agent/sdk` and `@smart-agent/discovery`.
- ✅ AnonCreds verifier integration follows the existing credential-registry pattern.
- ✅ Conventional Commits.

No constitution violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-intent-marketplace-proposal/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── round.ts
│   ├── grant-proposal.ts          # renamed from proposal.ts (Audit § 2 O1)
│   └── matchmaker-side-signals.ts
├── checklists/
│   └── requirements.md
└── tasks.md             # generated by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/src/
├── app/h/[hubId]/(hub)/rounds/
│   ├── page.tsx                          # NEW: rounds index (mandate-match badging) — reads public mirror
│   ├── [roundId]/
│   │   ├── page.tsx                      # NEW: round detail
│   │   ├── apply/                        # NEW: proposer-side draft & submit
│   │   │   ├── page.tsx
│   │   │   └── route.ts                  # NEW: submit handler — calls proposer's MCP `grant_proposal:submit`
│   │   └── (steward)/
│   │       └── proposals/
│   │           └── page.tsx              # NEW: steward-side ranked proposals view (federates across proposer MCPs via `proposal:read_for_review`)
│   └── (components)/
│       ├── RoundFilters.tsx
│       ├── RoundCard.tsx                 # mandate-match badge
│       ├── PriorStatsBlock.tsx
│       ├── EligibilityBlock.tsx          # credential-ownership inline
│       └── EmptyState.tsx
├── app/h/[hubId]/(hub)/proposals/
│   ├── page.tsx                          # NEW: "your proposals" management — reads proposer's MCP
│   ├── [proposalId]/
│   │   ├── page.tsx                      # NEW: read or edit (depending on state)
│   │   ├── edit/
│   │   │   └── route.ts                  # NEW: pre-deadline edit handler — calls proposer's MCP `grant_proposal:edit_pre_deadline`
│   │   ├── withdraw/
│   │   │   └── route.ts                  # NEW: withdraw handler — calls proposer's MCP `grant_proposal:withdraw` (issues `intent:bump_ack_count` -1)
│   │   └── clone/
│   │       └── route.ts                  # NEW: clone-as-new-draft
└── lib/onchain/
    └── roundAssertion.ts                 # NEW: emit helpers for sa:RoundOpenedAssertion + sa:RoundClosedAssertion (round-creation flow is OUT of scope; this helper exists for the round-creation spec to reuse, and for the proposalsReceived counter sync where applicable)

apps/org-mcp/src/
├── db/schema.ts                          # MOD: add `proposal_submissions` table (per IA § 2.3 body layout — proposers are almost always orgs); add `rounds` table on the fund's tenant (per IA § 2.4 — rounds are pre-seeded for spec 003 but the schema is the canonical home)
├── tools/
│   ├── grantProposals.ts                 # NEW: tools — grant_proposal:draft / submit / edit_pre_deadline / withdraw / clone / read_self
│   └── rounds.ts                         # NEW: read tools for round body; round:increment_proposals_received / decrement system handler
└── delegations/                          # MOD: register grant_proposal:* + proposal:read_for_review + round:increment_proposals_received + round:read_addressed_list scopes

apps/person-mcp/src/
├── db/schema.ts                          # MOD: add `proposal_submissions` table (solo human applicants)
├── tools/
│   └── grantProposals.ts                 # NEW: same tool set, person-side
└── delegations/                          # MOD: matching scope catalog

packages/sdk/src/
├── rounds/
│   ├── client.ts                         # NEW: RoundClient (reads — public mirror via @smart-agent/discovery; private addressee list via fund's org-mcp)
│   ├── types.ts
│   └── index.ts
├── grantProposals/                       # renamed from proposals/
│   ├── client.ts                         # NEW: GrantProposalClient (writes via proposer's MCP; reads via proposer MCP for self / fund's org-mcp + cross-delegation for steward view)
│   ├── types.ts                          # NEW: GrantProposal artifact
│   └── index.ts
├── matchmaker/
│   └── side-signals.ts                   # NEW: proposer-side and steward-side signal computation
└── matchmaker/ranking.ts                 # REUSED from spec 001

packages/discovery/src/
├── DiscoveryService.ts                   # MOD: listRounds(), getRoundDetail() — public mirror reads only. NO listProposals* methods (proposals are NEVER in GraphDB; reads federate across proposer MCPs in the action layer per IA P5).
├── queries/
│   ├── rounds.ts                         # NEW: SPARQL for sa:RoundOpenedAssertion / sa:RoundClosedAssertion mirrors
│   ├── fundMandate.ts                    # NEW: read sa:Fund mandate fields from the public mirror
│   └── priorStats.ts                     # NEW (proposer/fund prior outcomes by domain — derived from public award assertions when those land in the downstream spec)
└── types.ts                              # MOD
```

T-Box terms already authored by the Ontologist:
- `docs/ontology/tbox/proposal.ttl` — NEW. `sa:Round subClassOf prov:Plan, p-plan:Plan`; `sa:RoundOpenedAssertion`, `sa:RoundClosedAssertion`; `sa:GrantProposal` (renamed from `ProposalSubmission` per Audit § 2 O1). Plus `sa:proposer`, `sa:targetRound`, `sa:fundMandate` (range `sa:Fund` — no separate Mandate entity), `sa:basedOnIntent`, `sa:budget`, `sa:plan`, `sa:milestones`, `sa:desiredOutcomes`, `sa:reportingObligations`, `sa:organisationalBackground`, `sa:proposalSubmittedAt`, `sa:version`, `sa:lastEditedAt`, `sa:proposalStatus`, `sa:withdrawnAt`, `sa:clonedFromProposal`, `sa:operatedByFund`, `sa:roundMandate`, `sa:milestoneTemplate`, `sa:validatorRequirements`, `sa:reportingCadence`, `sa:deadline`, `sa:decisionDate`, `sa:requiredCredentials`, `sa:addressedApplicants`, `sa:proposalsReceived`.
- `docs/ontology/tbox/shacl/visibility.ttl` — `sa:GrantProposalAlwaysPrivateShape` enforces "no `sa:onChainAssertionId` on `sa:GrantProposal` in v1."
- `docs/ontology/cbox/controlled-vocabularies.ttl` — extended with `sa:GrantProposalStatus` and `sa:ReportingCadence` SKOS schemes.

**Structure Decision**: Two new route trees (`rounds/`, `proposals/`). Ranking is reused from spec 001 — same pure function. Side-specific signal computation lives in `@smart-agent/sdk/matchmaker/side-signals.ts`, separated from the formula so the ranking function stays a single source of truth. The `discovery` package gains round-side reads only; proposal reads federate across proposer MCPs in the action layer (no GraphDB join across stores — IA P5).

## Complexity Tracking

| Decision | Why | Simpler alternative rejected because |
|----------|-----|--------------------------------------|
| GrantProposal body in **proposer's MCP**, NO on-chain anchor v1, NO GraphDB mirror v1 (per IA § 2.3) | Proposal contents include budget, organisational backing, reporting cadence, validators — all sensitive. ECFA-style stewardship requires confidential review; donors must not be able to game competing proposals by reading them. The awarded outcome (downstream) is publishable; the submitted content is not. SHACL `sa:GrantProposalAlwaysPrivateShape` enforces this. | Anchoring at submission would leak budget/plan to anyone with on-chain read access. Mirroring private bodies into GraphDB violates P4. |
| Class rename `ProposalSubmission` → `GrantProposal` (Audit § 2 O1) propagated across all layers | Avoids permanent collision with `sag:Proposal` (governance-vote class in `tbox/governance.ttl`). The "Submission" suffix is redundant with the lifecycle field `submittedAt`. User explicitly authorised propagating the rename to TS / spec / contracts. | Keeping two `Proposal` classes would force every SPARQL query and TS reader to subclass-filter for disambiguation. |
| Round as a thin first-class entity (subClassOf `prov:Plan`) | Rounds need their own ID, deadline, prior stats. Anchored on chain via `sa:RoundOpenedAssertion` / `sa:RoundClosedAssertion`. | Embedding round metadata inside the fund agent forces a schema change every time round semantics evolve. |
| Two-sided ranking using the same pure function | Single source of truth for the formula; easy to verify FR-013/FR-015 determinism. | Two separate ranking functions doubles testing surface. |
| Side signals isolated in `matchmaker/side-signals.ts` | The formula is universal (specs 001/002/003); only the *signals* specialise. | Bundling side logic into ranking would defeat the reuse story. |
| Versioned pre-deadline edits | Steward sees latest version; the spec 001 `basis` snapshot pattern applies analogously to `version`. | Auto-overwriting without version history loses the audit trail proposers expect. |
| Clone as a separate artifact (Q3) | One Proposal → one Round; clean lineage via `clonedFromProposalId`. | Allowing one Proposal across many Rounds entangles review/award state per-round. |
| Open-call as `roundId: null` + `fundMandateId` (Q5) | Clear discriminator; same artifact shape. | A separate "OpenCallSubmission" type doubles the artifact surface for no gain. |

## Phase 0 — Outline & Research

See `research.md`. Resolved:
- Round entity shape (thin first-class: body in fund's org-mcp; public on-chain anchor `sa:RoundOpenedAssertion`/`sa:RoundClosedAssertion`; coarse anchor for private rounds with addressed-list staying in fund's org-mcp only).
- GrantProposal persistence shape (body in proposer's MCP; **no on-chain anchor v1**; **no GraphDB mirror v1**; steward read via `proposal:read_for_review` cross-delegation).
- Mandate-match heuristic for FR-001 badge (kind/geo/budget overlap; same SPARQL filter set as proposer-side ranking signal — applied to the public round mirror).
- Required-credential check via existing AnonCreds verifier infrastructure (matches the credential-registry pattern from CLAUDE.md memory).
- Pre-deadline vs post-deadline edit gate (deadline is on the Round; gate evaluated server-side at edit-time).
- Withdrawal effect on intent (FR-023): drives the `intent:bump_ack_count` system-delegation primitive on the intent owner's MCP — a single read of the owning MCP's `liveAcknowledgementCount` answers "any other live acknowledgements?" The same primitive is used by spec 001's MatchInitiation lifecycle (IA § 3.10).

## Phase 1 — Design & Contracts

### Data model

See `data-model.md`. Three entities of interest: Round (new thin entity, body in fund's org-mcp + on-chain anchor), GrantProposal (new persisted artifact, body in proposer's MCP, NO on-chain anchor in v1), and Fund (existing — typed `sa:Fund subClassOf sa:Pool`, extended with `acceptsOpenCalls`).

### Contracts

See `contracts/`. Three TypeScript module contracts:
- `round.ts` — `Round` type and `RoundClient`.
- `grant-proposal.ts` — `GrantProposal` artifact type and `GrantProposalClient` (CRUD + withdraw + clone). Renamed from `proposal.ts` per Audit § 2 O1.
- `matchmaker-side-signals.ts` — `proposerSideSignals(proposer, round)` and `stewardSideSignals(fund, proposer)` returning `RankBasis` for the spec 001 ranking function.

### Quickstart

See `quickstart.md`. Two flows: (a) proposer browses rounds, opens a round, drafts a proposal, submits, edits pre-deadline, withdraws, clones into a new round; (b) steward views ranked proposals on a round.

### Agent context

CLAUDE.md SPECKIT marker remains pointed at the active feature plan. The marker references the canonical IA decision doc (`docs/information-architecture/10-intent-marketplace-classification.md`) and the Ontology audit (`docs/ontology/INTENT_MARKETPLACE_AUDIT.md`).

## Phase 2 — Stop

`/speckit-tasks` consumes these artifacts.
