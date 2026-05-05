# Specification Quality Checklist: Intent Marketplace — Proposal Lane (Discovery & Submission)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-04
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — spec describes behavior; route references are scope anchors, not prescriptions
- [x] Focused on user value and business needs — every story states the value before the mechanics
- [x] Written for non-technical stakeholders — minimal jargon outside terms already in the project (Round, Proposal, mandate, milestone, validator)
- [x] All mandatory sections completed — User Scenarios, Requirements, Success Criteria, Clarifications all present

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — all 5 critical decisions resolved in the Clarifications session at spec creation time
- [x] Requirements are testable and unambiguous — each FR has a clear pass/fail observable
- [x] Success criteria are measurable — SC-001..SC-008 carry concrete metrics, thresholds, or verification methods
- [x] Success criteria are technology-agnostic — no framework, library, or storage-engine names; all stated in user-observable terms
- [x] All acceptance scenarios are defined — every story has Given/When/Then scenarios covering happy path and at least one variant
- [x] Edge cases are identified — closed/private rounds, missing credentials, budget overage, open-call rejection, withdrawal effect on intent, duplicate submission, cold-start, ties, cross-hub, connector
- [x] Scope is clearly bounded — explicit "Out of Scope" section names the downstream specs (review, award, tranche release, validation, trust-update, post-deadline edits, multi-year renewal, connector proposing, cross-hub, round authoring)
- [x] Dependencies and assumptions identified — Dependencies and Assumptions sections list the load-bearing inputs and chosen defaults

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — FRs cluster under stories that each carry acceptance scenarios
- [x] User scenarios cover primary flows — browse rounds, view round detail, submit proposal, rank both directions, manage proposals
- [x] Feature meets measurable outcomes defined in Success Criteria — SC-005 explicitly ties the Proposal Submission artifact contract to the next spec
- [x] No implementation details leak into specification — Proposal Submission described by what it carries, not how it's stored

## Resolved Clarifications (Session 2026-05-04)

| ID | Topic | Resolution |
|----|-------|------------|
| Q1 | Proposer-side round ranking signal | Composite from spec 001; proximity to fund agent; outcomes from fund's prior awards in proposer's intent domain (with fund-wide fallback). |
| Q2 | Steward-side proposal ranking signal | Same composite; proximity from fund agent to proposer agent; outcomes from proposer's prior fulfilled/abandoned ratio. |
| Q3 | Multi-round submission of same Proposal | Not allowed — one Proposal references one Round (or `null` for open-call). Cloning is the cross-round path; clone is a fresh artifact with `clonedFromProposalId` back-reference. |
| Q4 | Post-submission editing | Pre-deadline: free, version increments. Post-deadline: read-only here; further edits gated to steward-review spec. Withdrawals always allowed. |
| Q5 | Open-call submissions (no specific round) | Allowed when the target fund has `acceptsOpenCalls: true`; eligibility checked against the fund's mandate; artifact carries `roundId: null` and `fundMandateId` instead. |

## Notes

- Spec 003 reuses the artifact-handoff pattern and ranking formula from spec 001 (and 002's Pool-as-agent extension).
- The Grant Proposal artifact's `status` field exposes `awarded` / `declined` for read-only display in "your proposals" but those transitions are *set by* the downstream review spec, not by this feature.
- The "withdrawal reverts intent to expressed if no other acknowledgements" rule (FR-023) is the cross-spec invariant that keeps spec 001 (direct match) and this spec coherent on a shared intent — implemented via the `liveAcknowledgementCount` primitive on the existing `intents` table (IA § 3.10).
- Persistence rewrite (2026-05-04 follow-on) — body in proposer's MCP; **no on-chain anchor** in v1; **no GraphDB mirror** in v1; steward read via `proposal:read_for_review` cross-delegation. Class renamed `ProposalSubmission` → `GrantProposal` (Audit § 2 O1) propagated across TS, contracts, spec text, plan, data-model, research, quickstart. Canonical reference: `docs/information-architecture/10-intent-marketplace-classification.md` § 2.3 + § 2.4; T-Box codified by Ontologist in `docs/ontology/INTENT_MARKETPLACE_AUDIT.md` § 1.1.
