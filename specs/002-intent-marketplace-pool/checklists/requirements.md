# Specification Quality Checklist: Intent Marketplace — Pool Lane (Discovery & Pledge)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-04
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — spec describes behavior; route reference is a scope anchor, not a prescription
- [x] Focused on user value and business needs — every story states the value before the mechanics
- [x] Written for non-technical stakeholders — minimal jargon outside terms already in the project (Pool, Pledge, restriction, mandate)
- [x] All mandatory sections completed — User Scenarios, Requirements, Success Criteria all present

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — all decisions resolved with reasonable defaults documented in Assumptions; clarification pass will tighten remaining ambiguity
- [x] Requirements are testable and unambiguous — each FR has a clear pass/fail observable
- [x] Success criteria are measurable — SC-001..SC-007 carry concrete metrics, thresholds, or verification methods
- [x] Success criteria are technology-agnostic — no framework, library, or storage-engine names; all stated in user-observable terms
- [x] All acceptance scenarios are defined — every story has Given/When/Then scenarios covering happy path and at least one variant
- [x] Edge cases are identified — private pools, capacity ceilings, restriction mismatch, auto-stop, on-behalf-of, multi-cadence amendments, ties, cold-start, no allocations, cross-hub
- [x] Scope is clearly bounded — explicit "Out of Scope" section names the downstream specs (allocation, disbursement, acknowledgment, trust-update, recall, connector pledging, cross-hub, campaign, governance)
- [x] Dependencies and assumptions identified — Dependencies and Assumptions sections list the load-bearing inputs and chosen defaults

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — FRs cluster under stories that each carry acceptance scenarios
- [x] User scenarios cover primary flows — browse, view detail, pledge, rank, manage
- [x] Feature meets measurable outcomes defined in Success Criteria — SC-005 explicitly ties the Pool Pledge artifact contract to the next spec
- [x] No implementation details leak into specification — confirmed; Pool Pledge described by what it carries, not how it's stored

## Resolved Clarifications (Session 2026-05-04)

| ID | Topic | Resolution |
|----|-------|------------|
| Q1 | `unit` taxonomy extension | Open string-enum; pools declare `acceptedUnits` per domain. v1 baseline: `USD \| hours \| prayer-commitments \| nights`. |
| Q2 | Stewardship agent for multi-steward pools | Pool-as-agent (first-class). Fallback for pools without a pool-level agent: minimum hop across individual stewards (deterministic). |
| Q3 | Capacity-ceiling default | `accept` (no ceiling enforced). Pools must opt in to `block` or `waitlist`. |
| Q4 | `annual` pledge amendment window | Amount-only preserves window; cadence amendment starts new window from amendment date; duration amendment replaces window. All recorded in `history`. |
| Q5 | Stop-pledge cut-off | `stoppedAt` is the bright line. Disbursements `<= stoppedAt` proceed; later ones cancel. Allocations made before `stoppedAt` are honored. |

## Notes

- Spec 002 reuses the artifact-handoff pattern and ranking formula from spec 001 verbatim. Co-evolution: any change to that formula in 001 should propagate.
- The Pool Pledge artifact's `status` field intentionally excludes `fulfilled` from this spec's lifecycle — only the downstream allocation/disbursement spec advances to that state.
- Persistence rewrite (2026-05-04 follow-on) — body in donor's MCP + conditional on-chain assertion + GraphDB mirror; pool aggregate flows via a `pool:contribute_to_total` system-delegation. Anonymous and private-pool pledges intentionally never anchor on chain. Canonical reference: `docs/information-architecture/10-intent-marketplace-classification.md` § 2.2; T-Box codified by Ontologist in `docs/ontology/INTENT_MARKETPLACE_AUDIT.md` § 1.1; Pool now typed as `sa:Pool subClassOf sa:OrganizationAgent` and Fund as `sa:Fund subClassOf sa:Pool`.
