# Intent Marketplace — Ontology Audit

**Scope.** Codification of T-Box terms for specs 001 / 002 / 003 (intent marketplace: discovery, pool, proposal lanes), per the Information Architect's classification doc at `docs/information-architecture/10-intent-marketplace-classification.md`.

This file is the canonical audit record produced by the Ontologist. It accompanies the per-lane T-Box files and the SHACL visibility cascade. It is the place to look when you need to know: *why* a term is named what it's named, *which* of the IA's open questions drove a given decision, and *what* still needs follow-up.

**Companion artifacts**
- IA decisions: `docs/information-architecture/10-intent-marketplace-classification.md` (read-only input)
- Per-lane T-Box: `docs/ontology/tbox/matches.ttl`, `docs/ontology/tbox/pool-pledge.ttl`, `docs/ontology/tbox/proposal.ttl`
- SHACL cascade: `docs/ontology/tbox/shacl/visibility.ttl`
- C-Box concepts: `docs/ontology/cbox/controlled-vocabularies.ttl` (extended)

---

## 1. What was added

### 1.1 T-Box files

| File | Status | Net additions |
|---|---|---|
| `docs/ontology/tbox/matches.ttl` | EXTENDED | +2 classes (`sa:MatchInitiation`, `sa:MatchInitiationAssertion`), +9 properties (`sa:initiator`, `sa:viewedIntent`, `sa:candidateIntent`, `sa:initiationKind`, `sa:proposedAt`, `sa:basis`, `sa:status`, `sa:visibility`, `sa:onChainAssertionId`), +2 enum classes (`sa:MatchInitiationKind`, `sa:MatchInitiationStatus`), +2 alignments to `samatch:NeedResourceMatch` and `hub:IntentMatch` |
| `docs/ontology/tbox/pool-pledge.ttl` | NEW | +5 classes (`sa:Pool`, `sa:Fund`, `sa:PoolPledge`, `sa:PledgeAssertion`, `sa:PoolPledgedTotalAssertion`, `sa:PledgeAmendment` documentation-only), +18 properties (Pool extensions + Pledge body), +4 enum classes (`sa:CeilingPolicy`, `sa:PledgeCadence`, `sa:PledgePoolStatus`, `sa:StoryPermission`) |
| `docs/ontology/tbox/proposal.ttl` | NEW | +4 classes (`sa:Round`, `sa:RoundOpenedAssertion`, `sa:RoundClosedAssertion`, `sa:GrantProposal`), +20 properties (Round + GrantProposal body), +2 enum classes (`sa:GrantProposalStatus`, `sa:ReportingCadence`) |
| `docs/ontology/tbox/shacl/visibility.ttl` | NEW | +6 SHACL NodeShapes (anonymous-no-anchor, private-pool-no-anchor, grant-proposal-always-private, private-intent-no-anchor, fund-governance-model-consistency, match-initiation-opposite-directions) |
| `docs/ontology/tbox/intents.ttl` | EXTENDED | +1 property (`saint:visibility`), the source of the visibility cascade |

### 1.2 C-Box files

| File | Status | Net additions |
|---|---|---|
| `docs/ontology/cbox/controlled-vocabularies.ttl` | EXTENDED | +8 concept schemes, +28 concept individuals across MatchInitiationKind / MatchInitiationStatus / CeilingPolicy / PledgeCadence / PledgePoolStatus / StoryPermission / GrantProposalStatus / ReportingCadence |

### 1.3 Counts

- **New classes**: 17
- **New object/datatype properties**: 47
- **New SKOS concept individuals**: 28
- **New SHACL shapes**: 6
- **Files written**: 3 new (`pool-pledge.ttl`, `proposal.ttl`, `shacl/visibility.ttl`); 3 extended (`matches.ttl`, `intents.ttl`, `controlled-vocabularies.ttl`).

---

## 2. Resolution of the IA's 10 open questions

| # | Question | Resolution | Where codified |
|---|---|---|---|
| **O1** | Should `ProposalSubmission` rename to avoid collision with on-chain governance `sa:Proposal`? | **YES — RENAMED to `sa:GrantProposal`.** The existing `sag:Proposal` (in `tbox/governance.ttl`) refers to governance-vote proposals; reusing the name would conflate two unrelated concepts. The "Submission" suffix is redundant with the lifecycle field `sa:proposalSubmittedAt` — submission is an event, not a class. **Spec / SDK keep `ProposalSubmission`** at the TS level; the rename is T-Box-only. | `tbox/proposal.ttl` (class declaration + prologue note) |
| **O2** | One class with tier predicate, or subclasses (`PublicMatchInitiation` / `PrivateMatchInitiation`)? | **One class with `sa:visibility` predicate.** Mirrors the existing pattern on `saint:Intent`. Subclassing on tier creates open-world brittleness (an artifact's tier can change derivatively if a source intent changes). | `tbox/matches.ttl` (class declaration + prologue note) |
| **O3** | `sa:Fund` as subclass of `sa:Pool` vs. property-as-discriminator? | **BOTH.** `sa:Fund rdfs:subClassOf sa:Pool` for class-hierarchy ergonomics (specs 002/003 talk about Fund as a class); SHACL `FundGovernanceModelConsistencyShape` enforces that `sa:Fund` instances also carry `sa:governanceModel "fund"` for the operational discriminator the SDK reads. The two views are consistent, not redundant. | `tbox/pool-pledge.ttl` (class declaration), `tbox/shacl/visibility.ttl` (consistency shape) |
| **O4** | `basis: RankBasis` as JSON literal or per-field predicates? | **JSON literal for v1** (`xsd:string`). RankBasis is opaque to SPARQL by design; it is read by the artifact-owning code as a snapshot, not as queryable triples. Promote individual fields to predicates only when SPARQL needs to filter on them (e.g., "all initiations with proximityHops <= 1" — not currently in scope). | `tbox/matches.ttl` (`sa:basis` property + comment) |
| **O5** | T-Box-codify `sa:liveAcknowledgementCount` on `sa:Intent`, or keep implementation-only? | **Keep implementation-only.** A derived integer maintained in MCP rows by system-delegation increments. The ontology already expresses "intent has an acknowledgement A" via the inverse predicates `sa:viewedIntent` / `sa:candidateIntent` / `sa:basedOnIntent`. Codifying the counter would freeze an implementation detail (the increment-via-notification mechanism) into the T-Box. Revisit if an external query needs the counter. | `tbox/pool-pledge.ttl` prologue (explicit non-codification note) |
| **O6** | Status / cadence / permission values as C-Box vocabulary or enum strings? | **C-Box for ALL of them.** Lifecycle states are exactly what C-Box is for. Keeps the ontology's "if it has skos:notation, it's C-Box" rule clean (per `docs/agents/ontologist.md`). | `tbox/matches.ttl` + `tbox/pool-pledge.ttl` + `tbox/proposal.ttl` declare the value-set classes; `cbox/controlled-vocabularies.ttl` declares the 28 concept individuals across 8 schemes |
| **O7** | Connector-initiated `MatchInitiation`s — separate on-chain event class? | **NO.** Single `sa:MatchInitiationAssertion` class on chain. The `sa:initiationKind` discriminator (self / connector) carries the distinction; SPARQL filters cleanly on it. Adding a separate event class would multiply on-chain ABI surface for no information gain. | `tbox/matches.ttl` (class declaration + prologue note) |
| **O8** | Visibility cascade as SHACL or enforcement-code-only? | **SHACL** (`tbox/shacl/visibility.ttl`). The cascade is load-bearing for privacy and must be machine-checked. Pure SHACL cannot express "strictest of N source tiers" cross-property comparison, so we encode the *necessary consequences* (anonymous-no-anchor, private-pool-no-anchor, grant-proposal-no-anchor, private-intent-no-anchor) as SHACL-SPARQL shapes; the strictest-of computation stays at the action layer. | `tbox/shacl/visibility.ttl` |
| **O9** | Cleaner pattern than `liveAcknowledgementCount` increment-via-notification? | **Increment-via-notification stays for v1.** The IA notes this is technically an Architect/Developer call, not Ontologist. Surfaced here for visibility; ontology-side, the point is that we did NOT codify the count (see O5), so any pattern change is implementation-side and does not break the T-Box. | (no T-Box change required) |
| **O10** | Connector-mode `MatchInitiation` — replicated to intent expressers' MCPs, or notification-only? | **Notification-only.** Replication breaks no-duplication (P4 in `01-principles.md`). The artifact has one owner (the connector); the two intent expressers have authority over their own intents, not the artifact. The `sa:initiator` property is `owl:FunctionalProperty` — exactly one initiator per artifact. | `tbox/matches.ttl` (`sa:initiator` is functional + prologue note) |

---

## 3. The 17 renames (§5 of IA doc)

All 17 recommendations applied at the T-Box / C-Box level. **Spec files and TypeScript types are unchanged** per IA's explicit instruction.

| # | Spec name (kept in TS) | T-Box predicate / class (applied) | File where applied |
|---|---|---|---|
| 1 | `initiatorAgentId` | `sa:initiator` | `tbox/matches.ttl` |
| 2 | `pledgerAgentId` | `sa:pledger` | `tbox/pool-pledge.ttl` |
| 3 | `poolAgentId` | `sa:targetPool` | `tbox/pool-pledge.ttl` |
| 4 | `proposerAgentId` | `sa:proposer` | `tbox/proposal.ttl` |
| 5 | `fundAgentId` | `sa:operatedByFund` | `tbox/proposal.ttl` |
| 6 | `fundMandateId` | `sa:fundMandate` (range `sa:Fund`, no separate Mandate class) | `tbox/proposal.ttl` |
| 7 | `viewedIntentId` / `candidateIntentId` | `sa:viewedIntent` / `sa:candidateIntent` | `tbox/matches.ttl` |
| 8 | `basedOnIntentId` | `sa:basedOnIntent` | `tbox/proposal.ttl` |
| 9 | `clonedFromProposalId` | `sa:clonedFromProposal` | `tbox/proposal.ttl` |
| 10 | `MatchInitiation` | `sa:MatchInitiation` | `tbox/matches.ttl` |
| 11 | `PoolPledge` | `sa:PoolPledge` | `tbox/pool-pledge.ttl` |
| 12 | `ProposalSubmission` | `sa:GrantProposal` (per O1) | `tbox/proposal.ttl` |
| 13 | `Round` | `sa:Round` (subClassOf `prov:Plan`, `p-plan:Plan`) | `tbox/proposal.ttl` |
| 14 | `acceptedUnits: string[]` | `sa:acceptsUnit` (multi-valued predicate) | `tbox/pool-pledge.ttl` |
| 15 | `ceilingPolicy` | `sa:ceilingPolicy` (range `sa:CeilingPolicy` C-Box vocab) | `tbox/pool-pledge.ttl` + `cbox/controlled-vocabularies.ttl` |
| 16 | `storyPermissions` | `sa:storyPermissions` (range `sa:StoryPermission` C-Box vocab) | `tbox/pool-pledge.ttl` + `cbox/controlled-vocabularies.ttl` |
| 17 | `cadence` (PoolPledge) | `sa:pledgeCadence` (range `sa:PledgeCadence`); + `sa:reportingCadence` (range `sa:ReportingCadence`) on `sa:Round` | `tbox/pool-pledge.ttl` + `tbox/proposal.ttl` + `cbox/controlled-vocabularies.ttl` |

**Files modified by renames**: only the three new lane files plus C-Box. No legacy T-Box file carried any of the old `*Id` predicates — they were spec-level TypeScript names that never crossed into the ontology, so no legacy renames were needed.

---

## 4. Cross-ontology audit findings

### 4.1 Findings (terminological)

| # | Finding | Severity | Action |
|---|---|---|---|
| F1 | `saint:Intent` had no codified `visibility` predicate, despite the spec data-model assuming one and the visibility-cascade SHACL needing it. | High | **Fixed** — added `saint:visibility` to `tbox/intents.ttl` (range `sageo:Visibility`). |
| F2 | `sa:Pool` did not exist as a class; pool agents were typed only as generic `sa:OrganizationAgent`. The new lane work needed a typed home for pool-specific properties. | High | **Fixed** — added `sa:Pool subClassOf sa:OrganizationAgent` and `sa:Fund subClassOf sa:Pool` in `tbox/pool-pledge.ttl`. |
| F3 | The on-chain `sag:Proposal` (governance-vote) and the spec's `ProposalSubmission` (grant) shared a noun. Without rename, T-Box would gain two `Proposal` classes whose semantics differ. | High | **Fixed** — applied O1 rename: spec's `ProposalSubmission` is T-Box `sa:GrantProposal`. `sag:Proposal` keeps its governance-vote meaning. |
| F4 | The IA-recommended cadence rename (`pledgeCadence` vs. `reportingCadence`) was needed because both PoolPledge and GrantProposal carry a `cadence` field with different value-sets. | Medium | **Fixed** — `sa:pledgeCadence` (PoolPledge) ranges over `sa:PledgeCadence`; `sa:reportingCadence` (Round) ranges over `sa:ReportingCadence`. Different SKOS schemes, no overlap. |
| F5 | Existing `samatch:NeedResourceMatch`, `samatch:matchScore`, `saint:IntentMatch` overlap conceptually with the new `sa:MatchInitiation`. They are NOT the same — `MatchInitiation` is the *act of proposing*; `IntentMatch` / `NeedResourceMatch` are *durable matched pairs* (post-acceptance). | Medium | **Fixed** — `sa:MatchInitiation` carries `skos:relatedMatch hub:IntentMatch` and `skos:relatedMatch samatch:NeedResourceMatch` to record the relation, with prologue notes clarifying the distinction. |
| F6 | `samatch:matchStatus` ranges over a generic `skos:Concept` — no value-set declared. The new `sa:status` on `MatchInitiation` is similarly generic. The IA's O6 closes this for the new artifacts; the legacy `samatch:matchStatus` remains weakly typed. | Low (legacy) | **Recommended for future work**: tighten `samatch:matchStatus` range to a declared value-set class. Out of scope for this initiative. |
| F7 | Many existing T-Box files use long-form local prefixes (`samatch:`, `saint:`, `saoffer:`) per-domain, while the new files use the global `sa:` prefix for marketplace-lifecycle additions. | Low (style) | **Accepted as-is**. The new artifacts (MatchInitiation, PoolPledge, GrantProposal) belong to the cross-cutting marketplace surface, not a single sub-ontology. Using `sa:` for them mirrors core agent properties (`sa:Agent`, `sa:Pool`). The long-form prefixes remain canonical for their sub-ontologies. |
| F8 | The existing `samatch:DiscoverActivity` and the new `sa:MatchInitiation` both touch the "candidate generation" surface. `DiscoverActivity` is the *prov:Activity that generated the matches*; `MatchInitiation` is the *artifact resulting from a user's choice to act on a candidate*. | Low (clarity) | **Accepted as-is**. Documented in `tbox/matches.ttl` prologue: DiscoverActivity → NeedResourceMatch (proposed); MatchInitiation → IntentMatch (taken-up pair). |
| F9 | `prov:wasAssociatedWith` was used as the parent property for `sa:initiator`, `sa:pledger`, `sa:proposer`. Consistency-checked. | OK | All three artifact-author predicates subclass `prov:wasAssociatedWith`. |
| F10 | `prov:generatedAtTime` was used as the parent for `sa:proposedAt`, `sa:pledgedAt`, `sa:proposalSubmittedAt`. Consistency-checked. | OK | All three creation timestamps subclass `prov:generatedAtTime`. |

### 4.2 Top-3 most consequential findings

1. **F3 (Proposal class naming collision).** Without the rename, future developers reading `tbox/governance.ttl` would have found governance proposals and reading `tbox/proposal.ttl` would have found grant proposals; SPARQL queries would need to filter on subclass to disambiguate. The rename costs zero (T-Box-only) and prevents a permanent footgun.

2. **F2 (Pool was not typed).** The marketplace-lifecycle ontology already had `hub:RecipientIntent` etc., but no Pool class existed despite Pool being a first-class on-chain agent in the SDK and across both specs 002 and 003. Adding `sa:Pool subClassOf sa:OrganizationAgent` (with `sa:Fund subClassOf sa:Pool`) gives the new properties a well-typed domain and lets SPARQL queries filter on agent kind cleanly.

3. **F1 (Intent visibility was not codified).** The visibility cascade is the load-bearing privacy invariant for the entire intent-marketplace surface. Without `saint:visibility` being a real predicate, the SHACL cascade rules cannot reference it. Fixing this also documents the existing `sageo:Visibility` value-set as the canonical visibility vocabulary across all artifacts.

---

## 5. SHACL rules added

`docs/ontology/tbox/shacl/visibility.ttl` defines six shapes:

| Shape | Targets | Enforces |
|---|---|---|
| `sa:AnonymousPledgeNoAnchorShape` | `sa:PoolPledge` | Pledges with `storyPermissions = anonymous` MUST NOT carry `sa:onChainAssertionId`. The donor's identity must never appear in any public store, including on-chain (transactions reveal signer addresses, which are publicly linked to agent IRIs). |
| `sa:PrivatePoolPledgeNoAnchorShape` | `sa:PoolPledge` | Pledges to non-public-tier pools MUST NOT carry an on-chain anchor. |
| `sa:GrantProposalAlwaysPrivateShape` | `sa:GrantProposal` | A GrantProposal MUST NOT carry `sa:onChainAssertionId` in v1. The downstream review/award spec MAY add an awarded-outcome anchor; not in this spec's scope. |
| `sa:PrivateIntentInitiationNoAnchorShape` | `sa:MatchInitiation` | A MatchInitiation referencing any non-public intent MUST NOT carry an on-chain anchor. A private intent's IRI must never appear in a public triple. |
| `sa:FundGovernanceModelConsistencyShape` | `sa:Fund` | `sa:Fund` instances MUST carry `sa:governanceModel "fund"`. Resolves O3 — preserves SDK property-as-discriminator alongside class-subsumption. |
| `sa:MatchInitiationOppositeDirectionsShape` | `sa:MatchInitiation` | `viewedIntent.direction` and `candidateIntent.direction` MUST be opposite. Enforces the spec-001 invariant in SHACL-SPARQL. |

**What SHACL does NOT enforce here** (cross-property "strictest-of" computation): the action layer computes the strictest visibility tier across N source intents/pools/rounds at write time. SHACL cannot express that cleanly and we did not try; the *consequences* of getting it wrong (anchoring something that should not anchor) are the SHACL-checked violations.

---

## 6. Disagreements with the spec (for spec-author follow-up)

Per the user's working note: when a spec name contradicts a more correct ontology choice, the ontology wins; record the disagreement here so the user knows the spec needs a follow-up.

| Spec / artifact | Spec says | T-Box says | Why |
|---|---|---|---|
| spec 003 | `ProposalSubmission` | `sa:GrantProposal` | Naming collision with `sag:Proposal` (governance-vote). Spec / SDK keep their name; ontology disambiguates. The IA explicitly approved this asymmetry. |
| spec 003 | `fundMandateId` (looks like a separate Mandate entity) | `sa:fundMandate` ranges over `sa:Fund` directly | There is no separate Mandate entity; the Fund IS the mandate-bearer. IA § 5 anticipated this. |
| spec 002 | `cadence` field is reused on PoolPledge and inside ReportingObligations on Proposal | `sa:pledgeCadence` (PoolPledge) and `sa:reportingCadence` (Round) are distinct predicates ranging over distinct schemes | The two have different value-sets (one-time/monthly/annual vs. quarterly/milestone/annual/none); same name in JSON would be a footgun. |

These are not bugs — they are deliberate T-Box choices that the IA endorsed. Spec authors do not need to update spec files; if/when the specs migrate to use the canonical ontology vocabulary directly (e.g., for SPARQL results), they will reference the T-Box names.

---

## 7. Sync to GraphDB (follow-up task)

After the T-Box edits land, the project's "Ontology Pipeline" calls for syncing to the GraphDB SmartAgents repo (per `docs/agents/ontologist.md`).

**This audit does NOT perform the sync.** That is a follow-up task. Likely command (verify with infra/orchestrator before running):

```bash
# Upload T-Box and SHACL to GraphDB ontology graph
# (named graph: https://smartagent.io/graph/ontology)
# Refer to apps/web/src/lib/ontology/sync.ts or the GraphDB Workbench
# REST UI for the canonical upload path.
```

Validation queries (run after sync) — see `docs/agents/ontologist.md` § "SPARQL Validation Queries" for the agent-count and edge-count checks. For this initiative specifically, expect:

```sparql
# Count new classes
SELECT (COUNT(?c) AS ?count) WHERE {
  GRAPH <https://smartagent.io/graph/ontology> {
    ?c a owl:Class .
    FILTER(?c IN (sa:MatchInitiation, sa:PoolPledge, sa:GrantProposal, sa:Round,
                  sa:Pool, sa:Fund, sa:PledgeAssertion, sa:PoolPledgedTotalAssertion,
                  sa:RoundOpenedAssertion, sa:RoundClosedAssertion,
                  sa:MatchInitiationAssertion, sa:PledgeAmendment))
  }
} # expect 12 (the 12 new owl:Class declarations)
```

---

## 8. Glossary appendix — every new term, one-liner

### 8.1 Classes

| Term | Definition |
|---|---|
| `sa:MatchInitiation` | A user's act of putting two opposite-direction intents on the table together as a candidate pairing. Owned by the initiator. The terminal artifact of spec 001's direct lane. |
| `sa:MatchInitiationAssertion` | On-chain anchor for a public-tier MatchInitiation. Carries initiator + viewedIntent IRI + candidateIntent IRI + initiationKind + proposedAt. |
| `sa:Pool` | An organisation agent operating as a contribution pool. Subclass of `sa:OrganizationAgent`. |
| `sa:Fund` | A Pool with `governanceModel = 'fund'`. Subclass of `sa:Pool`. Operates `sa:Round` RFPs. |
| `sa:PoolPledge` | A donor's committed contribution to a Pool. Body lives in donor's MCP; on-chain anchor is conditional on tier and `storyPermissions`. |
| `sa:PledgeAssertion` | On-chain anchor for a public-tier PoolPledge. |
| `sa:PoolPledgedTotalAssertion` | Aggregate on-chain assertion for a pool's `pledgedTotal` — published by the pool's stewards when the pool wants its total mirrored to GraphDB despite anonymous / private contributions. No donor info. |
| `sa:PledgeAmendment` | Documentation-only class describing the JSON shape inside `sa:pledgeHistory`. Amendments are NOT reified as separate triples. |
| `sa:Round` | An RFP issued by a Fund. Anchored on-chain. Subclass of `prov:Plan` / `p-plan:Plan`. |
| `sa:RoundOpenedAssertion` / `sa:RoundClosedAssertion` | On-chain anchors at round open / close. |
| `sa:GrantProposal` | A grant-cycle proposal submitted by an organisation to a Round or fund's open-call. Body always in proposer's MCP; ALWAYS private at submission (no v1 anchor). |
| `sa:MatchInitiationKind` | Closed enum class: self / connector. |
| `sa:MatchInitiationStatus` | Closed enum class: pending / superseded / consumed. |
| `sa:CeilingPolicy` | Closed enum class: block / waitlist / accept. |
| `sa:PledgeCadence` | Closed enum class: one-time / monthly / annual. |
| `sa:PledgePoolStatus` | Closed enum class: active / waitlisted / stopped / auto-stopped / fulfilled. |
| `sa:StoryPermission` | Closed enum class: public / shareWithSupportTeam / anonymous. |
| `sa:GrantProposalStatus` | Closed enum class: draft / submitted / withdrawn / awarded / declined. |
| `sa:ReportingCadence` | Closed enum class: quarterly / milestone / annual / none. |

### 8.2 Properties

| Term | Domain | Range | Definition |
|---|---|---|---|
| `sa:initiator` | `sa:MatchInitiation` | `sa:Agent` | The agent who proposed the pairing. Functional. |
| `sa:viewedIntent` | `sa:MatchInitiation` | `saint:Intent` | The intent the initiator was looking at. Functional. |
| `sa:candidateIntent` | `sa:MatchInitiation` | `saint:Intent` | The chosen counter-intent. Functional. |
| `sa:initiationKind` | `sa:MatchInitiation` | `sa:MatchInitiationKind` | self / connector. |
| `sa:proposedAt` | `sa:MatchInitiation` | `xsd:dateTime` | Creation timestamp. Subclass of `prov:generatedAtTime`. |
| `sa:basis` | `sa:MatchInitiation` | `xsd:string` | RankBasis JSON snapshot at proposal time. Opaque to SPARQL. |
| `sa:status` | `sa:MatchInitiation` | `skos:Concept` | Generic status predicate; ranges into the artifact-specific scheme. |
| `sa:visibility` | `sa:MatchInitiation` | `sageo:Visibility` | Privacy tier; cascades from source intents. |
| `sa:onChainAssertionId` | `prov:Entity` | `xsd:string` | Shared across all anchored artifacts. Null when not anchored. |
| `sa:governanceModel` | `sa:Pool` | `xsd:string` | DAF / giving-circle / mission-cooperative / mutual-aid / faith-promise / fund. |
| `sa:acceptsUnit` | `sa:Pool` | `xsd:string` | Multi-valued; units the pool accepts pledges in. |
| `sa:ceilingPolicy` | `sa:Pool` | `sa:CeilingPolicy` | What happens when a pledge would push pledgedTotal above capacityCeiling. |
| `sa:capacityCeiling` | `sa:Pool` | `xsd:decimal` | Optional cap on pledgedTotal. |
| `sa:acceptsOpenCalls` | `sa:Pool` | `xsd:boolean` | Used by Fund (spec 003); enables open-call proposals. |
| `sa:pledgedTotal` | `sa:Pool` | `xsd:decimal` | Derived aggregate. |
| `sa:availableTotal` | `sa:Pool` | `xsd:decimal` | Derived: pledgedTotal - allocatedTotal. |
| `sa:addressedMembers` | `sa:Pool` | `sa:Agent` | Multi-valued; agents allowed to pledge into a private pool. |
| `sa:steward` | `sa:Pool` | `sa:Agent` | Multi-valued; individual stewards. |
| `sa:stewardshipAgent` | `sa:Pool` | `sa:Agent` | The pool itself or a designated delegate. |
| `sa:pledger` | `sa:PoolPledge` | `sa:Agent` | The donor. Functional. |
| `sa:targetPool` | `sa:PoolPledge` | `sa:Pool` | Functional. |
| `sa:pledgeCadence` | `sa:PoolPledge` | `sa:PledgeCadence` | one-time / monthly / annual. |
| `sa:pledgeUnit` | `sa:PoolPledge` | `xsd:string` | Must be in pool.acceptsUnit. |
| `sa:pledgeAmount` | `sa:PoolPledge` | `xsd:decimal` | Per cadence period. |
| `sa:pledgeDuration` | `sa:PoolPledge` | `xsd:integer` | Months / years; null for one-time. |
| `sa:pledgeRestrictions` | `sa:PoolPledge` | `xsd:string` | JSON literal; subset of pool.acceptedRestrictions. |
| `sa:storyPermissions` | `sa:PoolPledge` | `sa:StoryPermission` | public / shareWithSupportTeam / anonymous. |
| `sa:pledgedAt` | `sa:PoolPledge` | `xsd:dateTime` | Subclass of `prov:generatedAtTime`. |
| `sa:stoppedAt` | `sa:PoolPledge` | `xsd:dateTime` | When the pledge was stopped or auto-stopped. |
| `sa:pledgeStatus` | `sa:PoolPledge` | `sa:PledgePoolStatus` | active / waitlisted / stopped / auto-stopped / fulfilled. |
| `sa:pledgeHistory` | `sa:PoolPledge` | `xsd:string` | JSON array of PledgeAmendment entries. |
| `sa:operatedByFund` | `sa:Round` | `sa:Fund` | Functional. |
| `sa:roundMandate` | `sa:Round` | `xsd:string` | JSON literal: { acceptedKinds, acceptedGeo, budgetCeiling, expectedAwards }. |
| `sa:milestoneTemplate` | `sa:Round` | `xsd:string` | JSON literal. |
| `sa:validatorRequirements` | `sa:Round` | `xsd:string` | JSON literal. |
| `sa:reportingCadence` | `sa:Round` | `sa:ReportingCadence` | quarterly / milestone / annual / none. |
| `sa:deadline` | `sa:Round` | `xsd:dateTime` | Submission cut-off. |
| `sa:decisionDate` | `sa:Round` | `xsd:dateTime` | Stewards' expected decision. |
| `sa:requiredCredentials` | `sa:Round` | `xsd:string` | Multi-valued AnonCreds kinds. |
| `sa:addressedApplicants` | `sa:Round` | `sa:Agent` | Multi-valued; for private rounds. |
| `sa:proposalsReceived` | `sa:Round` | `xsd:integer` | Derived counter. |
| `sa:proposer` | `sa:GrantProposal` | `sa:Agent` | The submitter. Functional. |
| `sa:targetRound` | `sa:GrantProposal` | `sa:Round` | Functional; mutually exclusive with `sa:fundMandate`. |
| `sa:fundMandate` | `sa:GrantProposal` | `sa:Fund` | Functional; for open-call proposals. |
| `sa:basedOnIntent` | `sa:GrantProposal` | `saint:Intent` | The underlying NeedIntent. |
| `sa:budget`, `sa:plan`, `sa:milestones`, `sa:desiredOutcomes`, `sa:reportingObligations`, `sa:organisationalBackground` | `sa:GrantProposal` | `xsd:string` | JSON literals. Functional. |
| `sa:proposalSubmittedAt` | `sa:GrantProposal` | `xsd:dateTime` | Subclass of `prov:generatedAtTime`. |
| `sa:version` | `sa:GrantProposal` | `xsd:integer` | Edit version; starts 0. |
| `sa:lastEditedAt` | `sa:GrantProposal` | `xsd:dateTime` | |
| `sa:proposalStatus` | `sa:GrantProposal` | `sa:GrantProposalStatus` | draft / submitted / withdrawn / awarded / declined. |
| `sa:withdrawnAt` | `sa:GrantProposal` | `xsd:dateTime` | |
| `sa:clonedFromProposal` | `sa:GrantProposal` | `sa:GrantProposal` | When cloned (Q3 in spec 003). |
| `saint:visibility` | `saint:Intent` | `sageo:Visibility` | Privacy tier. NEW; the cascade source. |
