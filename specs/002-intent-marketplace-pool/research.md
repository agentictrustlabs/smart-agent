# Phase 0 — Research: Intent Marketplace (Pool Lane)

## R1. PoolPledge persistence shape

**Decision**: Body lives in the **donor's MCP** (`apps/person-mcp/src/db/schema.ts` for individual donors; the org-mcp twin for org donors) in a new `pool_pledges` table. Conditional on-chain anchoring is gated by both pool visibility and the donor's `storyPermissions` setting. The on-chain → GraphDB sync indexes the public mirror.

**Per IA § 2.2 — the anchor matrix:**

| Pool visibility | Donor `storyPermissions` | Row visibility | On-chain anchor |
|---|---|---|---|
| public | public | `public` | `sa:PledgeAssertion` (full: donor IRI + pool + amount + unit + cadence) |
| public | shareWithSupportTeam | `public-coarse` | `sa:PledgeAssertion` (coarse: donor IRI OMITTED) |
| public | anonymous | `private` | **NO anchor** — donor must not be linkable on-chain |
| private | (any) | `private` | **NO anchor** |

**Why anonymous pledges cannot anchor**: an on-chain assertion is signed by the donor's session signer. Even if the assertion body omits the donor IRI, the signer's address is derivable from the transaction, and the donor's smart-account address is publicly linked to their IRI. The only way to truly anonymize is to keep the row in the donor's MCP and never publish.

**SHACL backstops** (`docs/ontology/tbox/shacl/visibility.ttl`):
- `sa:AnonymousPledgeNoAnchorShape` — pledges with `storyPermissions = anonymous` MUST NOT carry `sa:onChainAssertionId`.
- `sa:PrivatePoolPledgeNoAnchorShape` — pledges to non-public-tier pools MUST NOT carry an on-chain anchor.

**Body layout** (per IA § 2.2):

```ts
pool_pledges {
  id               IRI primary key,
  principal        not null,                 // = pledgerAgentId
  poolAgentId      IRI,
  cadence          enum,
  unit             string,
  amount           decimal,
  duration         integer nullable,
  restrictions     json,
  storyPermissions enum('public','shareWithSupportTeam','anonymous'),
  pledgedAt        timestamp,
  stoppedAt        timestamp nullable,
  status           enum,
  history          json,                     // PledgeAmendment[]
  visibility       enum (derived from storyPermissions + pool.visibility),
  onChainAssertionId IRI nullable,
  createdAt, updatedAt
}
```

**T-Box** — already authored by the Ontologist (Audit § 1.1). `docs/ontology/tbox/pool-pledge.ttl` declares:
- Classes: `sa:Pool` (subClassOf `sa:OrganizationAgent`), `sa:Fund` (subClassOf `sa:Pool`), `sa:PoolPledge`, `sa:PledgeAssertion`, `sa:PoolPledgedTotalAssertion`, `sa:PledgeAmendment` (documentation-only — amendments are JSON in `sa:pledgeHistory`, not reified triples).
- Properties: `sa:pledger` (functional), `sa:targetPool` (functional), `sa:pledgeCadence` (range `sa:PledgeCadence`), `sa:pledgeUnit`, `sa:pledgeAmount`, `sa:pledgeDuration`, `sa:pledgeRestrictions`, `sa:storyPermissions` (range `sa:StoryPermission`), `sa:pledgedAt` (subPropertyOf `prov:generatedAtTime`), `sa:stoppedAt`, `sa:pledgeStatus` (range `sa:PledgePoolStatus`), `sa:pledgeHistory`.

**TS field → T-Box predicate mapping** (Audit § 3): TS keeps `*AgentId` JS conventions; T-Box predicates are bare:

| TS field | T-Box predicate |
|----------|-----------------|
| `pledgerAgentId` | `sa:pledger` |
| `poolAgentId` | `sa:targetPool` |
| `cadence` | `sa:pledgeCadence` |
| `unit` | `sa:pledgeUnit` |
| `amount` | `sa:pledgeAmount` |
| `duration` | `sa:pledgeDuration` |
| `restrictions` | `sa:pledgeRestrictions` |
| `storyPermissions` | `sa:storyPermissions` |
| `status` | `sa:pledgeStatus` |
| `history` | `sa:pledgeHistory` (JSON literal) |

**Alternatives considered**: same as spec 001's R1 (rejected — see there).

## R2. Pool T-Box class hierarchy (Q1, Q3 + Audit § 4 F2)

**Decision**: `sa:Pool subClassOf sa:OrganizationAgent`; `sa:Fund subClassOf sa:Pool`. Plus the existing pool extension predicates: `sa:acceptsUnit` (multi-valued; Q1 — open string-enum), `sa:ceilingPolicy` (range `sa:CeilingPolicy` C-Box scheme — values `block` / `waitlist` / `accept`), `sa:capacityCeiling`, `sa:acceptsOpenCalls`, `sa:pledgedTotal` (derived aggregate), `sa:availableTotal`, `sa:addressedMembers`, `sa:steward`, `sa:stewardshipAgent`. SHACL `sa:FundGovernanceModelConsistencyShape` enforces that `sa:Fund` instances also carry `sa:governanceModel "fund"` (Audit § 2 O3 + § 5).

**Rationale**: Pool was previously typed only as a generic `sa:OrganizationAgent` (Audit § 4 F2 — high-severity finding). The new typing gives the pool extension predicates a well-typed domain and lets SPARQL filter cleanly on `?p a sa:Pool` / `?p a sa:Fund`.

The pool's per-tenant body lives in the pool's org-mcp tenant (`org_principal = poolAgentId`); the public agent-profile fields are minted on chain via the existing pool-agent metadata mint (`apps/web/src/lib/ontology/sync.ts` extension).

## R3. Cadence-to-total computation

**Decision**: Computed in the SDK (pure function) and SPARQL-aggregated for public capacity widgets (via the pool's `sa:pledgedTotal` mirror):
- `one-time` → `amount`.
- `monthly` with `duration` (in months) → `amount × duration`.
- `annual` with `duration` (in years) → `amount × duration`.

**Rationale**: Capacity widgets show *committed* totals; donors expect to see the full commitment, not the per-period drip.

## R4. Pool-as-agent proximity (Q2)

**Decision**: Hop distance is computed to the Pool agent itself. `sa:Pool` is a typed class (Audit § 4 F2); SPARQL filters cleanly on `?p a sa:Pool`. For pools without a pool-level agent (rare; legacy data), fall back to `MIN(hops_to_steward)` across the steward set — a deterministic minimum that does not depend on viewer state.

**SPARQL pattern**:
```sparql
SELECT ?pool (MIN(?hopCount) AS ?minHops) WHERE {
  ?pool a sa:Pool .
  { # pool-as-agent path
    ?viewer (sa:relatesTo)+ ?pool .
    BIND(... hop counter ...) AS ?hopCount
  } UNION { # fallback to stewards
    ?pool sa:steward ?steward .
    ?viewer (sa:relatesTo)+ ?steward .
    BIND(... hop counter ...) AS ?hopCount
  }
} GROUP BY ?pool
```

In practice the property-path `*` operator does the hop count via a counter wrapper; final implementation may use a recursive UNION to bound depth at 6.

## R5. Two-store write — donor's MCP + pool's org-mcp aggregate (IA § 2.2 + § 3.3)

**Decision**: A pledge submit writes the body to the **donor's MCP** (`pool_pledges`) and increments the **pool's org-mcp** `pledgedTotal` aggregate counter. The two writes are coordinated by a single-shot `pool:contribute_to_total` system-delegation the donor's MCP issues to the pool's org-mcp at submit time (analogous to the `notifications:create` pattern in `05-feature-data-flow.md` § 6).

For *public-tier* pledges (rows 1–2 of the matrix in R1), the pledge contribution also publishes via the on-chain `sa:PledgeAssertion`, so the public aggregate could in principle be derived from on-chain data — but for *private/anonymous* pledges, the only path to a live public capacity widget is the pool's stewards minting a `sa:PoolPledgedTotalAssertion` (donor-less aggregate) on demand. In v1 the aggregate publishes on a stewardship action; cron-based publishing is a future optimization.

**Rationale**: Single source of truth for the *aggregate* is the pool (which is the agent that "owns" the rolled-up state). Single source of truth for the *body* is the donor (owner-routing).

## R6. Stop-pledge cut-off (Q5)

**Decision**: `stoppedAt` is recorded on the pledge. The downstream allocation/disbursement spec reads `stoppedAt` and applies the rule: disbursements with `disburseAt <= stoppedAt` proceed; later ones cancel; allocations made before `stoppedAt` are honoured regardless of disbursement timing.

**Rationale**: Decidable purely from the artifact; no coupling to the downstream lifecycle.

## R7. Visibility / private pools

**Decision**: Reuses the visibility predicate now codified on `sa:Intent` (Audit § 4 F1) and the matching pattern on `sa:Pool`. Private pool browse and detail are gated by `sa:visibility "private"` joined with `sa:addressedMembers` membership. Private-pool details live entirely in the pool's org-mcp; addressed members read via existing membership entitlements.

## R8. Amendment versioning (Q4)

**Decision**: `sa:pledgeHistory` is a JSON-literal array of prior versions. Each amendment writes a new version entry at the end. Top-level `sa:pledgeAmount`, `sa:pledgeCadence`, `sa:pledgeDuration` always reflect the *latest* values. Window-reset semantics (Q4):
- Amount-only: write history; do not change `sa:pledgeDuration` or any window anchor.
- Cadence change: write history; reset the period anchor to the amendment date.
- Duration change: write history; replace `sa:pledgeDuration` with the new value.

`sa:PledgeAmendment` is **documentation-only** in T-Box (it describes the JSON shape inside `sa:pledgeHistory`; not reified as separate triples — Audit § 8.1).

**Rationale**: JSON-literal history is the cheapest forward-compatible representation; structured history triples would force schema rev anytime a new amendment kind appears.

## R9. Steward read access (IA § 2.2)

**Decision**: A pool's stewards can read full pledge bodies for `private`-tier pledges only via a cross-delegation grant the donor signed at pledge time — `pool:read_pledge` scoped to that pool's stewards. For `anonymous` `storyPermissions`, the donor does NOT issue this delegation; stewards see only the aggregate counter.

| Donor `storyPermissions` | Cross-delegation issued | What stewards see |
|---|---|---|
| `public` | yes — `pool:read_pledge` | full body, donor IRI |
| `shareWithSupportTeam` | yes — same | full body |
| `anonymous` | **no** | aggregate counter only |

**Implementation**: the pool's org-mcp federates queries across each donor's MCP using the cross-delegation; aggregation happens in the discovery service / web action layer (no JOIN; cf. P5 in IA principles).
