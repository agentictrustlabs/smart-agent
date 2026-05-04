# Gitcoin Grants — Deep Dive & Alignment to Our Architecture

**Status:** Strategic reference doc
**Companion to:** `funding-models-survey.md`, `grants-fund-architecture.md`, `matchmaking-strategy.md`
**Purpose:** Walk through Gitcoin's current grants stack as the most-evolved real-world quadratic-and-beyond grant program, identify which primitives map to ours, and decide what to adopt / adapt / skip.

> This doc is written from training-cutoff knowledge of the Gitcoin ecosystem. Validate dates and feature names against gitcoin.co / allo.gitcoin.co before implementation.

---

## 1. Why Gitcoin matters

Gitcoin has run **20+ grant rounds since 2019** funding ~$60M+ to public-goods projects. They've iterated through every major grant-funding pain point:

- Pure QF → Sybil attacks → identity layer (Passport)
- Single-pool QF → community capture → cluster-aware matching (COCM)
- Programmatic-only allocation → arbitrary strategy support (Allo Protocol)
- Forward funding → retroactive funding (RetroPGF with Optimism)
- One-shot grants → continuous impact tracking (Hypercerts)
- DAO-treasury allocation → permissionless rounds (anyone can run a round)

That iteration history is gold. Each evolution solved a specific problem; each problem can recur in our system. We can pre-empt by adopting their solutions where they fit.

The strategic move: **treat Allo Protocol as the design reference for our Fund + Mandate + Award + Pledge primitives.** Where Allo cleanly separates roles, we can copy that decomposition. Where our DnS+PROV-O pattern adds something Allo doesn't have (provenance lineage, role-as-DolceRole), we extend.

---

## 2. The Gitcoin stack (current)

### 2.1 Allo Protocol — the substrate

**What it is:** A modular smart-contract framework where *anyone* can deploy a grant round with a chosen funding strategy. Strategies are pluggable; the protocol provides the connective tissue (registration, application, allocation, distribution).

**Component map** (Allo's terminology → ours):

| Allo concept | Description | Our equivalent |
|---|---|---|
| **Profile** | An on-chain identity — Pool owner / Recipient / Anchor address | `prov:Agent` (Person/Org/Fund — already in our resolver) |
| **Pool** | A pool of funds with a defined funding strategy | `Fund` agent + `FundMandate` description |
| **Strategy** | The pluggable algorithm that decides how `Pool` funds are allocated | `FundMandate.governance.model` policy slot |
| **Recipient** | An entity registered to receive from a Pool | Recipient role in mandate; specific Person/Org agent in Award |
| **Allocation** | The `(recipient, amount, sender)` event of someone directing pool funds | `Pledge` (from sender) + `GrantAward` allocation decision |
| **Distribution** | The actual transfer | `Disbursement` |

**Why Allo's separation is good:**

- The same Pool can run different strategies in different rounds (a Pool with a stable mandate ID can use QF in Round 1 and Direct Grants in Round 2)
- Strategies are versioned and audited independently of pools
- Recipients register once (an Anchor address) and apply to multiple pools

**What we adopt:** the Pool/Strategy separation. Our `Fund` is the Pool; `FundMandate.governance` is the Strategy. We can register multiple Strategies and let the Mandate select.

**What we extend:** our `FundMandate` is a richer `dul:Description` — it carries roles, conditions, eligibility, evidence requirements. Allo's strategy is just an algorithm. We have the algorithm + the schema.

### 2.2 Gitcoin Passport — Sybil resistance

**What it is:** A composable identity score built from "stamps." Each stamp is a verifiable credential proving the holder satisfies some predicate (owns an active Github account, has ENS, has a verified Twitter, owns NFTs, has been on-chain for X months, holds BrightID, etc.). Passport aggregates stamps into a humanity score.

**The Sybil problem:** In QF, one human creating 100 fake donors gets 100x matching. Passport raises the cost: each fake account needs its own stamps, which cost time/money/social capital to forge.

**Stamps live as W3C Verifiable Credentials.** A stamp issuer signs `(holder DID, attribute, value, timestamp)`. The holder's wallet aggregates them.

**At round-allocation time:** Allo's QF strategy filters pledges by minimum Passport score. Pledges from low-score addresses are discounted or excluded.

**Our equivalent:**

| Gitcoin Passport concept | Our equivalent |
|---|---|
| Stamp issuer | AnonCreds issuer (we have `credential-registry`, `verifier-mcp`, holder wallets) |
| Stamp = credential | AnonCred credential of some kind |
| Stamp predicate | AnonCred attribute + verification predicate |
| Passport score | Aggregated trust score (our existing TrustDeposit is one source; AnonCred presentations are another) |
| Min-score filter at allocation | `FundMandate.eligibilityRules.identityRequirement` field |

**What we adopt:** the *concept* of composable identity stamps. Don't re-invent the wheel — we use AnonCreds.

**What we extend:** our model has trust scores from on-chain reviews (TrustDeposits) which Passport doesn't natively expose. A donor's matching weight could be `passport_score × log(1 + trust_score_from_reviews)`. We can compose because both are on-chain.

**What we skip for v1:** Building a full stamp-issuance ecosystem. We rely on existing credentials (membership in catalyst hub, geographical credentials, etc.) and add stamps later as demand justifies.

### 2.3 COCM (Connection-Oriented Cluster Match)

**The problem with vanilla QF:** A tightly-knit community of donors who all support the same set of projects can dominate allocation even with small individual contributions. The QF math rewards *broad support*, but if "broad" is actually one cluster pretending to be broad, the result is captured.

**COCM's insight:** Discount contributions *within* a cluster. If donors A, B, C all donate to projects P1, P2, P3 together, they're behaving as a coalition; their contributions to those projects should count less than contributions from donors who give independently.

**The math** (simplified): Build a donor-project bipartite graph. Run a clustering algorithm on donors based on voting patterns. Apply a *cluster-discounted* QF: contributions from clustered donors to the cluster's preferred projects get reduced weight.

**Empirically:** COCM reduces the matching going to capture-by-community by 20-40% in Gitcoin's tests, redirects toward projects with truly diverse support.

**Where it matters in our system:** Catalyst funds may have similar dynamics. If everyone in Wellington Circle pledges to a Wellington-only project, that's not really "broad support" — it's the same group. COCM-style clustering would discount accordingly.

**Our equivalent:** A new `governance.model = cluster-quadratic` that runs COCM. Implementation:

```ts
function cocmAllocate(round, pledges):
  donors = uniquePledgers(pledges)
  // Build donor similarity graph: edge weight = # of shared projects
  graph = buildSimilarityGraph(donors, pledges)
  clusters = louvain(graph)         // standard clustering algorithm
  for each project p:
    score_p = 0
    for each cluster c:
      // Pool contributions from cluster c to project p
      cluster_contributions = sum(pledges where pledger in c, project = p)
      // Apply diminishing returns within cluster (vanilla QF on cluster contributions)
      score_p += sqrt(cluster_contributions)
    score_p = score_p²
  return normalize(scores, M)
```

The clustering reduces *intra-cluster* coalition power.

**What we adopt:** COCM as a pluggable strategy in Phase 5+. Easier to ship than vanilla QF because the clustering hardens the Sybil problem.

### 2.4 Hypercerts — claimable impact certificates

**What it is:** A standard for representing **claims of impact** as transferable on-chain certificates. A project team mints a Hypercert that says "we produced impact X in scope Y during time Z." Funders can buy or be granted Hypercerts retroactively, which compensates the producers and creates a market for impact.

**Mechanics:**
- Hypercert encodes `(work scope, impact scope, contributors, time, evidence URIs)`
- Issued as ERC-1155 fractional tokens
- Can be split (one Hypercert can be owned by multiple funders proportionally)
- Marketable: secondary trading possible

**Why it's useful:** It separates *creating impact* from *being paid for impact.* Anyone doing public goods can mint a Hypercert ahead of time; funders can later grant retroactive payment by acquiring the Hypercert. This solves the bootstrapping problem of retroactive funding (recipients don't have to pre-pitch; they just do work and let it speak).

**Our equivalent:**

| Hypercert concept | Our equivalent |
|---|---|
| Hypercert (impact claim) | `OutcomeReport` + `OutcomeValidation` chain |
| Fractional ownership | Split award across multiple recipients (existing engagement-tranche model handles partials) |
| Marketplace for impact | Phase 6+; meanwhile the Validation → TrustDeposit chain serves the auditing function |

**What we adopt:** the concept of a *claimable* impact assertion as the core retrospective primitive. Our `OutcomeReport` should be claimable / discoverable independent of being awarded. A recipient can publish an OutcomeReport even before any award is issued; later, a fund can retroactively award based on it. This is exactly RetroPGF with our names.

**What we skip:** ERC-1155 fractionalization for v1. Our Award model is one-recipient-per-engagement. Phase 6+ if there's demand.

### 2.5 Pairwise QF

**What it is:** Instead of evaluating each project against an absolute QF score, evaluate them in pairs. Donors signal preferences between *pairs* of projects rather than donating absolute amounts. The matching pool flows along the preference gradient.

**Why:** Reduces strategic gaming (you can't game a relative comparison the way you can game an absolute one). Matches the way humans actually decide.

**Status:** Research-stage at Gitcoin; not production. Skip for v1 and probably Phase 5.

### 2.6 Direct Grants

**What it is:** Within Allo Protocol, a non-QF round where the pool steward(s) directly approve grant amounts to recipients. Same protocol substrate as QF; different strategy.

**Why offered:** Not every funding decision benefits from QF's broad-support optimization. Sometimes you want a foundation cycle: clear mandate, expert review, direct allocation.

**Status:** Production. Used heavily by foundations running on Allo.

**Our equivalent:** Single-coach + multisig governance models in our `FundMandate`. We support this in v1.

### 2.7 Easy Retro Funding

**What it is:** A simplified retro-funding workflow. Sponsor commits a pool. Community badge-holders vote on past impact. Pool distributed proportional to votes. No proposals, no advance applications — pure retrospective.

**Mechanics:**
- Sponsor → matching pool
- Badge-holders (curated by sponsor) → vote on contributors
- Pool distributed by vote-weight
- Recipients claim their share

**Status:** Used in Optimism RetroPGF Rounds 2-4.

**Our equivalent:** A `FundMandate` with `governance.model = retro-vote` + `eligibility.badgeRequired = X`. The mandate's `Proposals` are *retrospective claims* (Hypercerts) not forward-looking plans.

**v1 status:** Phase 5 — same primitives, different temporal sequence.

### 2.8 Domain-allocated rounds

**What it is:** Gitcoin runs *multiple parallel rounds* per cycle, each scoped to a domain (climate, OSS, education, web3 ecosystem, ZK, etc.). Donors pick which domain to support; pool sponsors fund their preferred domain. Allocations are computed *within* each domain.

**Why:** Avoids one-size-fits-all matching. Climate donors don't dilute the OSS pool; OSS recipients don't compete with climate ones.

**Our equivalent:** Multiple `Fund` agents, each with its own mandate. A Hub hosts many Funds. This IS our model — Gitcoin's domain rounds are individual Pools in Allo terminology, which is one Fund in ours. We get this for free.

**v1 status:** ✅ Catalyst Hub already hosts 3+ funds with different mandates. Naturally domain-segmented.

### 2.9 Connection between Gitcoin Passport and Trust Bonds (Trust Score)

**Trust Bonds** (Gitcoin 2024+): An evolution beyond Passport. Donors can vouch for each other by *staking tokens on each other's identity*. If a vouched-for donor is found Sybil, the voucher's stake is slashed. This bonds the social graph to economic skin-in-the-game.

**Mechanics:**
- Alice stakes 100 GTC on Bob's identity
- Bob's trust score increases proportional to Alice's stake
- If Bob is later proved Sybil, Alice loses her stake
- Creates a market for identity vouching

**Our equivalent:** This is *exactly* TrustDeposit applied to identity assertions. Our `TrustDeposit` contract was designed for exactly this kind of stake-on-claim. We have the contract; we'd need a UI/flow to expose "I vouch for X with stake Y."

**v1 status:** ⚠️ Phase 5+. The contract is there; the UX is not.

---

## 3. The Allo Protocol architecture in detail

Worth understanding because it's the cleanest published architecture for grant infrastructure.

### 3.1 Core concepts

```
┌──────────────────────────────────────────┐
│              Allo (registry)             │
│  - registry of Profiles                  │
│  - registry of Pools                     │
│  - registry of Strategies                │
└──────────────────────────────────────────┘
            │            │            │
            ▼            ▼            ▼
┌────────────────┐ ┌──────────┐ ┌─────────────┐
│   Profile      │ │   Pool   │ │  Strategy   │
│   (anchor      │ │  (fund   │ │  (alg per   │
│   address +    │ │   metadata)│ │   round)    │
│   metadata)    │ │          │ │             │
│                │ │  - profile│ │  - register │
│  - members     │ │  - strategy│ │    recipients│
│  - metadata    │ │  - amount│ │  - allocate │
└────────────────┘ │  - manager│ │  - distribute│
                   └──────────┘ └─────────────┘
```

A **Profile** is an entity — a person, project, organization. Like our `prov:Agent`.

A **Pool** is created by a profile, points to a strategy, holds tokens. Like our `Fund`.

A **Strategy** implements three lifecycle hooks:
- `_registerRecipient(data)` — handle recipient applications
- `_allocate(data)` — handle donor allocations (pledges)
- `_distribute(data)` — execute the actual transfers

This is a beautifully simple state machine. Ours can mirror it:

| Allo lifecycle | Our lifecycle |
|---|---|
| `_registerRecipient` | `submit_proposal` |
| `_allocate` | `pledge_to_fund` (or `approve_proposal` for direct grants) |
| `_distribute` | `release_tranche` (existing engagement) |

The state machine becomes:

```
[Pool/Fund created]
    ↓
[Round opens]
    ↓
register loop: submit_proposal(mandate, proposal) ─┐
                                                   ├─> pool of registered proposals
allocate loop: pledge_to_fund(amount, restrictions)┘
                                                   
[Round closes]
    ↓
governance.model.evaluate(proposals, pledges) → awards
    ↓
distribute: tranche releases per award
    ↓
outcome reporting
    ↓
validation → trust update
```

### 3.2 Strategy plug-in pattern

Allo's strategies are deployed as separate contracts. The Pool delegates to the Strategy contract for each lifecycle event. The protocol is policy-agnostic.

**For us:** governance models are configurable but don't need to be separate contracts in v1. They can be code branches inside a single allocator service. **Phase 5** could split out into per-strategy contracts as Allo does, *if* we want third parties to plug in their own.

### 3.3 Allocation strategies Allo ships

| Strategy name | Description | Our v1 status |
|---|---|---|
| `DonationVotingMerkleDistribution` | Off-chain QF computation, Merkle tree of allocations, on-chain claim | Phase 5 |
| `DirectGrants` | Single-or-multisig approval of recipients | ✅ v1 |
| `RetroFunding` | Vote-weighted retroactive | Phase 5 |
| `MicroGrants` | Small grants approved by community vote | Phase 5 |
| `RFP` | RFP-style with scoring | ✅ v1 (single-coach + multisig covers this) |

We map cleanly. The strategies *we* don't have are precisely the QF / vote-weighted / retro variants — Phase 5 work.

---

## 4. What we adopt directly from Gitcoin

| Concept | Source | Our adoption |
|---|---|---|
| **Profile/Pool/Strategy separation** | Allo | Profile = our `Agent`; Pool = our `Fund`; Strategy = our `FundMandate.governance.model` |
| **Lifecycle hooks (register/allocate/distribute)** | Allo | Map to our `submit_proposal` / `pledge_to_fund` / `release_tranche` |
| **Identity stamps for Sybil resistance** | Passport | Implemented via existing AnonCreds rails |
| **Cluster-aware matching** | COCM | New `cluster-quadratic` strategy in Phase 5 |
| **Retroactive impact claims** | Hypercerts + RetroPGF | Our `OutcomeReport` doubles as claimable impact assertion |
| **Multiple parallel domain pools** | Domain rounds | Hub hosts multiple Funds; we already have this |
| **Trust-staked identity vouching** | Trust Bonds | TrustDeposit contract exists; UI in Phase 5+ |
| **Open registration of recipients** | Allo profile pattern | Recipient profile = existing `Agent` registration |
| **Cap-aware matching pool** | Gitcoin matching pools | `mandate.matchingPool.cap` field |

## 5. What we adapt (don't copy directly)

| Concept | Why we deviate |
|---|---|
| **ERC-1155 fractional Hypercerts** | We model fractional ownership via tranche splits in engagement; ERC-1155 is overkill until secondary marketplace demand. |
| **Allo strategy contracts** | Our v1 governance is in-server, not contract-based. Phase 5 reconsiders. |
| **Off-chain QF computation + Merkle distribution** | We can compute QF on-chain in dev (small donor sets); off-chain Merkle for scale comes later. |
| **Passport stamp marketplace** | We use the credentials we already have (catalyst-hub-membership, residentOf, validatedReviewer, etc.). New stamps added as needed, not as a generic platform. |

## 6. What we skip entirely

| Concept | Reason |
|---|---|
| **Pairwise QF** | Research-stage at Gitcoin; unproven. |
| **Quadratic voting** (snapshot vote weight via QV math) | Different problem (voting, not funding). Out of scope. |
| **Quadratic-bidding auctions** | Out of scope. |
| **Pure on-chain treasury allocation contracts (like Compound governance)** | We use multisig + per-fund signers in v1. DAO-token-vote in Phase 5 only if real demand. |

---

## 7. Implications for our matchmaker

The matchmaker shifts from "find a counterparty" to **"surface the right strategic action."** Per the Gitcoin / Allo evolution, a donor or recipient should see:

```
For a recipient with a NeedIntent:
  ┌──────────────────────────────────────────────────────────┐
  │ Eligible Funds                                           │
  │   • NoCo Trauma-Care Fund — single-coach, $50k cap      │
  │     ├ "Submit proposal directly"                         │
  │     └ Mandate match: 92% (kind, geo, criteria)           │
  │   • NoCo Pluralistic Causes Round — quadratic           │
  │     ├ "Submit + activate community"                      │
  │     └ Match potential: depends on broad donor support    │
  │   • RetroPGF Q3 — retro-vote                            │
  │     └ "Submit hypercert claim of past work"              │
  ├──────────────────────────────────────────────────────────┤
  │ Direct matches (no fund mediation)                       │
  │   • Maria — direct give-coaching                         │
  │   • David — direct give-mentorship                       │
  └──────────────────────────────────────────────────────────┘

For a donor with a GiftIntent:
  ┌──────────────────────────────────────────────────────────┐
  │ Funds matching your interest                             │
  │   • NoCo Trauma-Care — basic match                       │
  │   • NoCo Pluralistic — your $25 becomes $X via QF        │
  │   • CIL Capital Pool — restricted to Togo                │
  ├──────────────────────────────────────────────────────────┤
  │ Pledge multiplier                                        │
  │   "Your $100 in NoCo Pluralistic could match $250-$800   │
  │    depending on broad support. Estimated impact: ..."    │
  ├──────────────────────────────────────────────────────────┤
  │ Direct gift options                                      │
  │   • Sofia — Wellington Circle coach (direct)             │
  └──────────────────────────────────────────────────────────┘

For a fund admin:
  ┌──────────────────────────────────────────────────────────┐
  │ Pending proposals (24)                                   │
  │ Pledged but unallocated ($45k)                           │
  │ Round close in 12d                                       │
  │ Quick actions:                                           │
  │  • Open new round                                        │
  │  • Run COCM preview                                      │
  │  • Validate outcomes pending                             │
  └──────────────────────────────────────────────────────────┘
```

The matcher's job becomes *strategic surfacing* — show the right cards based on the user's role, the available funds' mandates, and their algorithms. Not just "find a counterparty."

---

## 8. Concrete changes to v1 plan

Based on this Gitcoin alignment, three updates to the v1 plan from `grants-fund-architecture.md`:

### 8.1 F6 (FundMandate schema) — extend governance model enum

Original v1: `single-coach | multisig`
Updated: `single-coach | multisig | retro-vote-stub | direct-grants` — even if we don't *implement* QF/COCM in v1, the enum + the `governance.config` JSON should accept them so we don't ship incompatible mandate documents.

### 8.2 F8 (matcher) — three viewer modes

Match-card output should be one of:

| Card kind | When |
|---|---|
| `direct-match` | Direct gift/need pairing |
| `fund-mediated:submit-proposal` | Recipient sees a fund whose mandate matches |
| `fund-mediated:pledge` | Donor sees a fund whose mandate matches their gift intent |
| `fund-mediated:claim-hypercert` | Recipient with documented past work sees a retro fund (Phase 5) |
| `fund-admin:queue` | Caller is fund principal; sees pending proposals/pledges |
| `fund-admin:run-allocation` | Caller is fund principal; round closing soon (Phase 5) |
| `fund-admin:validate-outcomes` | Caller is fund principal; outcome reports pending |

The card kinds drive the UI's action buttons. v1 ships the first three + admin queue.

### 8.3 F11 (approval flow) — strategy registry, not branch logic

Instead of:

```ts
function approveProposal(p) {
  if (mandate.governance.model === 'single-coach') ...
  else if (mandate.governance.model === 'multisig') ...
}
```

Use:

```ts
const STRATEGY_REGISTRY: Record<string, AllocationStrategy> = {
  'single-coach': SingleCoachStrategy,
  'multisig': MultisigStrategy,
  // Phase 5 adds:
  // 'quadratic': QuadraticStrategy,
  // 'cluster-quadratic': COCMStrategy,
  // 'retro-vote': RetroVoteStrategy,
  // 'donor-advised': DAFStrategy,
}

function approveProposal(p, mandate) {
  const strategy = STRATEGY_REGISTRY[mandate.governance.model]
  return strategy.evaluate(p, mandate)
}
```

This is the Allo lesson: pluggable strategies = the architecture should accommodate them from day one even if v1 only ships two.

---

## 9. Open questions

1. **Anchor Address pattern from Allo.** Allo gives each Profile an "Anchor address" — a deterministic address derived from the profile-id, used for receiving funds across rounds. Our recipient is just a Person/Org agent's smart account. Do we need an Anchor abstraction? (Probably not v1; revisit if recipients want to receive across many rounds with one identity.)

2. **Off-chain vs on-chain QF computation.** Gitcoin runs QF off-chain (in their backend), publishes a Merkle root, recipients claim. We could do similarly OR run QF as an on-chain script in Anvil for dev. Recommendation: **on-chain in dev** (small donor sets, easy to audit), **off-chain Merkle in prod** (gas cost prohibitive for 10k+ donors).

3. **Stamps for catalyst-specific identity.** We don't need full Gitcoin Passport. We need: `verified-hub-member`, `verified-circle-leader`, `verified-coach`, `verified-validator`. These are AnonCreds we can issue from existing org-mcp or hub-mcp. Phase 5+: define these credential types.

4. **Fee model.** Gitcoin/Allo charges no protocol fee but some rounds have gas costs. Our funds are dev-mode mock-token, so fees are zero. Real-world: each disbursement costs gas; who pays? Recommendation: **fund pays from its own treasury** (transparent operating cost).

5. **Cross-fund competition vs cooperation.** Gitcoin's domain rounds run in parallel and don't compete (climate donors don't see OSS recipients). Our hub could enforce same isolation, OR allow recipients to apply to multiple funds simultaneously. Recommendation: **allow multi-apply with explicit per-fund proposals** (one need can yield multiple proposals) — supports the "shop your need around" pattern.

---

## 10. Take-away

Gitcoin's iteration is *the* canonical playbook for grants infrastructure. Our `Need ↔ Mandate ↔ Gift` framework already aligns with their core abstractions; we get the vocabulary right and the rest is implementation phasing.

The strategic moves we lift directly:

1. **Allo's lifecycle: register → allocate → distribute** — adopt as our state machine.
2. **Identity-as-credentials for Sybil resistance** — adopt via AnonCreds.
3. **Strategy registry** — design F11 with this from day one even if v1 ships only two strategies.
4. **Hypercert-style retroactive claims** — model `OutcomeReport` as claimable on its own.
5. **Domain-segmented funds** — already aligns (Hub hosts many Funds).

The patterns we adapt or skip aren't wrong — they're scope decisions for v1. Phase 5 fills in QF, COCM, retro-vote, trust-bonds.

Final principle (mirrors §7 of `funding-models-survey.md`):

> A Fund's `Mandate.governance.model` is the policy slot.
> Different funding models = different values for that field.
> The pipeline (need → mandate → gift → pledge → proposal → approve → award → disburse → report → validate → trust) stays the same.
> Adding a new funding model = registering a new strategy + a new entry in the enum.

That's the Gitcoin lesson. We bake it in.
