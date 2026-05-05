# Phase 1 — Data Model: Intent Marketplace (Pool Lane)

## Entities

### Pool (existing first-class agent — extended; now formally typed)

`sa:Pool subClassOf sa:OrganizationAgent` (Audit § 2 O3 + § 4 F2). Pool's body lives in the pool's **org-mcp tenant** (`org_principal = poolAgentId`); public agent-profile fields are minted on chain via the existing pool-agent metadata mint and mirrored to GraphDB.

| Field | Type | T-Box predicate | Notes |
|-------|------|-----------------|-------|
| `id` | IRI | (row IRI) | stable identifier; the pool is also an agent |
| `name` | string | (existing agent property) | display |
| `domain` | enum | (existing pool property) | `'funding' \| 'coaching' \| 'prayer' \| 'skills' \| 'hospitality' \| ...` |
| `mandate` | string | (pool's mandate text) | narrative + structured tags |
| `governanceModel` | enum | `sa:governanceModel` | `'DAF' \| 'giving-circle' \| 'mission-cooperative' \| 'mutual-aid' \| 'faith-promise' \| 'fund'`. `sa:Fund` (subclass of `sa:Pool`) instances MUST carry `'fund'` (SHACL `sa:FundGovernanceModelConsistencyShape`). |
| `acceptedRestrictions` | object | (existing) | `{ kinds?: string[]; geoRoots?: string[]; notForAdmin?: bool; ... }` |
| `acceptedUnits` | string[] | `sa:acceptsUnit` (multi-valued) | declared units this pool accepts (Q1) |
| `capacityCeiling` | decimal? | `sa:capacityCeiling` | optional cap |
| `ceilingPolicy` | `'block' \| 'waitlist' \| 'accept'` | `sa:ceilingPolicy` (range `sa:CeilingPolicy` C-Box) | default `'accept'` if undeclared (Q3) |
| `addressedTo` | string | (existing) | `hub:<id>` \| `network:<id>` \| `agent:<addr>` |
| `addressedMembers` | IRI[] | `sa:addressedMembers` | private-pool only; lives in fund's org-mcp ONLY (no anchor — IA § 2.5) |
| `visibility` | `'public' \| 'private'` | `sa:visibility` | privacy gate |
| `stewardshipAgent` | IRI | `sa:stewardshipAgent` | the pool itself, when pool-as-agent; otherwise points to a designated agent |
| `stewards` | IRI[] | `sa:steward` (multi-valued) | individual stewards (used as fallback per Q2 / R4) |
| `acceptsOpenCalls` | boolean | `sa:acceptsOpenCalls` | (used by spec 003) |
| `pledgedTotal` | decimal | `sa:pledgedTotal` (derived aggregate) | live in pool's org-mcp; published to GraphDB only when public (via `sa:PoolPledgedTotalAssertion`) |
| `allocatedTotal` | decimal | (downstream) | sum of allocations made by stewards (downstream spec) |
| `availableTotal` | decimal | `sa:availableTotal` | `pledgedTotal - allocatedTotal` |

This feature **mutates only** the derived totals (`pledgedTotal`, `availableTotal`) — and only on the pool's org-mcp side, via the `pool:contribute_to_total` system-delegation issued by donors at submit time. Other fields are read-only from this feature's perspective.

---

### PoolPledge (new — persisted in donor's MCP)

The terminal artifact of this spec. Spec.md Clarifications Q1–Q5 fix the field shape.

**Persistence model** (per IA § 2.2):
- **Body**: row in donor's MCP `pool_pledges` table — `apps/person-mcp/src/db/schema.ts` for individual donors; org-mcp twin for org donors. Owner-routed by `principal` = `pledgerAgentId`.
- **Conditional on-chain anchor**: `sa:PledgeAssertion` minted only when pool is public AND `storyPermissions != 'anonymous'`. Full assertion when `storyPermissions = 'public'`; coarse (donor IRI omitted) when `storyPermissions = 'shareWithSupportTeam'`. SHACL `sa:AnonymousPledgeNoAnchorShape` and `sa:PrivatePoolPledgeNoAnchorShape` enforce these gates.
- **Pool aggregate**: incremented on the pool's org-mcp via the `pool:contribute_to_total` system-delegation. Published to GraphDB via `sa:PoolPledgedTotalAssertion` (donor-less, signed by the pool) when the pool wants its aggregate mirrored despite anonymous contributors (IA § 3.3).
- **Steward read of donor body**: only via `pool:read_pledge` cross-delegation, which donor issues at submit time *only* when `storyPermissions != 'anonymous'`.

**TS field → T-Box predicate mapping** (Audit § 3): TS keeps JS conventions; T-Box is bare:

| TS field | T-Box predicate |
|----------|-----------------|
| `pledgerAgentId` | `sa:pledger` (functional, subPropertyOf `prov:wasAssociatedWith`) |
| `poolAgentId` | `sa:targetPool` (functional) |
| `cadence` | `sa:pledgeCadence` (range `sa:PledgeCadence`) |
| `unit` | `sa:pledgeUnit` |
| `amount` | `sa:pledgeAmount` |
| `duration` | `sa:pledgeDuration` |
| `restrictions` | `sa:pledgeRestrictions` |
| `storyPermissions` | `sa:storyPermissions` (range `sa:StoryPermission`) |
| `pledgedAt` | `sa:pledgedAt` (subPropertyOf `prov:generatedAtTime`) |
| `stoppedAt` | `sa:stoppedAt` |
| `status` | `sa:pledgeStatus` (range `sa:PledgePoolStatus`) |
| `history` | `sa:pledgeHistory` (JSON literal) |

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | IRI | yes | stable identifier |
| `pledgerAgentId` | IRI | yes | must equal submitter (FR-023, no connector); equals row's MCP `principal` |
| `poolAgentId` | IRI | yes | the target pool (typed `sa:Pool`/`sa:Fund`) |
| `cadence` | `'one-time' \| 'monthly' \| 'annual'` | yes | C-Box `sa:PledgeCadence` |
| `unit` | string | yes | must be in `pool.acceptedUnits` (FR-008) |
| `amount` | decimal | yes | per cadence period |
| `duration` | integer? | conditional | months for `monthly`, years for `annual`; null for `one-time` |
| `restrictions` | object | no | subset of `pool.acceptedRestrictions` |
| `storyPermissions` | `'public' \| 'shareWithSupportTeam' \| 'anonymous'` | yes | C-Box `sa:StoryPermission` |
| `pledgedAt` | xsd:dateTime | yes | |
| `stoppedAt` | xsd:dateTime? | conditional | set when status moves to `stopped` or `auto-stopped` (Q5 cut-off) |
| `status` | `'active' \| 'waitlisted' \| 'stopped' \| 'auto-stopped' \| 'fulfilled'` | yes | C-Box `sa:PledgePoolStatus`; discovery never sets `'fulfilled'` |
| `history` | PledgeAmendment[] | no | embedded versioned history (Q4) |
| `visibility` | enum | yes | derived: `public` if pool public AND `storyPermissions=public`; `public-coarse` if pool public AND `storyPermissions=shareWithSupportTeam`; otherwise `private`. |
| `onChainAssertionId` | IRI? | conditional | set iff anchored |

#### Lifecycle

```
[creation, pool ceiling=accept or under cap] → active ─┬─→ stopped         (member action)
                                                       └─→ auto-stopped    (pool closed/withdrawn — FR-021)
[creation, pool ceiling=waitlist and over cap] → waitlisted ─┬─→ active     (room frees up, downstream spec)
                                                              └─→ stopped
                                                              └─→ auto-stopped
active / stopped / auto-stopped ─→ fulfilled                                (only for one-time pledges, set by downstream allocation/disbursement)
```

This spec writes `active`, `waitlisted`, `stopped`, `auto-stopped`. `fulfilled` is owned by the downstream spec.

#### Validation rules

- `unit ∈ pool.acceptedUnits`. Otherwise reject (FR-009).
- `restrictions.kinds ⊆ pool.acceptedRestrictions.kinds` (and similar for other restriction fields).
- `pledgerAgentId === submitter` (FR-023).
- For private pools: `submitter ∈ pool.addressedMembers`. (FR-010).
- For pool with `ceilingPolicy = 'block'` and `pledgedTotal + cadenceAwareTotal(pledge) > capacityCeiling`: reject.
- For `'waitlist'` over-cap: status defaults to `waitlisted`.
- For `'accept'` over-cap (or no ceiling): always accept.
- If `visibility ∈ {public, public-coarse}`: pool must be public; SHACL `sa:PrivatePoolPledgeNoAnchorShape` enforces.
- If `storyPermissions === 'anonymous'`: `onChainAssertionId` MUST be null; SHACL `sa:AnonymousPledgeNoAnchorShape` enforces.

#### Side effects on creation

- Pool's `pledgedTotal` increments by `cadenceAwareTotal(pledge)` — written via `pool:contribute_to_total` system-delegation to the pool's org-mcp.
- For public-tier pledges: emit `sa:PledgeAssertion` (full or coarse) on chain via `emitOnChainAssertion`; capture `onChainAssertionId` on the row.
- For non-anonymous pledges: donor issues `pool:read_pledge` cross-delegation to the pool's stewards (scope: this single pool).

#### `cadenceAwareTotal(pledge)`

```
one-time → pledge.amount
monthly  → pledge.amount * pledge.duration
annual   → pledge.amount * pledge.duration
```

---

### PledgeAmendment (embedded in `history`)

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `'amount' \| 'cadence' \| 'duration'` | which field changed |
| `prevValue` | any | the value before the amendment |
| `newValue` | any | the value after |
| `amendedAt` | xsd:dateTime | timestamp |
| `windowResetAt` | xsd:dateTime? | set on `cadence` and `duration` amendments per Q4 |

Recorded as a JSON literal on the pledge (`sa:pledgeHistory`). `sa:PledgeAmendment` is documentation-only in T-Box (Audit § 8.1) — amendments are NOT reified as separate triples.

---

## Relationships

```
PoolPledge.pledger ──→ Agent                       (sa:pledger; functional)
PoolPledge.targetPool ──→ Pool (typed sa:Pool)     (sa:targetPool; functional)
Pool a sa:Pool                                     (subClassOf sa:OrganizationAgent)
Fund a sa:Fund                                     (subClassOf sa:Pool; SHACL: governanceModel="fund")
Pool.stewards ──→ Agent[]                          (sa:steward)
Agent ──sa:relatesTo+──→ Agent                     (existing AgentRelationship graph; used for ranking)
PledgeAssertion / PoolPledgedTotalAssertion        (on-chain anchors; mirrored to GraphDB)
```

## Storage

- **Body**: `pool_pledges` table in donor's MCP (person-mcp + org-mcp twin). Per IA § 2.2.
- **Pool aggregate**: column on the pool's org-mcp pool-profile row (`pledgedTotal`, `availableTotal`); incremented via `pool:contribute_to_total` system-delegation.
- **On-chain assertions**: `sa:PledgeAssertion` (donor → pool, full or coarse), `sa:PoolPledgedTotalAssertion` (pool aggregate, donor-less). Emitter helper at `apps/web/src/lib/onchain/pledgeAssertion.ts` (NEW).
- **GraphDB mirror**: indexed by the on-chain → GraphDB sync; discovery reads via `packages/discovery` `listPublicPledgeAssertions(...)` and `getPublicPoolAggregate(...)`.
- **T-Box**: `docs/ontology/tbox/pool-pledge.ttl` (new — Audit § 1.1), `docs/ontology/cbox/controlled-vocabularies.ttl` (extended with the four SKOS schemes).
- **SHACL**: `docs/ontology/tbox/shacl/visibility.ttl` — `sa:AnonymousPledgeNoAnchorShape`, `sa:PrivatePoolPledgeNoAnchorShape`, `sa:FundGovernanceModelConsistencyShape`.

## Hot-path queries

1. `listPools(hubId, filters)` — paginated; reads from GraphDB public mirror. Private-pool detail is fetched from the pool's org-mcp via membership entitlement.
2. `getPoolDetail(poolId)` — joins to recent allocations (limited; aggregated per `storyPermissions`).
3. `pool_pledge:submit` (donor's MCP tool) — validates against pool constraints; conditionally emits the on-chain assertion; issues `pool:contribute_to_total` to the pool's org-mcp; issues `pool:read_pledge` cross-delegation when not anonymous.
4. `pool_pledge:read_self` (donor's MCP) — owner-only.
5. `pool_pledge:amend` (donor's MCP) — appends to history; bumps top-level fields; re-publishes assertion if necessary.
6. `pool_pledge:stop` (donor's MCP) — sets `stoppedAt`, transitions status.
7. `recordAutoStop(poolId)` — donor's MCP listing tool flips affected pledges to `auto-stopped` lazily on read when the pool is closed (FR-021; see R5 in research).
