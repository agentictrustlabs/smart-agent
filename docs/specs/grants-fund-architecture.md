# Grants & Fund Marketplace — Architecture

**Status:** Draft for review
**Companions:** `docs/information-architecture/grants-fund-design.md` (object model + flows), `docs/information-architecture/grants-fund-plan.md` (phasing)
**Owner:** Information Architect + Ontologist

---

## 1. Goal

Generalize the catalyst hub's marketplace from "buyer ↔ seller" to "**need ↔ mandate ↔ gift**" — a three-party publish-and-discover protocol where a **Fund / Hub** is a first-class agent that mediates between many small giver commitments and many recipient proposals. The Fund decouples the temporal sequence (pledges and proposals arrive asynchronously), simplifies the matchmaker (M givers + N proposals → M+N matches against mandates rather than M×N pairwise), and gives each side a single trust boundary instead of bilateral commitments with every counterparty.

This is the same pattern as a real-world DAO grant program, foundation grant cycle, donor-advised fund, mutual aid pool, church benevolence fund, in-kind resource pool, or volunteer labor coordinator.

The architecture must:

1. **Honor permissions strictly** — no matcher process opens any agent's MCP except the caller's own (the "publish-and-discover" rule from `02-data-ownership-map.md` carries forward).
2. **Decouple gift from need** — the donor signs an agreement with the **fund only**; the recipient signs an agreement with the **fund only**. Donor and recipient never need a direct relationship.
3. **Compose with existing primitives** — reuse `AgentAccount`, `AgentAssertion`, `AgentRelationship`, the engagement+tranche model, the trust-deposit rail, and the per-MCP tier system.
4. **Stay ontology-aligned** — every new class maps cleanly onto PROV-O (Agent / Activity / Entity) and DOLCE+DnS (Description / Role / Situation) so we can extend without a redesign later.

---

## 2. The five canonical flows

Compact view; full sequence diagrams live in the design doc.

```
1. PUBLISH-INTENT
   Owner expresses intent (need or gift) in their MCP with visibility=public.
   MCP/server-action mints atl:expressedIntent on AgentAssertion.
   Public projection now discoverable.

2. PUBLISH-MANDATE
   Hub steward registers a Fund agent + FundMandate description.
   Fund mints atl:fundMandate on-chain.
   Fund is now a discoverable third party.

3. PLEDGE
   Donor selects a fund. Mints atl:pledgedTo (no amount) for transparency.
   Writes a private pledge row in their MCP with exact amount.
   Cross-delegation grants fund read access to amount when accepted.
   Fund-side ledger entry credited.

4. PROPOSE → APPROVE → AWARD
   Recipient selects a mandate. Drafts a Proposal in their org-mcp,
     based on a NeedIntent.
   Mints atl:proposalSubmitted (proposal IRI → fund IRI).
   Fund reads proposal via cross-delegation (granted at submit).
   Fund's governance approves; mints atl:awardAgreement.
   Engagement created (kind='grant-award'), tranches scheduled.

5. DISBURSE → REPORT → VALIDATE → TRUST
   Tranche release: fund treasury → recipient (mock-token in v1).
   Mints atl:fundDisbursement.
   Recipient files outcome report (cross-delegation to fund).
   Validator (fund or third party) signs validation; mints atl:outcomeValidated.
   TrustDeposit fires on involved agents.
```

Each step is initiated by the relevant principal in their own session. No flow requires a process to read another agent's private state.

---

## 3. The Fund-as-Agent decision

This is the central architectural choice and the question you raised. Three options:

### 3.1 Fund-as-Agent (recommended)

The Fund is its own `prov:Agent` (a `prov:Organization`) with:

- A deployed `AgentAccount` (smart-account address)
- A registration in `AgentAccountResolver` with type `atl:Fund`
- Its own treasury (smart-account balance, ETH or mock-ERC20 in dev)
- Governance via `FUND_GOVERNED_BY` relationships to one or more Person/Org agents
- Identity (DID-style) — discoverable, mintable assertions, queryable trust score
- Hosted under a `Hub` agent via `HUB_HOSTS_FUND` relationship

### 3.2 Fund-as-Description (rejected for v1)

The Fund is purely a `dul:Description` published by a sponsor org:

- No principal of its own
- Treasury held by the sponsor org
- Approvals signed by the sponsor's principals
- Awards issued from the sponsor org's smart account

### 3.3 Hybrid (chosen)

Fund-as-Agent **AND** the FundMandate as a `dul:Description` published *by* the Fund:

- Fund (`prov:Organization`) — has identity, treasury, can sign
- FundMandate (`dul:Description`) — defines roles (Donor, Recipient, Funder, Validator) and conditions (acceptsGiftKinds, fundsNeedKinds, geoRoot, governance)
- GrantAward (`dul:Situation`, `prov:Activity`) — a particular instance satisfying the mandate, with role-bindings to specific agents

This three-piece decomposition is what aligns cleanly with both PROV-O and DOLCE+DnS (§5).

### Why Fund-as-Agent matters

| Property | Fund-as-Agent | Fund-as-Description |
|---|---|---|
| Has identity (resolvable address, trust score, public profile) | ✅ | ❌ — sponsor's identity is what's visible |
| Can be subject of public relationships (HOSTED_BY, GOVERNED_BY) | ✅ | ❌ — relationships attach to sponsor |
| Can hold its own treasury (segregated from sponsor) | ✅ | ❌ — comingled with sponsor's other funds |
| Donors and recipients sign with the **fund**, not the sponsor | ✅ — single trust boundary per fund | ❌ — they sign with sponsor; harder to compose multiple funds under one sponsor |
| Discovery: "list all funds of kind X" returns rows with their own URIs | ✅ | partial — must enumerate sponsors and inspect their descriptions |
| Reviewable / disputable / forkable independently of sponsor | ✅ | ❌ — coupled to sponsor lifecycle |
| Cost to add another fund under same sponsor | small (one new `AgentAccount` deploy) | small (one new description) |
| Aligns with existing Hub agent-of-agents pattern in this codebase | ✅ — Hubs already host Person/Org agents | ❌ — would break the established pattern |

The first six properties are exactly what your write-up called for: *"a public agent with relationships and roles to it."* That's why the recommendation is unambiguous.

The cost is one extra `AgentAccount` deployment per fund (~15s in fresh-start, free gas in dev) and one entry in the resolver. Negligible.

---

## 4. System architecture

### 4.1 Component diagram

```
                            ┌──────────────────────────────────────────┐
                            │            On-chain (Anvil)              │
                            │  ┌──────────────┐  ┌──────────────────┐  │
                            │  │AgentAccount  │  │ AgentAssertion   │  │
                            │  │   (Fund      │  │ (atl:fundMandate │  │
                            │  │    smart     │  │  atl:pledgedTo   │  │
                            │  │    account)  │  │  atl:awardAgree  │  │
                            │  └──────┬───────┘  │  atl:disburse    │  │
                            │         │treasury   │  atl:validate)   │  │
                            │  ┌──────▼───────┐  └──────────────────┘  │
                            │  │  Mock-ERC20  │  ┌──────────────────┐  │
                            │  │  (v1 dev)    │  │AgentRelationship │  │
                            │  └──────────────┘  │HUB_HOSTS_FUND    │  │
                            │  ┌──────────────┐  │FUND_GOVERNED_BY  │  │
                            │  │TrustDeposit  │  │CONTRIBUTES_TO    │  │
                            │  └──────────────┘  │FUND_AWARDS       │  │
                            │                    └──────────────────┘  │
                            └────────────▲─────────────▲─────────────▲─┘
                                         │             │             │
       ┌─────────────────────────────────┼─────────────┼─────────────┼─────────────────┐
       │                                 │             │             │                 │
┌──────┴──────┐                  ┌───────┴────┐ ┌──────┴────┐ ┌──────┴─────┐  ┌────────┴─────┐
│ person-mcp  │                  │   org-mcp  │ │ org-mcp   │ │ org-mcp    │  │  graphdb     │
│             │                  │            │ │ (fund     │ │            │  │              │
│  pledges    │                  │ proposals  │ │ instance) │ │ engagements│  │ (mirror of   │
│  outcomes   │                  │ pledges_   │ │           │ │ tranches   │  │  on-chain    │
│  intents    │                  │   received │ │ fund_pool │ │            │  │  assertions) │
│             │                  │ reviews    │ │ mandates  │ │            │  │              │
│  (caller's  │                  │ (proposer's│ │ (fund     │ │ (both      │  │              │
│   own data) │                  │   side)    │ │  side)    │ │  sides)    │  │              │
└─────────────┘                  └────────────┘ └───────────┘ └────────────┘  └──────────────┘
       │                               │             │              │              ▲
       │                               │             │              │              │
       └────────────────┬──────────────┴─────────────┴──────────────┘              │
                        │                                                          │
                        │      ┌──────────────────────────────┐                    │
                        └─────▶│      Web app (Next.js)       │────read GraphDB────┘
                               │                              │
                               │  /discover  — matcher        │
                               │  /funds/<id>/queue           │
                               │  /proposals/<id>             │
                               │  /awards/<id>                │
                               │  /pledges                    │
                               └──────────────────────────────┘
```

### 4.2 Layered responsibility

| Layer | Stores | Reads | Writes |
|---|---|---|---|
| **On-chain (public)** | Agent identity, mandate description, public pledge commitments, public award agreements, disbursement events, validations, trust deposits | Anyone | Owner of the relevant agent (signed) |
| **GraphDB** | Mirror of on-chain assertions + relationships | Anyone (public discovery) | Sync worker only — never direct writes |
| **person-mcp / org-mcp** (caller's own) | Private intent rows, exact pledge amounts, full proposal text, exact award amounts, outcome report detail, internal review notes | Owner + delegated readers | Owner only (via session) |
| **Fund-side org-mcp (per-fund instance)** | Treasury ledger, mandate full text, governance config, pledges_received (exact amounts via cross-delegation from donors), proposals received (via cross-delegation from proposers), award decisions | Fund principal + delegated auditors | Fund principal only |
| **Web app** | Stateless | All of the above (via session-scoped delegation) | None — pure orchestration |

### 4.3 Owner-routing under the new model

Every T2 row still has exactly one principal:

- A pledge has TWO rows: one in donor's person-mcp (`pledges` table, principal=donor); one in fund's org-mcp (`pledges_received`, principal=fund). The fund-side row only exists if the donor accepted the cross-delegation grant.
- A proposal has ONE row: in proposer's org-mcp (`proposals`, principal=proposer). Fund reads it via cross-delegation.
- An award has TWO rows because it's an engagement: one in fund's engagements (principal=fund), one in recipient's engagements (principal=recipient).
- An outcome has ONE row in recipient's org-mcp (or person-mcp if personal grantee). Fund reads via cross-delegation.

This is the same pattern as ORG_GOVERNANCE delegations and engagement tranches in v1 — Fund is just one more kind of co-party.

---

## 5. Ontology alignment

This is the section you asked about. Verdict: Fund-as-Agent + FundMandate-as-Description + GrantAward-as-Situation aligns cleanly with both PROV-O and DOLCE+DnS, and the three-piece decomposition is what the alignment requires.

### 5.1 PROV-O alignment

PROV-O has three top-level types:

- `prov:Agent` — bears responsibility for activities
- `prov:Activity` — happens over a duration; uses entities, generates entities
- `prov:Entity` — physical, digital, conceptual, or other thing

Mapping:

| Domain object | PROV-O class | Justification |
|---|---|---|
| `Person` | `prov:Person` (subclass of `prov:Agent`) | Already in the codebase |
| `Organization` | `prov:Organization` (subclass of `prov:Agent`) | Already |
| **`Fund`** | `prov:Organization` (subclass of `prov:Agent`) | Acts on behalf of donors; signs agreements; can be associated with activities. Same kind as Organization. |
| `Hub` | `prov:Organization` | Already |
| `FundMandate` | `prov:Plan` (subclass of `prov:Entity`) | A plan/intention/specification — an entity used by activities |
| `GiftIntent` | `prov:Plan` | A planned future contribution |
| `NeedIntent` | `prov:Plan` | A planned future request |
| `PledgeCommitment` | `prov:Entity` | A formalized commitment record |
| `Proposal` | `prov:Plan` | A specific plan submitted to a fund |
| `GrantAwardAgreement` | `prov:Entity` (a `dul:CommitmentSituation` — see §5.2) | The formal agreement record |
| `Disbursement` | `prov:Activity` | Happens at a time; uses pledges; generates funded resources |
| `OutcomeReport` | `prov:Entity` | An informational record |
| `OutcomeValidation` | `prov:Activity` | An assessment activity |
| `TrustUpdate` | `prov:Activity` (its result is a `prov:Entity` — the trust delta) | |

Provenance edges:

```
Disbursement (Activity)
  prov:wasAssociatedWith Fund (Agent)
  prov:used Pledge (Entity)
  prov:used GrantAwardAgreement (Entity)
  prov:generated DisbursedTranche (Entity)

GrantAwardAgreement (Entity)
  prov:wasGeneratedBy ApprovalActivity
  prov:wasInfluencedBy Proposal
  prov:wasInfluencedBy FundMandate

Proposal (Plan / Entity)
  prov:wasInfluencedBy NeedIntent
  prov:wasAttributedTo Recipient

PledgeCommitment (Entity)
  prov:wasInfluencedBy GiftIntent
  prov:wasAttributedTo Donor

OutcomeValidation (Activity)
  prov:used OutcomeReport
  prov:wasAssociatedWith Validator
  prov:generated TrustUpdate
```

Two important PROV-O properties for the fund layer:

- `prov:actedOnBehalfOf` — when a Fund disburses, the Fund acts on behalf of (is responsibly delegated by) its Donors. This is the *responsibility chain*. We can reify this so Sarah's pledge → Fund's disbursement on behalf of Sarah is queryable.
- `prov:wasInformedBy` — the chain from `Proposal` → `ApprovalActivity` → `GrantAwardAgreement` → `Disbursement` is naturally a chain of `wasInformedBy`.

This means a SPARQL query of the form *"who was responsible for the resources Ana received?"* yields the chain:

```
Ana ← Disbursement ← Fund
                    ← (actedOnBehalfOf) ← Sarah, David, ...
                    ← (wasInformedBy) ← ProposalApproval
                                       ← (wasInformedBy) ← Proposal
                                                          ← (basedOn) ← Ana's NeedIntent
```

That's exactly the W3C-recommended provenance shape for "where did this come from?"

### 5.2 DOLCE+DnS alignment

DOLCE has:

- `dul:Endurant` — things that exist through time (Agents, PhysicalObjects, …)
- `dul:Perdurant` — things that happen (Events, Processes, States)
- `dul:Description` — a conceptualization that defines roles and concepts
- `dul:Situation` — a state of affairs that satisfies a description
- `dul:Concept` — a notion defined in a description (e.g. a Role)
- `dul:Role` — a `dul:Concept` "played by" agents in situations
- `dul:Plan` — a `dul:Description` of a procedure

DnS Pattern:

> A `Description` defines a set of `Concepts` (including `Roles`).
> A `Situation` satisfies a `Description` when its participants play the description's roles.
> Agents and entities `play` the roles defined.

Mapping our domain to DnS:

| Domain object | DnS class | Notes |
|---|---|---|
| `Fund` | `dul:Organization` (subclass of `dul:Agent`) | An agent endurant |
| `FundMandate` | `dul:Description` (specifically `dul:Plan`) | Defines the donor / recipient / funder / validator roles + eligibility conditions |
| `Donor` | `dul:Role` defined in FundMandate | A Person/Org plays this role when they pledge |
| `Recipient` | `dul:Role` defined in FundMandate | A Person/Org plays this role when their proposal is awarded |
| `Funder` | `dul:Role` defined in FundMandate | The Fund agent plays this role |
| `Validator` | `dul:Role` defined in FundMandate (optional) | A trusted third party plays this role |
| `GrantRound` | `dul:Description` (subclass of `dul:Plan`) | Describes a time-bounded round; refines the parent FundMandate |
| `GrantAwardAgreement` | `dul:Situation` (specifically `dul:CommitmentSituation`) | A particular awarded grant — a state of affairs satisfying the mandate |
| `Disbursement` | `dul:Event` (`dul:Action`) | A perdurant; the actual transfer |
| `OutcomeReport` | `dul:InformationObject` | A description-bearing entity |
| `OutcomeValidation` | `dul:Event` (`dul:AssessmentAction`) | The validating event |

The DnS pattern explains the temporal sequence cleanly:

```
FundMandate (Description)
  defines Role: Donor       (with policy: acceptsGiftKinds, ...)
  defines Role: Recipient   (with policy: fundsNeedKinds, geoRoot, ...)
  defines Role: Funder      (with policy: governanceModel, ...)
  defines Role: Validator   (with policy: trustedClass, ...)
  defines parameters: maxAwardPerProposal, eligibilityRules

GrantRound (Description, refines FundMandate)
  defines time window
  defines award cap

Award_42 (Situation, satisfies GrantRound which satisfies FundMandate)
  Donor role played by [Sarah, David, ...]
  Recipient role played by Ana
  Funder role played by NoCo Trauma-Care Fund
  Validator role played by Maria
  satisfies the eligibility, time window, award cap conditions
```

This is the canonical DnS triangle.

### 5.3 Why three pieces matter

If you collapse to two pieces (just Fund-as-Agent without separating Mandate-as-Description), you lose:

- **Multiple mandates per fund.** A fund can publish a 2026 mandate, then update to a 2027 mandate. Each mandate is its own description; the fund agent persists across mandates.
- **Mandate evolution via subDescription.** GrantRound `dul:Plan dul:isSubPlanOf` FundMandate captures *"this round inherits the mandate but adds a quarterly cap."*
- **Role redefinition.** A Validator role might exist in one mandate and not another.

If you collapse to two pieces the other way (just Mandate-as-Description without Fund-as-Agent), you lose:

- **Identity persistence.** Donors who care about *which fund* they're contributing to can't track it across mandate versions.
- **Treasury continuity.** Treasury must move atomically with mandate version changes — operationally fragile.
- **Trust accumulation.** A fund builds reputation over multiple grant rounds. Without an Agent identity, reputation has nowhere to attach.

The three-piece (Fund / FundMandate / Award) is the smallest sufficient model. Both PROV-O and DnS naturally use three core abstractions; we map onto both.

### 5.4 Codebase precedent

The smart-agent codebase already has both:

- **PROV-O backbone**: `tbox/core.ttl` and `tbox/people-groups.ttl` use `prov:Entity`, `prov:Activity`, `prov:wasDerivedFrom`, `prov:wasGeneratedBy` consistently.
- **DnS pattern**: `apps/web/src/lib/governance/proposals.ts` and the agent-relationship contract already use the situation/role pattern (a Proposal is a `dul:Situation` with proposer/voter/approver roles), per `docs/agents/ontologist.md`.

Adding Fund/Mandate/Award is *the same pattern* applied to grants. No new ontology infrastructure required.

### 5.5 Required T-Box additions (`docs/ontology/tbox/grants-fund.ttl`)

```turtle
sa:Fund
    a owl:Class ;
    rdfs:subClassOf prov:Organization , dul:Organization , sa:Agent ;
    rdfs:label "Fund / Grant Pool" .

sa:FundMandate
    a owl:Class ;
    rdfs:subClassOf dul:Plan , dul:Description , prov:Plan , prov:Entity ;
    rdfs:label "Fund Mandate" .

sa:GrantRound
    a owl:Class ;
    rdfs:subClassOf sa:FundMandate ;     # inherits, refines with time window
    rdfs:label "Grant Round" .

sa:Pledge
    a owl:Class ;
    rdfs:subClassOf prov:Entity , dul:CommitmentSituation ;
    rdfs:label "Pledge Commitment" .

sa:Proposal
    a owl:Class ;
    rdfs:subClassOf prov:Plan , dul:Plan ;
    rdfs:label "Proposal" .

sa:GrantAward
    a owl:Class ;
    rdfs:subClassOf prov:Entity , dul:CommitmentSituation ;
    rdfs:label "Grant Award Agreement" .

sa:Disbursement
    a owl:Class ;
    rdfs:subClassOf prov:Activity , dul:Action ;
    rdfs:label "Disbursement" .

sa:OutcomeReport
    a owl:Class ;
    rdfs:subClassOf prov:Entity , dul:InformationObject ;
    rdfs:label "Outcome Report" .

sa:OutcomeValidation
    a owl:Class ;
    rdfs:subClassOf prov:Activity , dul:AssessmentAction ;
    rdfs:label "Outcome Validation" .

# Roles defined by mandates
sa:DonorRole       a owl:Class ; rdfs:subClassOf dul:Role .
sa:RecipientRole   a owl:Class ; rdfs:subClassOf dul:Role .
sa:FunderRole      a owl:Class ; rdfs:subClassOf dul:Role .
sa:ValidatorRole   a owl:Class ; rdfs:subClassOf dul:Role .
sa:HubHostRole     a owl:Class ; rdfs:subClassOf dul:Role .

# Object properties
sa:hostsFund        a owl:ObjectProperty ; rdfs:domain sa:Hub ; rdfs:range sa:Fund .
sa:fundGovernedBy   a owl:ObjectProperty ; rdfs:domain sa:Fund ; rdfs:range sa:Agent .
sa:contributesToFund a owl:ObjectProperty ; rdfs:domain sa:Pledge ; rdfs:range sa:Fund .
sa:proposesTo       a owl:ObjectProperty ; rdfs:domain sa:Proposal ; rdfs:range sa:Fund .
sa:awardsProposal   a owl:ObjectProperty ; rdfs:domain sa:Fund ; rdfs:range sa:Proposal .
sa:basedOnIntent    a owl:ObjectProperty ; rdfs:domain sa:Proposal ; rdfs:range sa:Intent .
sa:formalizesIntent a owl:ObjectProperty ; rdfs:domain sa:Pledge ; rdfs:range sa:GiftIntent .
sa:fundsAward       a owl:ObjectProperty ; rdfs:domain sa:GrantAward ; rdfs:range sa:Proposal .
sa:disburses        a owl:ObjectProperty ; rdfs:domain sa:Disbursement ; rdfs:range sa:GrantAward .
sa:reportsOn        a owl:ObjectProperty ; rdfs:domain sa:OutcomeReport ; rdfs:range sa:GrantAward .
sa:validates        a owl:ObjectProperty ; rdfs:domain sa:OutcomeValidation ; rdfs:range sa:OutcomeReport .
sa:updatesTrust     a owl:ObjectProperty ; rdfs:domain sa:OutcomeValidation ; rdfs:range sa:TrustRelationship .
```

Plus PROV-O property re-use:

```turtle
# Agent attribution
sa:Pledge prov:wasAttributedTo  → Donor (Agent)
sa:Proposal prov:wasAttributedTo → Recipient (Agent)
sa:GrantAward prov:wasAttributedTo → Fund

# Activity association
sa:Disbursement prov:wasAssociatedWith → Fund
sa:OutcomeValidation prov:wasAssociatedWith → Validator

# Responsibility chain
sa:Disbursement prov:actedOnBehalfOf → Donor (transitively, via Pledge)

# Information flow
sa:GrantAward prov:wasInformedBy → Proposal → NeedIntent
sa:Disbursement prov:used → Pledge
```

---

## 6. Trade-off analysis

This section captures the major design choices with explicit alternatives.

### 6.1 Treasury rail

| Option | How | Pros | Cons | Recommendation |
|---|---|---|---|---|
| **Mock-ERC20 in dev, real-ERC20 in prod** | Fund's smart account holds tokens; transfers via standard ERC-20 + on-chain `atl:fundDisbursement` event | Real on-chain transfer event; testable | One contract more in fresh-start | **Pick this** for v1 |
| Off-chain pledge ledger | All pledges/disbursements are MCP rows + signed messages | Avoids any token contract complexity | No transfer event for indexers; reconciliation surface | Defer |
| ETH (native) | Fund holds ETH, transfers via `Address.transfer` | Simplest, no token | No metadata on transfer; not realistic for stable-currency grants | Reject |
| Real stablecoin (USDC/DAI) | Mainnet integration | Production-ready | Needs cross-chain or testnet faucets; out of scope | Defer to prod hardening |

### 6.2 Pledge privacy

| Option | What's on-chain | Pros | Cons | Recommendation |
|---|---|---|---|---|
| **No amount on-chain (just commitment)** | `atl:pledgedTo` (donor → fund) — boolean fact only | Maximum privacy; donor amounts only visible to fund via cross-delegation | Less transparent for matching-pool / quadratic | **Pick this** for v1 |
| Coarse buckets (`<5k`, `5k-50k`, `50k+`) | `atl:pledgedTo` + `coarseBucket` literal | Some transparency for matching algorithms | Reveals bucket; binning attack possible if # of pledges small | Phase 5 (when matching pool feature lands) |
| Exact amount | `atl:pledgedTo` + `amount` | Maximum transparency; quadratic funding works directly | Donor amounts publicly visible — privacy regression | Reject for v1; consider for explicit "public donor" mode |

### 6.3 Governance model

| Option | When | Implementation cost | Recommendation |
|---|---|---|---|
| **Single-coach approval** | Small funds (Trauma-Care, Bilingual Discipleship) | Trivial — owner signs | **Default for v1** |
| **Multisig (M-of-N)** | Mid-size funds (CIL Capital Pool: Cameron + Nick + Paul, 2-of-3) | Moderate — needs co-sign UI | **Add in F11** |
| **DAO vote (token-weighted)** | Treasury-DAOs | High — voting contract | Phase 5 |
| **Quadratic vote** | Public-good funding | High — quadratic math + identity verification | Phase 5+ |
| **Allocation algorithm (auto-approve under threshold, vote above)** | Hybrid | Moderate | Phase 5 |

### 6.4 Match types

From your write-up §9, ranked by complexity:

| Match type | v1 | Phase 5 | Phase 6+ |
|---|---|---|---|
| Direct match (gift ↔ need) | ✅ | | |
| Fund-mediated (gift → fund → award) | ✅ | | |
| Round-based match | ✅ (rounds are mandates with windows) | | |
| Restricted gift | ✅ (mandate eligibilityRules constrain awards) | | |
| Matching pool (1:N matching contributions) | | ✅ | |
| Quadratic funding allocation | | | ✅ |
| Conditional pledge (only releases if threshold met) | | ✅ | |
| Donor-advised gift (donor influences allocation) | | ✅ | |

### 6.5 Hub vs Fund vs DonorCircle

The hub is the directory; the fund is the treasury+mandate; the donor circle is a social grouping of givers.

| Entity | Has principal? | Has treasury? | Has mandate? | Recommended modeling |
|---|---|---|---|---|
| **Hub** | yes | no | no | Existing `atl:Hub`. Hosts funds via `HUB_HOSTS_FUND`. |
| **Fund** | yes | yes | yes (publishes mandate) | New `atl:Fund` agent type. |
| **DonorCircle** | optional | no | no — but has *member affinity* | v1: tag on pledges. Phase 5: own agent type if growth justifies it. |

If we made DonorCircle a full agent, we'd want `DONOR_CIRCLE_HAS_MEMBER` and a circle-level mandate ("we collectively support category X"). That's a real future capability, but punt for v1.

### 6.6 On-chain proposal vs off-chain proposal

| Option | What's on-chain | Pros | Cons |
|---|---|---|---|
| **Proposal text off-chain (in proposer's MCP); only `atl:proposalSubmitted` on-chain** | Hash + IRI only | Privacy; cheap | Verification requires fund cross-delegation |
| Proposal text on-chain | Full text | Anyone can audit | Expensive; reveals proposer's plans before approval |
| Hybrid: hash on-chain, full text gated by cross-delegation | Hash + commitment | Privacy + verifiability | Same as v1 recommendation |

**Pick option 1** — the proposer's intent should remain private until granted; reviewers see it via cross-delegation; publication on award is a separate decision the recipient can make.

### 6.7 Outcome privacy

Same trade-off as proposal text. Outcomes can include sensitive program data (e.g. names of trauma-care recipients).

| Option | Recommendation |
|---|---|
| Outcome report off-chain in recipient's MCP; cross-delegation grants fund read | **Pick this** for v1 |
| Outcome summary on-chain (hash only) | Add in F15 alongside validation |
| Outcome detail on-chain | Reject |

---

## 7. Permissions matrix

Every tool's auth, in one table:

| Tool | Caller | Read scope | Write scope |
|---|---|---|---|
| `register_fund` (admin) | Hub steward (in HUB_GOVERNED_BY allowlist) | n/a | Deploys fund agent, creates HUB_HOSTS_FUND edge |
| `register_fund_mandate` | Fund principal (or governance member) | own mandate | own mandate |
| `list_fund_mandates` (discovery) | anyone | public mandates | n/a |
| `list_funds_for_hub` | anyone | HUB_HOSTS_FUND edges | n/a |
| `pledge_to_fund` | Donor's session | none of fund | donor's MCP `pledges` row + cross-deleg to fund |
| `list_my_pledges` | Donor's session | donor's own pledges | n/a |
| `list_received_pledges` | Fund principal | fund's `pledges_received` | n/a |
| `submit_proposal` | Recipient's session | none of fund | recipient's MCP `proposals` row + cross-deleg to fund + atl:proposalSubmitted |
| `list_my_proposals` | Recipient's session | recipient's own proposals | n/a |
| `list_received_proposals` | Fund principal | fund's queue (proposals where submittedToFund=fund_principal) | n/a |
| `approve_proposal` | Fund's governance principal(s) | proposal | proposal_reviews row, optionally creates engagement on quorum |
| `list_engagements` (existing) | Either side of engagement | own side | n/a |
| `release_tranche` (existing, extended) | Fund principal (with award role) | own side | tranche row + atl:fundDisbursement + token transfer |
| `submit_outcome_report` | Recipient principal | own engagement | recipient's outcomes row + cross-deleg to fund |
| `validate_outcome` | Validator (per mandate) | outcome via cross-deleg | validation row + atl:outcomeValidated + TrustDeposit |
| `list_audit_log` | Fund principal | fund's own audit log | n/a |

---

## 8. Security boundaries

| Boundary | Crossed by | Enforced by |
|---|---|---|
| Donor's private MCP ↔ Fund | Cross-delegation issued by donor at pledge time | ERC-1271 + DataScopeGrant w/ `audience='urn:mcp:server:fund'` + resource=`pledges` |
| Recipient's private MCP ↔ Fund | Cross-delegation issued by recipient at proposal-submit time | ERC-1271 + DataScopeGrant + resource=`proposals` |
| Recipient ↔ Validator (for outcomes) | Cross-delegation issued at validation request | ERC-1271 + DataScopeGrant + resource=`outcomes` |
| Fund's treasury access | Fund principal (or governance multisig) | Smart-account ownership + DelegationManager caveats |
| Cross-fund (no boundary) | n/a — funds don't see each other's data unless donor pledges to multiple | n/a |
| Hub steward ↔ Fund | HUB_HOSTS_FUND relationship; steward can curate but not access fund treasury | Hub admin tools require hub-steward allowlist, never auto-elevate to fund |

Critical invariants (CI-enforced):

1. Every T1/T2 query in fund-mcp filters by `principal = fund_principal` (multi-tenancy lint rule from people-group-mcp pattern).
2. No tool reads from another principal's MCP without an explicit `crossDelegation` arg.
3. Treasury moves require fund's smart-account signature (or governance multisig threshold).
4. Outcome validations bind to the validating agent's identity via on-chain assertion — disputes traceable.

---

## 9. Audience strings

New audiences:

| URN | Server | Purpose |
|---|---|---|
| `urn:mcp:server:fund` | (new fund-mcp OR existing org-mcp with fund subtype — see §10) | All fund-side operations |

Cross-delegation grants per resource:

```ts
// Donor → fund
{ server: 'urn:mcp:server:fund', resources: ['pledges'], fields: ['amount','restrictions','expiresAt'] }

// Recipient (proposer) → fund
{ server: 'urn:mcp:server:fund', resources: ['proposals'], fields: ['*'] }

// Recipient → fund (outcome reporting)
{ server: 'urn:mcp:server:fund', resources: ['outcomes'], fields: ['summary','milestones','evidence'] }

// Validator → fund
{ server: 'urn:mcp:server:fund', resources: ['validations'], fields: ['*'] }
```

---

## 10. New MCP or extend org-mcp?

| Option | Pros | Cons |
|---|---|---|
| **New `fund-mcp`** | Clean separation; clear auditability per fund; one-port-per-domain pattern matches our existing layout | One more service in fresh-start |
| **Extend `org-mcp`** | One fewer service | Conflates fund-specific tools with general org tools; harder to delegate-scope per audience |
| **Per-fund instance** (one MCP process per fund) | Strongest isolation | Operational overhead; not warranted for v1 |

**Recommendation:** Extend `org-mcp` with fund-specific tables and tools, and use a new audience `urn:mcp:server:fund` to gate them. The fund tables are scoped by `principal=fund_smart_account`; the multi-tenancy isolation rule already covers the boundary. We'll re-evaluate as a separate `fund-mcp` if fund treasury operations become heavy enough to warrant it (Phase 5).

This means:

- `apps/org-mcp/` gets new tables: `fund_mandates`, `fund_pool_entries`, `pledges_received`, `proposal_reviews`, `outcome_validations`
- The audience constant `FUND_MCP_AUDIENCE = 'urn:mcp:server:fund'` is exported from `@smart-agent/sdk`
- A fund agent's session bootstraps with this audience; the existing `requireOrgPrincipalAny` becomes `requireFundPrincipalAny` (or extended to support multiple audiences cleanly)

---

## 11. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Treasury rail bug allows double-spend | High | Mock-ERC20 with standard transfer logic + tests; mainnet hardening separate phase |
| Pledge revocation race (donor revokes after award allocated) | Medium | Pledges marked `committed` on accept; allocation locks. Donor revokation only allowed on uncommitted portion. |
| Mandate ambiguity (proposal claims it matches but reviewer disagrees) | Medium | Mandate eligibility encoded as machine-checkable rules + manual review. Eligible-but-rejected outcome is normal. |
| Outcome validation fraud (validator approves false outcomes) | Medium | TrustDeposit penalizes validator on dispute. Multi-validator option available. |
| Fund principal compromise | High | Fund's smart account requires multisig governance for treasury moves. Compromise of one signer ≠ full compromise. |
| Cross-fund collusion (funds share private data) | Low | No infrastructure for this; would require explicit cross-delegation. |
| Identity-Sybil pledges (one entity creates many pledger identities to game matching pool) | Medium (only when matching pools land) | Defer to Phase 5 with identity-verification credentials |
| Mandate gaming (recipient writes proposal that technically satisfies mandate but isn't aligned) | Low | Manual review by fund governance is the safety net. |

---

## 12. Open architectural questions

These need IA / Ontologist / Security input before implementation:

1. **Fund subtype declaration** — declare `atl:Fund` as a new resolver agent-type constant (parallel to `atl:OrganizationAgent`, `atl:HubAgent`), or add it as a *role* an Organization plays? The clean ontology answer is "new type"; the operational answer is "roles are cheaper."
2. **Multiple roles per agent** — a Person could be both Donor (in one fund) and Validator (in another). Does our role model handle this naturally? (Answer: yes if roles are per-relationship-edge, not per-agent. But verify.)
3. **Mandate immutability** — once a mandate is published on-chain, can it be edited? Or only revoked-and-replaced? Provenance suggests revoke-and-replace; pragmatism suggests minor-version edits.
4. **Pledge revocability** — full revocation, partial revocation, or only-uncommitted-portion revocable? Affects donor-trust narrative; Phase 5 may add escrow-style locks.
5. **Cross-fund pledges** — can a single GiftIntent contribute to multiple funds (e.g. "$5k for trauma care, distributable across NoCo and CIL pools")? Adds complexity; defer.
6. **Round closure semantics** — when a round closes, what happens to pledges? Roll over to next round, refund to donor, transfer to fund's general pool? Per-round policy.
7. **Outcome aggregation** — when N awards from one round produce N outcome reports, the round itself has an aggregate outcome. Where does it live? Per-fund summary table.

---

## 13. Comparison to existing patterns

| Existing pattern | Used here | Adaptation |
|---|---|---|
| Hub agent hosts member agents | ✅ | Extended: hub now hosts both Person/Org members AND Fund children |
| Engagement+tranche model | ✅ | A grant award IS an engagement (`kind='grant-award'`) |
| TrustDeposit on assertion validation | ✅ | Outcome validation triggers a deposit |
| ORG_GOVERNANCE relationship + cross-delegation | ✅ | FUND_GOVERNED_BY mirrors the same shape |
| Per-MCP audience with cross-delegation gating | ✅ | New audience `urn:mcp:server:fund`; same gating mechanism |
| Public on-chain assertion → GraphDB sync → discovery SDK | ✅ | New predicates ride existing rails |
| Multi-source disagreement (multiple estimates per segment in people-group-mcp) | ✅ | Multiple proposals per round; multiple validations per outcome |

The grants/fund layer is **almost entirely a recombination of patterns we already have.** The only genuinely new pieces are:
- The `Fund` agent type
- The mock-ERC20 contract for treasury
- The `FundMandate` description class

Everything else is "apply the existing pattern to this new agent kind."

---

## 14. Decision summary

| # | Decision | Resolution |
|---|---|---|
| 1 | Fund-as-Agent | ✅ Yes; with FundMandate-as-Description and Award-as-Situation (DnS triangle) |
| 2 | New MCP or extend org-mcp | Extend org-mcp; new audience `urn:mcp:server:fund` |
| 3 | Treasury rail | Mock-ERC20 in dev; production hardening later |
| 4 | Pledge privacy | No amount on-chain (just `atl:pledgedTo` commitment); exact amount via cross-delegation only |
| 5 | Governance model v1 | Single-coach default; multisig added in F11 (CIL Capital Pool needs it) |
| 6 | Match types v1 | Direct + fund-mediated (need-side and gift-side) + round-based |
| 7 | Outcome privacy | Off-chain in recipient MCP; hash on-chain at validation |
| 8 | Donor circle modeling | Tag on pledges in v1; own agent type Phase 5 |
| 9 | Round cap enforcement | Hard reject pledges that exceed cap; waitlist Phase 5 |
| 10 | Outcome+validation in v1 | Yes — closes the trust loop |
| 11 | Fund subtype | New resolver agent type `atl:Fund` (vs role-on-Organization) |
| 12 | Mandate immutability | Revoke-and-replace via assertion (with link to predecessor); minor edits via setMetadataURI on the fund's mandate edge |

This document is the architectural reference. The companion design and planning docs will reference back to specific sections by number.
