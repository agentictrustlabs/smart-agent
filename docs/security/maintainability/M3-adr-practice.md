# M3 — ADR Practice

> **Status**: DRAFT. **No formal ADR practice today.** Architectural
> decisions live across `specs/*/plan.md`, `docs/architecture/*`,
> `docs/specs/*`, scattered design comments, and engineer memories.
> Spec 007 (architecture hardening) is itself an excellent ADR-like
> artifact; what's missing is the lightweight cadence for the
> smaller-but-still-significant decisions that don't warrant a Spec.
>
> This document specifies the ADR template, the `docs/adr/` location,
> the lifecycle (draft → accepted → superseded), and what qualifies.
>
> **Effort**: M (1 week to bootstrap + cull existing decisions into
> ADRs; ongoing per-decision).
> **Owner**: Architecture reviewer + Director of Engineering.
> **Depends on**: M1 (CODEOWNERS routes ADR PRs to architecture
> reviewer).
> **Unblocks**: a single discoverable history of "why is this code
> like this?"

---

## 1. Today's state (honest)

Decisions of architectural significance live in:
- `specs/<NNN>-<slug>/plan.md` — large initiatives (good).
- `docs/architecture/principles.md` — the P1 substrate-independence
  rule.
- Memory files (`project_*.md`) — significant decisions made by the
  user in conversation.
- Comments at the top of source files.
- Scattered code-review threads (lost over time).

When a new engineer asks "why don't we use Privy / Safe / etc.?", the
answer is in `docs/architecture/principles.md` AND in a memory file
AND in scattered design comments. None of these is the canonical
"decision record" the new engineer can grep.

This is the gap M3 closes.

---

## 2. Goals

1. **Every architecturally-significant decision is recorded as an
   ADR.** New engineers find one place to read.
2. **ADRs are versioned.** Superseded ADRs aren't deleted — they're
   marked SUPERSEDED-BY and the new ADR LINKS-BACK.
3. **ADRs are short and consistent.** Template forces brevity.
4. **ADRs are the source of truth.** When code conflicts with an
   ADR, either the ADR is wrong (update it) or the code is wrong
   (fix it).
5. **Specs are ADRs at large scale.** A spec subsumes an ADR for the
   work it describes; ADRs are for decisions outside or beneath specs.

---

## 3. What qualifies as an ADR

Write an ADR when:

- A choice has long-term consequences (>6 months).
- Multiple reasonable options exist; future engineers will wonder why
  we chose this one.
- Reversing the decision would be expensive.
- The decision crosses team boundaries.
- A new engineer would otherwise have to reverse-engineer the choice.

Examples that warrant an ADR (some historical, some current):
- "Use postgres.js (not pg or knex)" — Spec 007 F.2 picked it; could
  go to an ADR or stay in F.2.
- "Use Aurora Postgres (not RDS Postgres or self-managed)" — DR1.
- "Single region for v1" — DR5.
- "Use GrowthBook (not LaunchDarkly)" — O10.
- "Use opossum (not cockatiel)" — DR6.
- "K6 for load testing (not Gatling / Locust)" — O8.

Examples that don't warrant an ADR:
- "Use TypeScript strict mode" — codified in CLAUDE.md / coding standards.
- "Use Conventional Commits" — codified in M6.
- "Format code with Prettier" — codified in package.json.
- A bug fix.

---

## 4. ADR template

`docs/adr/_template.md`:

```markdown
# ADR <NNN> — <Title>

> **Status**: Draft | Proposed | Accepted | Superseded by ADR-<NNN> | Deprecated
> **Date**: YYYY-MM-DD
> **Decider(s)**: <names>
> **Tags**: storage | network | auth | cost | ...

## Context

What is the issue we're solving? What forces are in play?

(2-4 paragraphs maximum)

## Decision

What did we decide?

(1-3 paragraphs maximum)

## Consequences

Positive, negative, neutral. Be honest about trade-offs.

- **Positive**: …
- **Negative**: …
- **Risks**: …

## Alternatives considered

What did we look at and reject?

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| A | … | … | … |
| B | … | … | … |

## Related

- Other ADRs (links)
- Specs (links)
- Memory (memory keys)
- External references
```

The template is intentionally short. A 1-page ADR is good; a 10-page
ADR is a spec.

---

## 5. Numbering + naming

`docs/adr/NNNN-kebab-title.md` — four digits, zero-padded.

Examples:
- `docs/adr/0001-substrate-independence.md` — formalising the P1 rule.
- `docs/adr/0002-postgres-over-sqlite.md` — Spec 007 F.2's decision
  abstracted to an ADR (the implementation stays in F.2).
- `docs/adr/0003-aurora-over-rds-multi-az.md` — DR1.

Numbers are monotonic and never reused. Superseding an ADR creates a
new number; the old one is updated to `Status: Superseded by ADR-NNNN`.

---

## 6. Lifecycle

```
Draft → Proposed → Accepted
                       │
                       └→ Superseded by ADR-NNNN
                          (when overturned)
```

### 6.1 Draft

Author writes the ADR. Status: Draft.

### 6.2 Proposed

PR opened. Architecture reviewer (per M1's `/docs/adr/` rule) reviews.
Status: Proposed.

### 6.3 Accepted

PR merged. Status: Accepted. The decision is now binding.

### 6.4 Superseded

When a future decision overturns this one, a NEW ADR is written that:
- States the new decision.
- In its "Related" section, links the prior ADR.

The prior ADR's status changes to `Superseded by ADR-NNNN`.

The prior ADR is NEVER deleted. The history matters — future engineers
need to see "we tried X, it didn't work, here's Y."

### 6.5 Deprecated

Rare. Used when an ADR is no longer relevant (e.g. the system it
decided about was removed). Status: Deprecated.

---

## 7. Index

`docs/adr/README.md`:

```markdown
# Architecture Decision Records

This directory holds ADRs — Architecture Decision Records — recording
significant decisions made in this project.

See `M3-adr-practice.md` in docs/security/maintainability/ for the
practice + template.

## Active ADRs

| # | Title | Status | Tags |
|---|-------|--------|------|
| 0001 | Substrate independence | Accepted | principles |
| 0002 | Postgres over SQLite for production | Accepted | storage |
| 0003 | Aurora Postgres over RDS Multi-AZ alone | Accepted | storage, HA |
| 0004 | Base mainnet for v1 | Accepted | chain |
| 0005 | GrowthBook for feature flags | Accepted | ops |
| ... | | | |

## Superseded

| # | Title | Superseded by |
|---|-------|---------------|
| ... | | |
```

The index is regenerated from the ADR front-matter via a script
(`scripts/regenerate-adr-index.ts`) on every ADR PR.

---

## 8. Relationship to Specs

Specs (`specs/<NNN>-<slug>/plan.md`) are full design documents.
ADRs are short decision records.

Rule:
- If the work needs a plan, write a spec.
- If the work has already been done OR is straightforward but needs
  to record a CHOICE, write an ADR.

A spec MAY reference an ADR (e.g. "this spec adopts ADR-0001
substrate independence; see ADR for rationale"). An ADR MAY reference
a spec ("this ADR codifies the storage choice in spec 007 F.2").

When a spec is the canonical place for a decision, the ADR can be a
1-line file:

```markdown
# ADR 0010 — Storage layer: Postgres

> **Status**: Accepted
> **Date**: 2026-05-18

Codified in `specs/007-architecture-hardening/phase-F-storage-layer.md`.
See that doc for context, alternatives, and consequences.
```

This makes the ADR index searchable even when the substance lives in
a spec.

---

## 9. Migration plan — existing decisions

Once M3 lands, ~10 existing decisions get retroactive ADRs:

1. `ADR-0001 — Substrate independence` (formalises P1).
2. `ADR-0002 — Postgres over SQLite` (Spec 007 F.2 — short link-only).
3. `ADR-0003 — Aurora HA` (DR1).
4. `ADR-0004 — Base mainnet` (DR4).
5. `ADR-0005 — GrowthBook for flags` (O10).
6. `ADR-0006 — Canary + blue-green deploy modes` (O1).
7. `ADR-0007 — RTO/RPO targets` (O5).
8. `ADR-0008 — On-chain delegation hybrid Variant A + Variant B` (Spec 007 A).
9. `ADR-0009 — Single-region v1` (DR5).
10. `ADR-0010 — GraphDB external, no local fallback` (DR3).

These are short ADRs (most are link-only); they establish the index
quickly.

---

## 10. CI guards

- `scripts/check-adr-index.ts` — regenerates `docs/adr/README.md` and
  fails CI if the committed file is stale.
- `scripts/check-adr-format.ts` — parses every ADR; asserts the
  template's required sections are present.

---

## 11. Files to create/change

### New

- `docs/adr/_template.md` — template.
- `docs/adr/README.md` — index.
- `docs/adr/0001-substrate-independence.md`
- `docs/adr/0002-postgres-over-sqlite.md`
- (etc. per §9)
- `scripts/check-adr-index.ts`
- `scripts/check-adr-format.ts`
- `scripts/regenerate-adr-index.ts`

### Changed

- `docs/architecture/INDEX.md` — links to `docs/adr/`.
- `CLAUDE.md` — references the ADR practice.
- `package.json` — `check:all` includes `check:adr-*`.

---

## 12. Acceptance criteria

- [ ] `docs/adr/_template.md` committed.
- [ ] `docs/adr/README.md` index committed.
- [ ] First 10 ADRs (§9) drafted + accepted.
- [ ] Future architecturally-significant decisions land as ADRs.
- [ ] CI guards `check-adr-index` and `check-adr-format` green.
- [ ] M1 CODEOWNERS routes ADR PRs to `@smart-agent/architecture`.

---

## 13. Test plan

- Open a PR adding a new ADR with the wrong template structure;
  confirm `check-adr-format` fails.
- Open a PR adding an ADR without regenerating the index; confirm
  `check-adr-index` fails.
- Open a PR adding a properly-formatted ADR; confirm CI green.

---

## 14. Rollback

ADRs are docs; they can be stopped at any time. Stopping makes the
codebase less navigable; rolling back the practice is unlikely. The
worst case is the practice fades — visibility is the cure
(highlight ADR additions in the monthly engineering meeting).

---

## 15. Open questions

- **OQ-M3-1**: Markdown ADRs vs ADR-tools (Y-statements, MADR
  template, etc.)? Proposed: lightweight Markdown — our spec docs are
  already in Markdown; consistency wins over tool-purity.
- **OQ-M3-2**: Numbering across forks? Proposed: monotonic in main
  repo; fork-specific work uses fork-local numbering.
- **OQ-M3-3**: When does a memory note become an ADR? Proposed:
  memory is a workspace; ADR is a publication. When a memory has been
  referenced 3 times in PRs/discussion, promote it to an ADR.
- **OQ-M3-4**: How do we get the team in the habit? Proposed: the
  DoE writes the first 10 ADRs (§9 retroactives). Subsequent ADRs
  are author-driven; the architecture reviewer nudges during PR
  review when a decision warrants one.
- **OQ-M3-5**: Should ADRs be customer-visible? Proposed: most are
  internal; specific decisions of interest to customers (e.g.
  "single-region v1" with its SLA implications) get a customer-facing
  version on the status page or trust center.
