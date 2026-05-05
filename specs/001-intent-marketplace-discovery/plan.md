# Implementation Plan: Intent Marketplace — Discovery & Match (Direct / Relationship Lane)

**Branch**: `001-intent-marketplace-discovery` | **Date**: 2026-05-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification at `specs/001-intent-marketplace-discovery/spec.md`

## Summary

Close the BDI loop from *expressed* to *match-initiated* in the **Relationship lane** (1:1 direct counter-intent matching). Extend the existing intents pages under `apps/web/src/app/h/[hubId]/(hub)/intents/` with: a richer browse/filter index, a candidates section on each intent's detail page, a deterministic composite ranking (`0.6 * 1/(1+hops) + 0.4 * (fulfilled+1)/(fulfilled+abandoned+2)`), and a "Propose match" terminal action that emits a **Match Initiation** artifact consumed by the downstream commitment spec. Connector-mode initiation is first-class (per Clarification Q1).

Technical approach: server components for the index/detail pages; private writes go through the **initiator's MCP** (person-mcp or org-mcp) via a new `match_initiation:create` tool; conditional on-chain anchoring (`sa:MatchInitiationAssertion`) when both source intents are public-tier; the on-chain → GraphDB sync indexes the public mirror, which `@smart-agent/discovery` reads. A new `@smart-agent/sdk` matchmaker module pure-functions the ranking. T-Box terms are codified in `docs/ontology/tbox/matches.ttl` (extended) and the visibility cascade in `docs/ontology/tbox/shacl/visibility.ttl`. The persistence model follows the established Smart Agent pattern: **body in owner's MCP + conditional on-chain assertion + GraphDB mirror via the on-chain → GraphDB sync** — see `docs/information-architecture/10-intent-marketplace-classification.md` § 1 + § 2.1 for the canonical rules.

## Technical Context

**Language/Version**: TypeScript 5.x strict (web, sdk, discovery), Solidity 0.8.28 (contracts; not modified by this feature)
**Primary Dependencies**: Next.js 15 App Router, React 19, viem (chain reads only), `@smart-agent/discovery` (SPARQL), `@smart-agent/sdk`, GraphDB (SmartAgents repo)
**Storage**:
- *Reads*: existing knowledge graph (intents, agents, AgentRelationship edges) via GraphDB through `@smart-agent/discovery` for the public mirror; the initiator's MCP for their own private rows; cross-principal reads (intent expresser sees an initiation referencing their intent) routed via the initiator's MCP using derived intent-read authority (no new delegation scope — see IA § 2.1).
- *Writes*: a new `match_initiations` table in **the initiator's MCP** (`apps/person-mcp/src/db/schema.ts` and the org-mcp twin); a conditional on-chain `sa:MatchInitiationAssertion` mint via `emitOnChainAssertion` (the same path `apps/person-mcp/src/tools/intents.ts` uses) — only when **both** referenced intents are public-tier; the on-chain → GraphDB sync indexes the public mirror in `DATA_GRAPH`. Intent status transitions update the owning intent's MCP via the `intent:bump_ack_count` system-delegation (see § 5 below and IA § 3.10).
- *No new SQL in apps/web*; no smart-contract changes (the existing `AgentAssertion` / on-chain assertion contract carries the new assertion class).
**Testing**: Vitest for SDK / discovery; Playwright for the Next.js end-to-end flow (browse → candidate → propose); Vitest unit tests for the ranking pure function with property-based seeds.
**Target Platform**: Web (Chromium / Firefox / Safari latest) on Linux server.
**Project Type**: Web application (Next.js monorepo).
**Performance Goals**: Per spec SC-002, candidate list returns within 2s p95 for hubs of single-digit-thousands of intents. SC-001 implies time-to-first-relevant-candidate < 30s (UX target).
**Constraints**: TypeScript strict (no `any`); server-side blockchain operations only; private keys never in `NEXT_PUBLIC_*`; SPARQL only via `DiscoveryService`; no raw ABIs in app code (only `@smart-agent/sdk`).
**Scale/Scope**: Hub seeds carry tens to low-thousands of intents. Candidate computation is per-intent; cache is implementation choice.

## Constitution Check

The repository's `.specify/memory/constitution.md` is the placeholder template (not yet ratified). Project-level standards from `CLAUDE.md` are the operative constraints; this plan honours them:

- ✅ TypeScript strict; no `any`, no `@ts-ignore`.
- ✅ Server Components by default; `'use client'` only for the candidate-list interactivity and `ProposeMatchButton`.
- ✅ All blockchain operations server-side (no chain writes in this feature; reads via `viem` server-only).
- ✅ App code imports from `@smart-agent/sdk` and `@smart-agent/discovery`; no raw ABIs or SPARQL queries in the web app.
- ✅ Conventional Commits.
- ✅ No private keys in `NEXT_PUBLIC_*`.

No constitution violations to track.

## Project Structure

### Documentation (this feature)

```text
specs/001-intent-marketplace-discovery/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 — TypeScript interface contracts
│   ├── matchmaker.ts
│   └── match-initiation.ts
├── checklists/
│   └── requirements.md  # already exists
└── tasks.md             # generated by /speckit-tasks (not by this command)
```

### Source Code (repository root)

```text
apps/web/src/
├── app/h/[hubId]/(hub)/intents/
│   ├── page.tsx                          # MOD: extended browse/filter index
│   ├── [id]/
│   │   ├── page.tsx                      # MOD: add candidates section
│   │   └── propose-match/
│   │       └── route.ts                  # NEW: server route — calls initiator's MCP `match_initiation:create`
│   └── (components)/
│       ├── IntentFilters.tsx             # NEW
│       ├── CandidateList.tsx             # NEW (server)
│       ├── CandidateRow.tsx              # NEW (client; "why this rank" disclosure)
│       ├── ProposeMatchButton.tsx        # NEW (client)
│       └── EmptyState.tsx                # NEW
└── lib/onchain/
    └── matchInitiationAssertion.ts       # NEW: conditional emit helper for sa:MatchInitiationAssertion (mirrors apps/person-mcp's emitOnChainAssertion path)

apps/person-mcp/src/
├── db/schema.ts                          # MOD: add match_initiations table (per IA § 2.1 body layout)
├── tools/
│   └── matchInitiations.ts               # NEW: tools — match_initiation:create / read_self / list_referencing_intent
└── delegations/                          # MOD: register match_initiation:* scopes + intent:bump_ack_count system delegation

apps/org-mcp/src/
├── db/schema.ts                          # MOD: same match_initiations table (org-mcp twin; org_principal-keyed)
├── tools/
│   └── matchInitiations.ts               # NEW: same tool set, org-side
└── delegations/                          # MOD: same scope catalog additions

packages/sdk/src/
├── matchmaker/
│   ├── ranking.ts                        # NEW: composite ranking pure function
│   ├── candidates.ts                     # NEW: candidate selection helpers
│   └── index.ts                          # NEW: module exports
├── matchInitiation/
│   ├── client.ts                         # NEW: MatchInitiationClient (writes via initiator's MCP; reads via MCP for private rows or @smart-agent/discovery for public mirror)
│   ├── types.ts                          # NEW: artifact type
│   └── index.ts                          # NEW
└── index.ts                              # MOD: re-export new modules

packages/discovery/src/
├── DiscoveryService.ts                   # MOD: add listIntents(opts), getIntentDetail(id), listCandidatesForIntent(id), listPublicMatchInitiationAssertions(filter), getPublicMatchInitiationAssertion(id) — reads of public mirrors only; no MCP→GraphDB writes
├── queries/
│   ├── intents.ts                        # MOD/NEW: extended filter SPARQL
│   ├── candidates.ts                     # NEW: counter-intent SPARQL
│   ├── matchInitiationAssertions.ts      # NEW: read public-mirror SPARQL (sa:MatchInitiationAssertion)
│   └── relationships.ts                  # NEW: hop-distance SPARQL
└── types.ts                              # MOD: add MatchInitiation + assertion-mirror types
```

T-Box terms already authored by the Ontologist:
- `docs/ontology/tbox/matches.ttl` — extended with `sa:MatchInitiation`, `sa:MatchInitiationAssertion`, `sa:initiator`, `sa:viewedIntent`, `sa:candidateIntent`, `sa:initiationKind`, etc. (see Audit § 1.1).
- `docs/ontology/tbox/intents.ttl` — extended with `saint:visibility` (the cascade source).
- `docs/ontology/tbox/shacl/visibility.ttl` — `sa:PrivateIntentInitiationNoAnchorShape` enforces "no anchor when any source intent is private."
- `docs/ontology/cbox/controlled-vocabularies.ttl` — extended with `sa:MatchInitiationKind`, `sa:MatchInitiationStatus` SKOS schemes.

**Structure Decision**: Monorepo extension in place. No new package. Existing four-layer model honored: `web` → MCP (for owner-routed writes/private reads) and `web` → `discovery` → GraphDB (for public reads). The matchmaker pure function lives in `@smart-agent/sdk` so it's tree-shakeable and unit-testable independent of the data layer. The MCP→GraphDB pipe is forbidden (IA P4); GraphDB only ever holds an instance of `sa:MatchInitiationAssertion` if a public on-chain assertion published it first.

## Complexity Tracking

No constitution violations to justify.

| Decision | Why | Simpler alternative rejected because |
|----------|-----|--------------------------------------|
| MatchInitiation body lives in **initiator's MCP**, public-tier mirror via on-chain → GraphDB sync (per IA § 2.1) | Owner-routing (P1) + public/private split is physical (P4). A connector-mode initiation references two intents the connector does not own; the connector's MCP is the single owner of the artifact. Private-tier initiations must never reach GraphDB. | A direct GraphDB-as-truth write would require trusting MCPs to enforce visibility on every read; would also duplicate state across stores when the artifact is later joined to its owner-routed contributor's authority. |
| Ranking lives in `@smart-agent/sdk` (pure function) | No I/O; deterministic; tree-shakeable; testable in isolation. | Embedding ranking in the SPARQL query couples ranking to graph internals and breaks the spec's portability. |
| Hop computation runs in SPARQL (in `discovery`) | GraphDB's `*` path operators are deterministic and faster than fetching subgraph + BFS in JS. | JS BFS over a fetched subgraph is slower and risks coverage holes if the fetch misses edges. |
| `liveAcknowledgementCount` on the existing `intents` MCP table (per IA § 3.10) | Avoids fan-out queries across every MCP for FR-019's duplicate-check; respects owner-routing — the intent owner's MCP is authoritative for "is my intent live-acknowledged." Intentionally NOT codified in T-Box (Audit § 2 O5) — it's an MCP implementation detail. | A SPARQL `EXISTS` against GraphDB only sees public-tier initiations; private initiations would require fan-out across many MCPs plus a registry of "who might hold an acknowledgement." |

## Phase 0 — Outline & Research

See `research.md`. Resolved:
- Match-initiation persistence shape (body in initiator's MCP; conditional on-chain `sa:MatchInitiationAssertion` mint; on-chain → GraphDB mirror).
- Hop-distance SPARQL pattern (uses `sa:relatesTo` transitive property; cap at 6 hops to bound query time).
- Visibility model for sensitive intents (reuses existing `saint:visibility "private"` triple; credentialed-agent gate via existing `sa:agentEntitlement` join). The cascade rule and its SHACL enforcement live in `docs/ontology/tbox/shacl/visibility.ttl`.
- Self-match exclusion (single SPARQL `FILTER (?expA != ?expB)`).
- "Active" detection for FR-019 (initiator's MCP row with `status = 'pending'` — Q5 resolution; counts mirrored via `liveAcknowledgementCount` on each referenced intent's owning MCP).

## Phase 1 — Design & Contracts

### Data model

See `data-model.md`. Three entities involved:
1. **Intent** — read-only here; existing.
2. **MatchCandidate** — computed, not persisted; tuple of `(counter-intent, score, basis)`.
3. **MatchInitiation** — new persisted artifact (Q3 shape: `id`, `viewedIntentId`, `candidateIntentId`, `initiatorAgentId`, `initiationKind`, `proposedAt`, `basis`, `status`).

### Contracts

See `contracts/`. Two TypeScript module contracts:
- `matchmaker.ts` — `rankCandidates(intent, candidates, signals): RankedCandidate[]` (pure) and `selectCandidates(intent, hubScope, params): Candidate[]` (data-layer-bound).
- `match-initiation.ts` — `MatchInitiation` type and `MatchInitiationClient` interface.

### Quickstart

See `quickstart.md`. End-to-end flow from "Sofia opens her G2 apprentice need" through "candidates surface" through "propose match to Maria" with the resulting `MatchInitiation` triple.

### Agent context

CLAUDE.md SPECKIT marker points to the active plan (updated to spec 003 after the three-spec batch). The marker also references the canonical IA decision doc (`docs/information-architecture/10-intent-marketplace-classification.md`) and the Ontology audit (`docs/ontology/INTENT_MARKETPLACE_AUDIT.md`) so future readers can follow the trail.

## Phase 2 — Stop

Per the speckit-plan workflow, planning ends here. `/speckit-tasks` consumes these artifacts to produce `tasks.md`.
