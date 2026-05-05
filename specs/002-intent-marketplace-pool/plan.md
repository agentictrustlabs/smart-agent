# Implementation Plan: Intent Marketplace — Pool Lane (Discovery & Pledge)

**Branch**: `002-intent-marketplace-pool` | **Date**: 2026-05-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification at `specs/002-intent-marketplace-pool/spec.md`

## Summary

Close the BDI loop from *pool published* to *pledge committed* in the **Pool lane** (many-to-many via stewarded pools). Extend `apps/web/src/app/h/[hubId]/(hub)/pools/` (creating routes if absent) with: a pools browse/filter index, a pool detail page (mandate + restrictions + capacity + recent allocations), a pledge composer with cadence/unit/restrictions/storyPermissions, ranking via the same composite formula as spec 001 (specialised to pool-as-agent proximity per Q2), and a "your pledges" management view. The terminal artifact is the **Pool Pledge** consumed by the downstream allocation/disbursement spec.

Technical approach: server components for index/detail/management; private writes go through the **donor's MCP** (person-mcp or org-mcp depending on the donor's agent type) via a new `pool_pledge:submit` tool; conditional on-chain anchoring via `sa:PledgeAssertion` (full or coarse) — only when the pool is public-tier AND `storyPermissions != 'anonymous'`. Anonymous and private-pool pledges stay MCP-only. Pool aggregate totals flow to the pool's org-mcp via a `pool:contribute_to_total` system-delegation issued by the donor's MCP at submit time; the pool's stewards optionally mint `sa:PoolPledgedTotalAssertion` to publish the aggregate. The same `@smart-agent/sdk/matchmaker/ranking` pure function from spec 001 is reused verbatim. T-Box terms live in `docs/ontology/tbox/pool-pledge.ttl` (new) and the visibility cascade in `docs/ontology/tbox/shacl/visibility.ttl`. The persistence model follows the established Smart Agent pattern: **body in donor's MCP + conditional on-chain assertion + GraphDB mirror via the on-chain → GraphDB sync** — see `docs/information-architecture/10-intent-marketplace-classification.md` § 2.2 for the canonical rules. No smart-contract changes (the existing AgentAssertion contract carries the new assertion classes).

## Technical Context

**Language/Version**: TypeScript 5.x strict; Solidity 0.8.28 (contracts; not modified by this feature)
**Primary Dependencies**: Next.js 15 App Router, React 19, viem (chain reads only), `@smart-agent/discovery`, `@smart-agent/sdk` (reuses `matchmaker/ranking` from spec 001), GraphDB
**Storage**:
- *Reads*: existing pool agents (now typed as `sa:Pool`/`sa:Fund` per Audit § 4 F2), `AgentRelationship`, pool allocations (where present from downstream spec) — all from GraphDB via `@smart-agent/discovery`. Donor reads of own pledges go through the donor's MCP. Steward reads of donor pledges go through each donor's MCP using a `pool:read_pledge` cross-delegation issued by the donor at submit time.
- *Writes*: a new `pool_pledges` table in **the donor's MCP** (`apps/person-mcp/src/db/schema.ts` and the org-mcp twin); a conditional on-chain `sa:PledgeAssertion` mint via `emitOnChainAssertion` (full assertion when pool is public AND `storyPermissions = 'public'`; coarse assertion that omits the donor IRI when `storyPermissions = 'shareWithSupportTeam'`; **no anchor** when `storyPermissions = 'anonymous'` or pool is private — SHACL `sa:AnonymousPledgeNoAnchorShape` and `sa:PrivatePoolPledgeNoAnchorShape`). The pool's `pledgedTotal` aggregate counter lives in the pool's org-mcp and is incremented via a one-shot `pool:contribute_to_total` system-delegation the donor's MCP issues to the pool's org-mcp at submit time (IA § 2.2 + § 3.3); the pool's stewards may optionally mint a `sa:PoolPledgedTotalAssertion` (donor-less) to publish the aggregate to the GraphDB mirror.
- `Pool.acceptedUnits` and ceiling-policy on the pool entity already extended in Pool's T-Box (`docs/ontology/tbox/pool-pledge.ttl`); on-chain agent metadata mint already covers these public agent-profile fields.
**Testing**: Vitest (sdk + discovery); Playwright for browse → detail → pledge → manage flow.
**Target Platform**: Web (latest Chromium / Firefox / Safari) on Linux server.
**Project Type**: Web application (Next.js monorepo).
**Performance Goals**: SC-002 — pool detail renders within 2s p95; SC-001 — pool discovery in under 30s for typical seeded data; SC-004 — pledge round-trip under 5s p95.
**Constraints**: TypeScript strict; server-side blockchain ops only; no raw SPARQL in app code; no `any`. Pool capacity widgets must reflect cadence-aware totals (one-time = amount; monthly with N-month duration = amount × N; annual = amount × duration-years).
**Scale/Scope**: Tens to low-hundreds of pools per hub; thousands of pledges across all pools.

## Constitution Check

`.specify/memory/constitution.md` is the placeholder template. Project standards from `CLAUDE.md` are honoured:

- ✅ TypeScript strict; no `any`.
- ✅ Server Components by default; `'use client'` for the pledge composer (form state) and "your pledges" management interactions.
- ✅ All blockchain ops server-side; this feature has none on-chain.
- ✅ App code through `@smart-agent/sdk` and `@smart-agent/discovery`.
- ✅ No private keys in `NEXT_PUBLIC_*`.
- ✅ Conventional Commits.

No constitution violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-intent-marketplace-pool/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── pool-pledge.ts
│   └── pool.ts
├── checklists/
│   └── requirements.md
└── tasks.md             # generated by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/src/
├── app/h/[hubId]/(hub)/pools/
│   ├── page.tsx                          # NEW (or MOD): index with filters
│   ├── [poolId]/
│   │   ├── page.tsx                      # NEW: pool detail (mandate, capacity, recent allocations)
│   │   ├── pledge/
│   │   │   ├── page.tsx                  # NEW: pledge composer
│   │   │   └── route.ts                  # NEW: server submit handler — calls donor's MCP `pool_pledge:submit`
│   │   └── (components)/
│   │       ├── MandateBlock.tsx
│   │       ├── RestrictionsBlock.tsx
│   │       ├── CapacityWidgets.tsx
│   │       └── RecentAllocations.tsx
│   ├── (components)/
│   │   ├── PoolFilters.tsx
│   │   ├── PoolCard.tsx
│   │   └── EmptyState.tsx
│   └── pledges/                          # NEW: "your pledges" surface
│       ├── page.tsx
│       ├── [pledgeId]/
│       │   ├── page.tsx
│       │   ├── amend/
│       │   │   └── route.ts              # NEW
│       │   └── stop/
│       │       └── route.ts              # NEW
└── lib/onchain/
    └── pledgeAssertion.ts                # NEW: emit helpers for sa:PledgeAssertion + sa:PoolPledgedTotalAssertion

apps/person-mcp/src/
├── db/schema.ts                          # MOD: add pool_pledges table (per IA § 2.2 body layout)
├── tools/
│   └── poolPledges.ts                    # NEW: tools — pool_pledge:submit / amend / stop / read_self
└── delegations/                          # MOD: register pool_pledge:* + pool:read_pledge + pool:contribute_to_total scopes

apps/org-mcp/src/
├── db/schema.ts                          # MOD: same pool_pledges table (org-side donors). Also: add pool aggregate counter columns to pool-agent profile (pledgedTotal, allocatedTotal, availableTotal) for pool-tenant rows; addressedMembers list for private pools (IA § 2.5)
├── tools/
│   ├── poolPledges.ts                    # NEW: same tool set, org-side donor
│   ├── poolAggregate.ts                  # NEW: pool:contribute_to_total handler that increments the pool's pledgedTotal counter; pool:read_pledge handler for steward-side reads
│   └── poolMetadata.ts                   # NEW: extends pool-agent metadata mint with acceptedUnits / ceilingPolicy / acceptsOpenCalls
└── delegations/                          # MOD: register matching scope catalog

packages/sdk/src/
├── pools/
│   ├── client.ts                         # NEW: PoolClient (reads pool data — public mirror via @smart-agent/discovery; private pool details via pool's org-mcp)
│   ├── types.ts                          # NEW: Pool, Fund, AcceptedUnits, CeilingPolicy
│   └── index.ts
├── poolPledge/
│   ├── client.ts                         # NEW: PoolPledgeClient (writes via donor's MCP; reads via donor MCP for self / pool's org-mcp for steward view via cross-delegation)
│   ├── types.ts                          # NEW: PoolPledge artifact
│   └── index.ts
└── matchmaker/
    └── ranking.ts                        # REUSED from spec 001; no change

packages/discovery/src/
├── DiscoveryService.ts                   # MOD: listPools(), getPoolDetail(), listPublicPledgeAssertions(), getPublicPoolAggregate() — reads public mirror only; no MCP→GraphDB writes (P4)
├── queries/
│   ├── pools.ts                          # NEW
│   ├── pledgeAssertions.ts               # NEW: SPARQL for sa:PledgeAssertion + sa:PoolPledgedTotalAssertion mirrors
│   └── poolAllocations.ts                # NEW (read-only here; written by downstream spec)
└── types.ts                              # MOD: add Pool + PoolPledge + assertion-mirror types
```

T-Box terms already authored by the Ontologist:
- `docs/ontology/tbox/pool-pledge.ttl` — NEW. `sa:Pool subClassOf sa:OrganizationAgent`; `sa:Fund subClassOf sa:Pool` (Audit § 2 O3 + § 4 F2). Plus `sa:PoolPledge`, `sa:PledgeAssertion`, `sa:PoolPledgedTotalAssertion`, `sa:PledgeAmendment` (documentation-only — amendments live as JSON inside `sa:pledgeHistory`). Pool extension predicates: `sa:acceptsUnit` (multi-valued), `sa:ceilingPolicy`, `sa:capacityCeiling`, `sa:acceptsOpenCalls`, `sa:pledgedTotal`, `sa:availableTotal`, `sa:addressedMembers`, `sa:steward`, `sa:stewardshipAgent`. Pledge predicates: `sa:pledger` (functional), `sa:targetPool` (functional), `sa:pledgeCadence` (range `sa:PledgeCadence`), `sa:pledgeUnit`, `sa:pledgeAmount`, `sa:pledgeDuration`, `sa:pledgeRestrictions`, `sa:storyPermissions` (range `sa:StoryPermission`), `sa:pledgedAt`, `sa:stoppedAt`, `sa:pledgeStatus` (range `sa:PledgePoolStatus`), `sa:pledgeHistory`.
- `docs/ontology/tbox/shacl/visibility.ttl` — `sa:AnonymousPledgeNoAnchorShape`, `sa:PrivatePoolPledgeNoAnchorShape`, `sa:FundGovernanceModelConsistencyShape` (enforces `sa:Fund` instances carry `sa:governanceModel "fund"` per Audit § 5).
- `docs/ontology/cbox/controlled-vocabularies.ttl` — extended with the `CeilingPolicy`, `PledgeCadence`, `PledgePoolStatus`, `StoryPermission` SKOS schemes.

**Structure Decision**: Monorepo extension. The `pools/` route tree is created if absent; pool-agent schema is extended via the `sa:Pool` / `sa:Fund` typing now formal in T-Box. Ranking is reused from spec 001 — same pure function, same weights. Body owner-routing means donors of any tenant type (person, org) write to their own MCP; the pool's org-mcp owns the *aggregate* state, never raw donor identities for anonymous pledges.

## Complexity Tracking

| Decision | Why | Simpler alternative rejected because |
|----------|-----|--------------------------------------|
| PoolPledge body in **donor's MCP**, conditional on-chain anchor, GraphDB mirror via on-chain → GraphDB sync (per IA § 2.2) | Owner-routing (P1) + public/private split is physical (P4). Anonymous pledges must NOT be linkable on-chain — even an "anonymized" body still leaks the donor via the signing key. The pool's `pledgedTotal` flows via a steward-controlled aggregate so the public widget stays live without leaking donor identity. | Direct-to-GraphDB writes would force private/anonymous pledges into a public store and require trust at every read. A single-write model would also require choosing between donor-truth and pool-truth for the aggregate. |
| Cadence-aware total widget | The capacity widget is a user-trust contract — must reflect what's actually committed. | Showing the per-period amount alone misleads on annual / monthly commitments. |
| `acceptedUnits` as open string-enum (Q1) | Future-proof: new domains add units without schema migration. | A closed enum would force a schema change for every new pool domain. |
| Pool-as-agent proximity (Q2) with min-hop fallback | Determinism (FR-014). | Picking a steward per-viewer makes ranks non-reproducible. |
| Default ceiling = `accept` (Q3) | Donors are never blocked by an unset default. | A default of `block` punishes donors for pool author inaction. |
| Annual-pledge amendment window rules (Q4) | Distinguishes amount-only / cadence / duration changes correctly. | A single "any-amendment-resets-window" rule mis-models common amount tweaks. |
| `stoppedAt` as the bright line (Q5) | Decidable in the artifact alone. | Coupling to the disbursement event ties this spec to the downstream allocation spec. |

## Phase 0 — Outline & Research

See `research.md`. Resolved:
- PoolPledge persistence shape (body in donor's MCP; conditional on-chain `sa:PledgeAssertion`; GraphDB mirror via the on-chain → GraphDB sync).
- The two-store write coordination for private/anonymous pledges (donor's MCP + pool's org-mcp aggregate counter, glued by a `pool:contribute_to_total` system-delegation).
- Pool-as-agent SPARQL pattern (uses existing pool-agent edges; min-hop fallback if no pool-level agent). `sa:Pool` and `sa:Fund` are now typed classes (Audit § 2 O3 + § 4 F2).
- Cadence-to-total formula (`one-time = amount`; `monthly = amount × duration_months`; `annual = amount × duration_years`).
- `acceptedUnits` extension model (a multi-valued property `sa:acceptsUnit` on the pool agent profile).
- Capacity-ceiling policy enforcement (`block | waitlist | accept`; default `accept`).
- Auto-stop on pool closure (FR-021): when the pool's stewardship action closes the pool, donor-side pledges are flipped to `auto-stopped` lazily on next read by the donor's MCP listing tool.

## Phase 1 — Design & Contracts

### Data model

See `data-model.md`. Two new entities (PoolPledge persisted; PledgeAmendment embedded in `history`); two existing extended (Pool with `acceptedUnits` and `ceilingPolicy`; nothing new on AgentRelationship).

### Contracts

See `contracts/`. Two TypeScript module contracts:
- `pool.ts` — `Pool` type and `PoolClient` (reads).
- `pool-pledge.ts` — `PoolPledge` artifact type and `PoolPledgeClient` interface (CRUD + amend + stop).

### Quickstart

See `quickstart.md`. End-to-end flow: Maria browses pools, opens NoCo Trauma-Care Fund, pledges $100/month with `kinds: [trauma-care]`, then amends and stops.

### Agent context

CLAUDE.md SPECKIT marker points to the active plan (updated at the end of the three-spec batch). The marker references the canonical IA decision doc (`docs/information-architecture/10-intent-marketplace-classification.md`) and the Ontology audit (`docs/ontology/INTENT_MARKETPLACE_AUDIT.md`).

## Phase 2 — Stop

`/speckit-tasks` consumes these artifacts.
