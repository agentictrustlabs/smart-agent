# 10 — Intent Marketplace Classification (specs 001 / 002 / 003)

This doc places every new entity introduced by the three intent-marketplace specs onto the IA map: store, tier, body location, replication policy, delegation gate, cross-store joins, and consolidation alignment.

It is the IA decision artifact handed to:
- the **Ontologist** (T-Box terms + recommended renames),
- the **Developer** (where to write rows, what tools to add),
- the **Security** agent (delegation scopes that need to exist before tools ship),
- the **Reviewer** (invariants to enforce on every PR).

**Scope.** Specs 001/002/003 close the "expressed → match initiated / pledge committed / proposal submitted" half of the BDI loop. Each terminates at an artifact handed to a downstream spec. The artifacts are: `MatchInitiation`, `PoolPledge`, `ProposalSubmission`. Plus extensions: `Pool.acceptedUnits`, `Pool.ceilingPolicy`, `Fund.acceptsOpenCalls`, the new thin `Round` entity.

**Cross-references**
- [01-principles.md](01-principles.md) — owner-routing, multi-party decomposition, no-duplication, visibility tiers.
- [02-data-ownership-map.md](02-data-ownership-map.md) — canonical ownership table (extended below in section "Map additions").
- [03-target-architecture.md](03-target-architecture.md) — per-store target schema (this doc adds new rows to person-mcp / org-mcp / graphdb).
- [06-data-ontology.md](06-data-ontology.md) — T-Box class registry (this doc adds entries).
- [09-privacy-audit.md](09-privacy-audit.md) — class of bug the splits below prevent.

---

## 1. The principle the plans got partially wrong

Every spec's plan says *"persisted as GraphDB triples"* for the new artifacts. **For public-tier artifacts that's correct; for private-tier artifacts it violates [01-principles.md P4](01-principles.md#p4-no-duplication-the-publicprivate-split-is-physical).**

The IA invariant that holds across all three specs: **GraphDB only ever holds an instance of `X` if a public on-chain assertion published `X` first.** The MCP→GraphDB pipe is forbidden. Therefore:

- Anything sensitive (`private` pool's pledge body, proposal financial detail, donor identity for an `anonymous` pledge, a connector's view of two intents they don't own) **cannot live in GraphDB as the source of truth**.
- The right shape is the same one we already use for `sa:Intent`: **owner's MCP holds the body; if visibility is `public`/`public-coarse`, the MCP signs an on-chain assertion via owner's session signer, and the on-chain → GraphDB sync indexes the assertion.**
- Where an artifact is *intrinsically public* (a fund publishing an RFP `Round`; a public pool's pledge tally; a discoverable `MatchInitiation` between two public intents) the artifact still anchors on-chain, with GraphDB holding the mirror.

The plans are not wrong about the **discoverable public projection** living in GraphDB — they're wrong only when they imply GraphDB is also the home for the *full* artifact. We split body (MCP) from public IRI / coarse summary (on-chain → GraphDB) per the existing pattern.

For v1, the simplest correct shape is:

| Artifact | Public on-chain anchor (mints assertion) | Body (full row) | Public summary (GraphDB via sync) |
|---|---|---|---|
| `MatchInitiation` (both intents public) | yes — `MatchInitiationAssertion` | initiator's MCP | yes |
| `MatchInitiation` (any intent private) | **no anchor** | initiator's MCP only | no |
| `PoolPledge` (public pool, donor `storyPermissions=public`) | yes — `PledgeAssertion` (donor + amount) | donor's MCP | yes |
| `PoolPledge` (any other configuration) | no | donor's MCP only | no (pool's pledged-total mirror is coarse and steward-side; see § 2.2) |
| `ProposalSubmission` (any) | no anchor (always confidential while submitted) | proposer's MCP (or org-mcp for org proposers) | no |
| `Round` (a fund's RFP) | yes — public RFP anchor | fund's org-mcp | yes |
| `Pool.acceptedUnits` etc. | inherits from existing pool agent | fund's org-mcp + on-chain agent metadata | yes |
| `Fund.acceptsOpenCalls` | inherits from existing pool agent | fund's org-mcp + on-chain agent metadata | yes |

(`MatchInitiation` is a borderline case — see § 2.1.)

---

## 2. Per-entity classification

### 2.1 `MatchInitiation` (spec 001)

**T-Box (proposed):** `sa:MatchInitiation` (subClassOf `prov:Entity`).

| Property | Value |
|---|---|
| Owning agent | `initiator` agent (NOT the two intent expressers) |
| Body store | initiator's MCP (`person-mcp` or `org-mcp` depending on initiator agent type) |
| Public IRI / on-chain anchor | conditionally minted on-chain (see below) |
| Public summary in GraphDB | conditionally mirrored from on-chain (see below) |
| Visibility tier | inherits the **stricter** of the two intents' tiers |
| Read-by-default | initiator + both intent expressers |
| Replication | none beyond on-chain → GraphDB sync (when minted) |

**Body layout — `match_initiations` table in initiator's MCP:**

```ts
match_initiations {
  id              IRI primary key,
  principal       not null,                 // = initiator agent id (the row's owner)
  viewedIntentId  IRI,                      // counter-party intent
  candidateIntentId IRI,                    // counter-party intent
  initiatorAgentId IRI,                     // == principal (redundant but mirrors spec)
  initiationKind  enum('self','connector'),
  proposedAt      timestamp,
  basis           json,                     // RankBasis snapshot
  status          enum('pending','superseded','consumed'),
  visibility      enum('public','public-coarse','private','off-chain'),
  onChainAssertionId IRI nullable,
  createdAt, updatedAt
}
```

This is the **same shape** as the existing `intents` table in person-mcp: `principal`, `visibility`, `onChainAssertionId`. The visibility column is set on insert from the **stricter of the two intents' visibilities**. A connector-initiated MatchInitiation against two public intents may itself be public; against any private intent the row stays private.

**On-chain anchor (only when visibility is `public` or `public-coarse`):**
```
sa:MatchInitiationAssertion
  sa:initiator         <agent>
  sa:viewedIntent      <iri>     (must already have a public on-chain assertion)
  sa:candidateIntent   <iri>     (must already have a public on-chain assertion)
  sa:initiationKind    "self"|"connector"
  sa:proposedAt        xsd:dateTime
  sa:basis             json-literal      (only for tier=public; coarse tier omits)
```

The chain emit reuses the existing `emitOnChainAssertion` path in `apps/person-mcp/src/tools/intents.ts` and its org-mcp twin. **Critical invariant:** an on-chain MatchInitiation assertion is only valid if both referenced intents have already minted their own on-chain assertions. If either is private, the MatchInitiation cannot anchor — the IRI of a private intent must not appear in a public GraphDB triple.

**Connector-mode (Q1 in spec 001) — where does the row live?**
The initiator (the connector) owns the row. It lives in the connector's MCP. The two intent expressers see this row only via:
- a notification their MCP receives (via the system-delegation `notifications:create` pattern from § 6 of [05-feature-data-flow.md](05-feature-data-flow.md));
- if the row is `public`, via GraphDB once it's anchored.

The connector's MCP knows things about both intents because the connector *read* both intents to compute the candidate — but those reads are subject to existing visibility gates (a private intent is never readable to a non-credentialed connector, FR-011). **The MatchInitiation row in the connector's MCP only contains IDs and the basis snapshot; it does not contain copies of the two intents' bodies.** That's the safe split.

**Delegation gate.**
- Write: `match_initiation:create` — requires owner's session OR a delegation token with that scope. Prevents drive-by writes.
- Read (to list one's own initiations): `match_initiation:read`. Default to owner-only.
- Cross-principal read (an intent expresser sees an initiation against their intent): not a delegation but a **derived authority** — the MCP exposes `list_initiations_referencing_intent(intentId)` which returns rows where `viewedIntentId == intentId OR candidateIntentId == intentId` AND the caller is one of the involved parties. The caller proves they're the expresser via their own intent-read authority. (No new scope needed.)

**Cross-store queries this enables.**
- *Active-initiation check* (FR-019): `EXISTS{ ?mi a sa:MatchInitiation; sa:viewed ?v; sa:candidate ?c; sa:status "pending" }` — answerable from GraphDB **only** if the relevant initiation is public-tier. For private-tier pairs the active-initiation check requires an MCP query (initiator's MCP holds the row; intent expressers' MCPs do not). For v1 we accept that the duplicate-check is only authoritative for the **initiating principal** — a different connector would not see another connector's private initiation against the same pair. Spec 001's FR-019 does not constrain cross-connector visibility, so this is in-spec; flag the weakening as an open question to the spec authors.
- *Spec 003 FR-023* (intent reverts to `expressed` if no other live acknowledgements): see § 4.5.

**Consolidation alignment.** Adds one table to **both** person-mcp and org-mcp (same shape, owner-routed by `principal`). Mirrors how the existing `intents` table was split. No new app, no new MCP. No backwards-compat — `fresh-start.sh` reseeds.

---

### 2.2 `PoolPledge` (spec 002)

**T-Box (proposed):** `sa:PoolPledge` (subClassOf `prov:Entity`).

| Property | Value |
|---|---|
| Owning agent | the donor (`pledgerAgentId`) |
| Body store | donor's MCP (`person-mcp` for individual donors; `org-mcp` for org donors) |
| Public IRI / on-chain anchor | only when pool is public AND donor `storyPermissions = 'public'` |
| Public summary in GraphDB | only when above; coarsened when `storyPermissions = 'shareWithSupportTeam'` (see below) |
| Visibility tier | derived: `public` only if pool is public AND `storyPermissions=public`. Otherwise `private`. |
| Read-by-default | donor + pool's stewards (via cross-delegation; see below) |
| Replication | on-chain → GraphDB only when public-tier; pool's `pledgedTotal` aggregate is steward-managed (see below) |

**Body layout — `pool_pledges` in donor's MCP:**

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

**`storyPermissions` and visibility — the load-bearing rule.**

| Pool visibility | Donor `storyPermissions` | Row visibility | On-chain anchor |
|---|---|---|---|
| public | public | `public` | yes — full assertion (donor IRI + pool + amount + unit + cadence) |
| public | shareWithSupportTeam | `public-coarse` | yes — coarse assertion (pool + amount + unit + cadence; donor identity OMITTED) |
| public | anonymous | `private` | **no** — donor identity must not be linkable on-chain; pool's pledged-total updates via a steward-controlled aggregate (see below) |
| private | (any) | `private` | no |

**Why anonymous pledges cannot anchor on-chain.** An on-chain assertion is signed by the donor's session signer. Even if the assertion body omits the donor IRI, the signer's address is derivable from the transaction, and the donor's smart-account address is publicly linked to their IRI. So the only way to truly anonymize is to *not* anchor on-chain — keep the row in the donor's MCP and let the pool's stewards see it via a delegation gate, but never publish.

**The pool's `pledgedTotal` aggregate.** Spec 002 says the pool entity's `pledgedTotal` is updated on pledge submit. This is **not** a private number — it's the visible capacity widget. So:

- For *public-tier* pledges (the first two rows above), the on-chain assertion publishes the pledge contribution; an on-chain → GraphDB sync rule materializes the per-pool aggregate. This works without trusting any single party.
- For *private-tier* pledges (rows 3 and 4 above), the contribution must still flow into the pool's visible total without leaking the donor. The right home is the **pool's org-mcp** (the fund agent's tenant): the pool's stewards run an aggregate counter that increments by `cadenceAwareTotal(pledge)` when a private pledge is recorded. The pool then optionally signs an on-chain assertion of its own *aggregate* total (no donor info) for GraphDB indexing. This keeps Discover-side capacity widgets live without leaking donor identity.

This is a **two-store write** — donor's MCP holds the pledge body; pool's org-mcp updates the aggregate. The two writes are coordinated via a **system-delegation token** the donor's MCP issues at submit time (`pool:contribute_to_total` scope on the pool's org-mcp). This mirrors the system-delegation pattern in [05-feature-data-flow.md § 6](05-feature-data-flow.md).

**Stewards reading donor pledges.** A pool's stewards can read the full pledge body for `private`-tier pledges only via a cross-delegation grant the donor signed at pledge time (an opt-in clause like "share my pledge body with this pool's stewards for allocation purposes"). For `anonymous` `storyPermissions`, the donor does **not** issue this delegation — the steward sees only the aggregate.

| Donor `storyPermissions` | Cross-delegation issued at pledge time | What stewards see |
|---|---|---|
| `public` | yes — `pool:read_pledge` scoped to this pool's stewards | full body, donor IRI |
| `shareWithSupportTeam` | yes — same scope | full body |
| `anonymous` | **no** | aggregate counter only; donor IRI never reaches stewards |

**Delegation gates.**
- `pool_pledge:submit` — donor's session OR delegation. v1 forbids connector mode (FR-023).
- `pool_pledge:amend` — donor only.
- `pool_pledge:stop` — donor only.
- `pool_pledge:read_self` — donor only by default.
- Cross: `pool:read_pledge` (scope: a single pool) — granted by donor to that pool's stewards at submit time when `storyPermissions != 'anonymous'`.
- System: `pool:contribute_to_total` (scope: one pool) — granted by donor's MCP to the pool's org-mcp on submit; lets the pool's MCP increment its private aggregate.

**Cross-store queries.**
- "List a pool's pledges" (steward view) — pool's org-mcp pulls from each donor's MCP via the cross-delegation. Anonymous pledges are visible only as a counter in the pool's org-mcp.
- "List my pledges" (donor view) — donor's MCP local query.
- "Pool capacity widget" (any browser) — for public pools, GraphDB aggregate (mirrored from the on-chain pool-aggregate assertion); for private pools, pool's org-mcp via member visibility check.

**Consolidation alignment.** Same shape as `intents`. No backwards-compat. Adds `pool_pledges` to both person-mcp and org-mcp. Adds an aggregate column to org-mcp's pool agent profile. Updates `WIPE_PATHS` (already covered by org-mcp + person-mcp paths).

---

### 2.3 `ProposalSubmission` (spec 003)

**T-Box (proposed):** `sa:ProposalSubmission` (subClassOf `prov:Entity`; aligns with the existing on-chain `sa:Proposal` governance class — see naming-rename note in § 5).

| Property | Value |
|---|---|
| Owning agent | the proposer (`proposerAgentId`) |
| Body store | proposer's MCP. **Almost always `org-mcp` in practice** (proposers are organisations applying for grants). For solo human applicants, person-mcp. |
| Public IRI / on-chain anchor | **none in v1**. The full proposal is confidential at submission and remains so under steward review. |
| Public summary in GraphDB | none in v1. (Awarded outcomes — set by the downstream review/award spec — may anchor; not in this spec's scope.) |
| Visibility tier | always `private` |
| Read-by-default | proposer + the round's stewards (via cross-delegation issued at submit time) |
| Replication | none |

**Body layout — `proposal_submissions` in proposer's MCP** (mostly org-mcp; same shape in person-mcp for solo proposers):

```ts
proposal_submissions {
  id              IRI primary key,
  principal       not null,                 // = proposerAgentId (often org_principal)
  roundId         IRI nullable,
  fundMandateId   IRI nullable,             // when roundId is null (open call)
  basedOnIntentId IRI,
  budget          json,
  plan            json,
  milestones      json,
  desiredOutcomes json,
  reportingObligations json,
  organisationalBackground json,
  submittedAt     timestamp,
  version         integer,
  lastEditedAt    timestamp,
  status          enum('draft','submitted','withdrawn','awarded','declined'),
  withdrawnAt     timestamp nullable,
  clonedFromProposalId IRI nullable,
  basis           json,                     // RankBasis snapshot at submit time
  visibility      always 'private',
  createdAt
}
```

**Why no on-chain anchor at submission time.** Proposal contents include budget, organisational backing, reporting cadence, and validators — all sensitive. ECFA-style stewardship requires that proposals are reviewed in confidence; donors should not be able to game competing proposals by reading them. The **awarded** outcome (downstream spec) is publishable; the **submitted** content is not. Hence no on-chain anchor in v1.

The downstream review/award spec MAY introduce a public anchor for *awarded* proposals (a coarse "this fund awarded $X to this org for this round" assertion) — that's a future spec's call, not ours.

**Steward read access.** When a proposer submits, the submission tool issues a cross-delegation `proposal:read_for_review` to the round's `stewardshipAgent` (which is the fund's pool-agent — see § 2.5). The fund's org-mcp uses that delegation to render the steward's "proposals on my round" view.

**Delegation gates.**
- `proposal:draft`, `proposal:submit`, `proposal:edit_pre_deadline`, `proposal:withdraw`, `proposal:clone` — proposer only.
- `proposal:read_self` — proposer only.
- Cross: `proposal:read_for_review` (scope: one round or one fund) — issued by proposer at submit; readable by round's stewards (= fund's pool-agent's org-mcp tenant) until the proposal hits a terminal state (`withdrawn`/`awarded`/`declined`).

**Cross-store queries.**
- "Proposals on my round" (steward) — fund's org-mcp federates queries across each proposer's MCP using the cross-delegation. Aggregation happens in the discovery service / web action layer (no JOIN; cf. P5 in [01-principles.md](01-principles.md)).
- "Your proposals" (proposer) — proposer's MCP local query.
- *FR-023 cross-spec invariant* (intent reverts if no other live acknowledgements): see § 4.5.

**Consolidation alignment.** Adds `proposal_submissions` to both person-mcp and org-mcp. Mirrors the existing `proposals` table that already lives in org-mcp (governance proposals — different concept; rename recommended in § 5).

---

### 2.4 `Round` (spec 003)

**T-Box (proposed):** `sa:Round` (subClassOf `prov:Plan`; references a fund-as-pool-agent).

| Property | Value |
|---|---|
| Owning agent | the fund (a pool with `governanceModel: 'fund'`) |
| Body store | fund's org-mcp |
| Public IRI / on-chain anchor | yes — Rounds are RFPs, intrinsically public. The fund mints a `RoundOpened` assertion on creation and `RoundClosed` on deadline pass / decision. |
| Public summary in GraphDB | yes — full mirror of public fields from the on-chain assertion |
| Visibility tier | `public` (round body lives in fund's org-mcp; the public fields are anchored on-chain) — `private` rounds with `addressedApplicants` are addressee-gated but still anchored as a (coarse) assertion plus a private addressee-list in org-mcp |
| Read-by-default | anyone (public rounds); addressed applicants only (private rounds) |
| Replication | on-chain → GraphDB sync |

A `Round` is conceptually identical to an existing public agent profile ("hey, here's an RFP we're running"). It's authored by the fund's stewards, operates against the fund's mandate, and accepts proposals against itself. Authoring is **out of scope** for spec 003 (it says "rounds are pre-seeded"); when the round-creation spec arrives, the canonical pattern is:
- Fund's org-mcp holds the `rounds` table (full body: mandate, milestone template, validator requirements, reporting cadence, deadline, decision date, prior stats counters, `addressedApplicants` for private rounds, the `proposalsReceived` counter).
- Fund signs an on-chain `RoundOpenedAssertion` with public fields (mandate summary, deadline, decision date, budget ceiling, expected awards, visibility, `acceptsOpenCalls` from fund); the on-chain → GraphDB sync indexes it.
- For private rounds, the on-chain assertion is *coarse* (no addressed-applicants list) and the private list lives in fund's org-mcp; an addressed applicant queries the fund's org-mcp via a `round:read_addressed_list` cross-delegation issued at round creation.

**Body layout — `rounds` in fund's org-mcp:**

```ts
rounds {
  id                  IRI primary key,
  org_principal       not null,            // = fundAgentId (org-mcp tenant key)
  mandate             json,
  milestoneTemplate   json,
  validatorRequirements json,
  reportingCadence    enum,
  deadline            timestamp,
  decisionDate        timestamp,
  requiredCredentials string[],
  visibility          enum('public','private'),
  addressedApplicants string[] nullable,
  proposalsReceived   integer,
  onChainAssertionId  IRI,
  createdAt, updatedAt
}
```

**Delegation gates.**
- `round:create`, `round:close`, `round:author_addressed_list` — fund's stewards.
- `round:read_self` — public; private rounds use `round:read_addressed_list` cross-delegation.
- `round:increment_proposals_received` — system delegation issued by the fund's org-mcp to itself (or scoped to the proposal-submission flow), so a proposal's submit tool can bump the counter atomically.

**Consolidation alignment.** Net new table in org-mcp. New on-chain assertion class + sync emitter. No backwards-compat.

---

### 2.5 `Pool` extensions (spec 002 + 003)

`Pool` is **already** a first-class on-chain agent (it's an `sa:OrgAgent` with `governanceModel`). The new properties below extend the existing pool agent metadata; they live where the pool's profile lives.

| Property | Tier | Body store | On-chain anchor | GraphDB |
|---|---|---|---|---|
| `acceptedUnits: string[]` | public | fund's org-mcp + on-chain agent metadata | yes (extends the existing pool-agent metadata mint) | yes |
| `ceilingPolicy: 'block' \| 'waitlist' \| 'accept'` | public | same | yes | yes |
| `capacityCeiling: number?` | public | same | yes | yes |
| `acceptsOpenCalls: boolean` | public | same | yes | yes |
| `pledgedTotal: number` (derived) | public | fund's org-mcp aggregate (see § 2.2) | aggregate-assertion when public; otherwise stays in org-mcp | yes only when public-aggregate-assertion fires |
| `addressedMembers: IRI[]` (private pools only) | private | fund's org-mcp only | **no** | no |

These are simple agent-profile extensions — same pattern the project already uses for `sa:OrgProfile` public fields. The new wire-up is in the pool-agent emitter (`apps/web/src/lib/ontology/sync.ts`) plus the org-mcp's pool-profile table.

**Recommended rename for clarity (§ 5):** `Pool` and `Fund` are not separate classes today; spec 002 says a Pool's `governanceModel` includes `fund`. This is fine for the ontology. But the IA map should make it explicit that `Fund` is "Pool with governanceModel=fund" — not a sibling class. See open question O3 below.

---

## 3. Cross-cutting decisions

### 3.1 Privacy tiers cascading to artifacts

Spec 001 already gates sensitive intents (FR-004, FR-011, FR-020). The cascade rule for derived artifacts is:

> An artifact derived from N source intents/pools/rounds inherits **the strictest visibility** across them. The artifact's body lives in the initiator/donor/proposer's MCP regardless of tier; only the *anchor + GraphDB mirror* are tier-gated.

This rule mechanizes section 2's per-entity tables. The ontologist may codify it as a SHACL shape: `?artifact sa:visibility ?v . FILTER (?v = strictestOf(sourceTierSet))`.

### 3.2 Connector-mode does not leak

For connector-initiated `MatchInitiation`s (spec 001 Q1):
- The connector's MCP holds the row; that row contains only IDs and the basis snapshot. No copies of the two intents' bodies.
- The two intent expressers are notified via the standard `notifications:create` system-delegation pattern (no PII embedded — just an IRI reference and a "you have a new MatchInitiation referencing your intent" note).
- The connector's MCP does **not** acquire ongoing read access to either intent — the connector's read at proposal time was through their existing visibility (public intents are readable to anyone; private intents are readable only to credentialed agents per FR-011).

### 3.3 Private pool pledges & anonymous donors

Detailed in § 2.2. The non-obvious bit: **for `storyPermissions=anonymous`, the donor's identity must never appear in any public store, including on-chain.** This means the contribution to the pool's `pledgedTotal` must be aggregated by the *pool* (not the donor) before being published. Implementation: the pool's org-mcp holds an aggregate counter; when a private pledge is submitted, the donor's MCP issues a one-shot system-delegation to the pool's org-mcp to increment the counter. Only the aggregate is later mirrored to GraphDB.

### 3.4 Proposal artifacts as confidential

Detailed in § 2.3. Proposal bodies do not leave the proposer's MCP. Stewards read via cross-delegation at submit time. **No IRI** of a `ProposalSubmission` ever appears in GraphDB until/unless the downstream review/award spec mints a public award assertion that references it.

### 3.5 Round metadata is public

Detailed in § 2.4. Rounds are RFPs. Anchored on-chain by the fund's session signer at creation; GraphDB mirrors via the existing sync. Private rounds (with `addressedApplicants`) anchor a coarse assertion plus a private addressee list in fund's org-mcp.

### 3.6 Fund extensions (`acceptsOpenCalls` etc.)

Detailed in § 2.5. Public agent-profile fields. Existing pattern.

### 3.7 On-chain footprint — should any of these mint?

Plans say no smart-contract changes. **Confirm:** none of these need a new contract. They can all use the existing **assertion** primitive on `AgentAssertion`:

- `MatchInitiationAssertion` — a new assertion subclass; metadata-only; no special contract logic needed.
- `PledgeAssertion` (donor → pool) and `PoolPledgedTotalAssertion` (pool aggregate) — same.
- `RoundOpenedAssertion`, `RoundClosedAssertion` — same.

For non-repudiation, anchoring in the existing assertion contract is enough — the chain provides ordering, signer identity, and immutability. No new ABI.

**Open question O7:** Do connector-initiated `MatchInitiation`s warrant a *stronger* on-chain footprint (e.g., a separate event class so it's easy to detect "agent X is acting as a connector for these two parties")? IA recommendation: **no, not in v1.** The assertion's `initiationKind` field carries the discriminator. Surface it to the Ontologist for confirmation.

### 3.8 Delegation/entitlement reads

Spec 002 talks about steward views of pool pledges. Spec 003 talks about steward views of proposals. Both reduce to:

> The artifact body lives in the contributor's MCP. The receiver (pool steward / round steward) reads via a **scoped, time-bound cross-delegation** issued by the contributor at submit time. Anonymous contributions issue no such delegation; receivers see only the aggregate.

Implementation primitives already exist: cross-principal delegation in person-mcp / org-mcp ([01-principles.md P5](01-principles.md#p5-access-invariants-read--write)). New delegation scopes:

- `pool:read_pledge` (issued by donor to pool's org-mcp; scope: one pool)
- `pool:contribute_to_total` (issued by donor to pool's org-mcp on private pledges)
- `proposal:read_for_review` (issued by proposer to fund's org-mcp; scope: one round or one fund)
- `match_initiation:read_referenced` (derived authority — the intent expresser already has authority to read initiations referencing their intent; no new scope)

Security agent must add these scopes to the catalog before tools land.

### 3.9 Term consistency audit

See § 5.

### 3.10 Cross-lane invariants

#### FR-023 of spec 003 — withdrawal reverts intent only if no other live acknowledgements

The check requires answering "do any *other* live acknowledgements exist for this intent?" Live acknowledgements include:
- spec 001's `MatchInitiation` with `status='pending'` against this intent (either side).
- spec 003's `ProposalSubmission` with `status='submitted'` whose `basedOnIntentId == thisIntent`.
- (future) other spec acknowledgement surfaces.

Under the proposed split:
- **Public-tier** initiations / submissions can be queried via GraphDB (anchored on-chain → mirrored). For these, FR-023 is a single SPARQL `EXISTS`.
- **Private-tier** initiations / submissions are not in GraphDB. The check has to query each MCP that *might* hold a live acknowledgement.

For v1, the right scope is:
- The intent owner's MCP holds the canonical "is this intent acknowledged" status. The *acknowledger* (initiator / proposer) sends a notification at acknowledgement time that bumps a counter on the intent in the owner's MCP: `intent.liveAcknowledgementCount += 1` on creation; `-= 1` on withdraw/supersede/consume.
- FR-023's "other live acknowledgements?" check then becomes a single read of the owner's MCP intent row: `liveAcknowledgementCount > 1` (i.e., more than just this one).

This avoids a fan-out query across every MCP and respects owner-routing — the owner's MCP is authoritative for "is my intent live-acknowledged."

**Implementation note for the developer:** add a `liveAcknowledgementCount: integer` column to the existing `intents` table in person-mcp and org-mcp. On `MatchInitiation.create`, the initiator's MCP sends a system-delegation `intent:bump_ack_count` notification to *each* of the two intent owners' MCPs. On `MatchInitiation.withdraw`/`supersede`/`consume`, decrement. Same for `ProposalSubmission.submit` and `withdraw`. The intent's `status` transition `expressed → acknowledged` happens when `liveAcknowledgementCount == 1`; reverting `acknowledged → expressed` happens when it hits zero.

This ack-count pattern is **a new IA primitive** — flag for ontologist (a property `sa:liveAcknowledgementCount` may want T-Box codification, or it can stay implementation-only). See open question O5.

---

## 4. Map additions (companion to [02-data-ownership-map.md](02-data-ownership-map.md))

The canonical map is updated in place. The new rows landing in section "B. Person-Owned Private Data", "C. Org-Owned Private Data", "F. Marketplace / Discovery", and a new section "K. Intent Marketplace Artifacts" are listed in the diff applied to that file.

---

## 5. Recommended renames / consistency edits

The Ontologist consumes this list to codify T-Box terms. **No spec-file edits applied here** — these are recommendations the user/orchestrator approves before any rename lands.

| Current name | Recommended name | Rationale |
|---|---|---|
| `initiatorAgentId` (spec 001) | `initiatorAgent` (IRI) | The `Id` suffix is JS-conventional; ontology uses IRI references. **Implementation-side**: keep `initiatorAgentId` in TypeScript types; **ontology-side** map to `sa:initiator` predicate (no `Id`). Same for every `*AgentId` field below. |
| `pledgerAgentId` (spec 002) | `sa:pledger` | Predicate, IRI-typed. |
| `poolAgentId` (spec 002) | `sa:targetPool` | "Pool" is the noun, not "PoolAgent" (Pool already implies agent — see O3). |
| `proposerAgentId` (spec 003) | `sa:proposer` | Same. |
| `fundAgentId` (spec 003) | `sa:operatedByFund` | Disambiguates from steward agent; emphasises the relation. |
| `fundMandateId` (spec 003) | `sa:fundMandate` (IRI to a Pool-with-governanceModel=fund) | Avoids implying a separate "Mandate" entity. |
| `viewedIntentId` / `candidateIntentId` (spec 001) | `sa:viewedIntent` / `sa:candidateIntent` | IRI predicates. |
| `basedOnIntentId` (spec 003) | `sa:basedOnIntent` | Same. |
| `clonedFromProposalId` (spec 003) | `sa:clonedFromProposal` | Same. |
| `MatchInitiation` (spec 001) | `sa:MatchInitiation` | Class name OK; bind to T-Box. |
| `PoolPledge` (spec 002) | `sa:PoolPledge` | Class name OK. |
| `ProposalSubmission` (spec 003) | `sa:ProposalSubmission` | Distinguishes from existing `sa:Proposal` (governance-vote proposal). See O1 below. |
| `Round` (spec 003) | `sa:Round` (subClassOf `prov:Plan`) | OK. |
| `acceptedUnits: string[]` (Pool) | `sa:acceptsUnit` (multi-valued predicate) | Plan already says this — confirm. |
| `ceilingPolicy` (Pool) | `sa:ceilingPolicy` with C-Box vocab `sa:CeilingPolicyBlock` etc. | C-Box enumeration, not a string. |
| `storyPermissions` (PoolPledge) | `sa:storyPermissions` with C-Box vocab | C-Box enumeration. |
| `cadence` (PoolPledge) | `sa:pledgeCadence` with C-Box vocab | Disambiguates from reporting-cadence. |
| `reportingObligations.cadence` (Proposal) | `sa:reportingCadence` | Same disambiguation. |

**Inconsistency flagged:** `principal` in MCP tables (an existing convention — primary key of an MCP-owned row) is used inconsistently. In person-mcp it's the person's IRI; in org-mcp it's `org_principal`. The new tables introduced here keep the same convention. **No rename recommended** — but the developer must use `principal` in person-mcp and `org_principal` in org-mcp consistently with the existing schema.

**Cross-spec — should `Pool` be merged into a single `Pool`/`Fund` class?** See O3.

---

## 6. Open questions for the Ontologist

| ID | Question | IA recommendation | Reason it's not closed at IA layer |
|---|---|---|---|
| O1 | The on-chain `sa:Proposal` class today refers to **governance-vote proposals** (org-mcp's `proposals` table). Spec 003's `ProposalSubmission` is a **grant-cycle proposal**. They share a noun but not a meaning. Should `ProposalSubmission` be renamed at the T-Box level (e.g., `sa:GrantProposal`)? | Yes — `sa:GrantProposal` (subClassOf `prov:Plan`) is clearer than `sa:ProposalSubmission`. The "Submission" word in the type name is redundant with the lifecycle field `submittedAt`. | Naming a T-Box class is the Ontologist's call, not IA's. |
| O2 | `MatchInitiation` and `PoolPledge` cross multiple visibility tiers within a single class (public when both source intents are public; private otherwise). Is the right model **one class with a tier predicate**, or **two subclasses** (`PublicMatchInitiation` / `PrivateMatchInitiation`)? | One class with `sa:visibility` predicate. Same pattern `sa:Intent` already uses. | T-Box subClass-vs-property-tier choice is Ontologist territory. |
| O3 | Spec 002 conflates "Pool" and "Fund" (a Fund is a Pool with `governanceModel: 'fund'`). Spec 003 refers to "Fund" as if it's a separate class. Should the ontology have `sa:Fund` as a subclass of `sa:Pool`, or just keep `sa:Pool` with a property? | `sa:Fund subClassOf sa:Pool`, with the SHACL shape `sa:Fund -> sa:governanceModel sa:GovernanceModelFund`. Makes the class hierarchy match how specs 002/003 talk. | Class-vs-property-as-discriminator is an Ontologist judgment call. |
| O4 | The `basis: RankBasis` snapshot is a JSON literal embedded in the artifact. Is that the right shape, or should each `RankBasis` field have its own predicate? | Keep as JSON literal for v1 (a row's basis is opaque to SPARQL — only the artifact-owning code reads it). If we ever want to query "all initiations whose basis included a 1-hop proximity," promote to predicates later. | Querying-vs-opacity tradeoff; Ontologist owns the call. |
| O5 | Do we want a T-Box predicate `sa:liveAcknowledgementCount` on `sa:Intent`, or keep this as MCP-implementation-only and not codify? | Keep implementation-only for v1. The count is a derived integer; ontology can express "intent has acknowledgement A" via inverse predicates from each acknowledger class. | T-Box vs. implementation boundary. |
| O6 | Should `MatchInitiation.status` `'superseded' \| 'consumed'` be a C-Box vocabulary or just an enum string? Same for `PoolPledge.status` (5 values), `ProposalSubmission.status` (5 values). | C-Box for all three. Lifecycle states are exactly what C-Box is for. Suggest `sa:MatchInitiationStatusPending` etc. | Stylistic Ontologist preference. |
| O7 | Connector-initiated `MatchInitiation`s — do they warrant a separate on-chain event class for easier indexing? | No. The `initiationKind` predicate on the assertion is enough; SPARQL filters cleanly. | Final on-chain event taxonomy is Ontologist + Developer's domain. |
| O8 | `storyPermissions: 'public' \| 'shareWithSupportTeam' \| 'anonymous'` overlaps semantically with `sa:visibility: 'public' \| 'public-coarse' \| 'private'`. They're not the same, but they cascade. Should the ontology express the cascade as a SHACL rule, or leave it to enforcement code? | SHACL rule. The cascade is load-bearing for privacy and should be machine-checked. | SHACL authoring is Ontologist work. |
| O9 | The `liveAcknowledgementCount` pattern coordinates intent state across MCPs via system-delegation increments. Is there a cleaner pattern (e.g., the intent's MCP queries acknowledgers on demand)? | The increment-via-notification is right for v1. On-demand queries fan out across many MCPs and require a registry of "who might hold an acknowledgement." Pre-incremented counter is simpler and idempotent if writes are tagged with an acknowledgement-id. | This is technically an Architect/Developer call, not Ontologist — surfacing here for visibility. |
| O10 | The `MatchInitiation` row is owned by the *initiator*. In connector mode, this means the connector's MCP holds an artifact whose two referents (the two intent expressers) cannot read directly without their own mechanism. We propose notification-only (the intent owners are pinged but cannot read the connector's MCP). Is that acceptable for the Ontologist's "data follows owner" principle, or should the artifact be *replicated* into the two expressers' MCPs? | Notification-only. Replication breaks no-duplication (P4). The artifact has one owner (the connector); the two intent expressers' authority is over their *own* intents, not the artifact. | Owner-routing edge case — surfaced for explicit ratification. |

---

## 7. Acceptance checklist (for the Phase-N PR introducing these features)

The Reviewer enforces these on every PR that touches specs 001/002/003 implementation:

- [ ] No table named `match_initiations`, `pool_pledges`, or `proposal_submissions` exists in `apps/web/src/db/schema.ts`. (All bodies live in MCPs.)
- [ ] No code path in any MCP imports a GraphDB client. (No MCP→GraphDB writes.)
- [ ] No code path in `apps/web/src/lib/ontology/sync.ts` reads from any MCP DB. (GraphDB sync stays on-chain-only.)
- [ ] Each new MCP tool has an explicit Security-approved delegation scope from the catalog updated for this feature.
- [ ] On-chain assertion emit paths exist for: `MatchInitiationAssertion` (when both source intents are public), `PledgeAssertion` (when pool is public AND `storyPermissions=public`), `PoolPledgedTotalAssertion` (pool aggregate, no donor IRI), `RoundOpenedAssertion`, `RoundClosedAssertion`. **No** assertion path for `ProposalSubmission` in v1.
- [ ] `fresh-start.sh` `WIPE_PATHS` covers any new SQLite paths (no new files expected — the new tables go into existing person-mcp / org-mcp DBs).
- [ ] Connector-mode `MatchInitiation` does not embed copies of the two intents' bodies — only IDs.
- [ ] Anonymous `PoolPledge` writes do **not** anchor on-chain. A test asserts this for `storyPermissions=anonymous`.
- [ ] `liveAcknowledgementCount` increments on `MatchInitiation.create` and `ProposalSubmission.submit`; decrements on withdraw/supersede/consume.
- [ ] `intent.status` transition `expressed→acknowledged` fires only when `liveAcknowledgementCount == 1` (not on every increment); revert `acknowledged→expressed` only when count hits zero.
- [ ] No new helpers named `publishProjection`, `mirrorToGraphDb`, etc. (P4 enforcement.)

---

## 8. What's *not* changing

To make the diff legible: the existing IA invariants in [01-principles.md](01-principles.md) through [07-build-plan.md](07-build-plan.md) are unchanged. The intent-marketplace specs slot into the existing four-layer model. No new MCP, no new contract, no new GraphDB writer, no new auth pattern — every primitive used here already exists. The only new IA-layer concept is `liveAcknowledgementCount` on intents (a derived counter, not a new table).
