# Funding Models — Survey & Alignment to the Need ↔ Mandate ↔ Gift Framework

**Status:** Strategic landscape doc
**Companion to:** `docs/specs/grants-fund-architecture.md`, `docs/specs/matchmaking-strategy.md`
**Purpose:** Understand which existing funding models we can support, what mechanics each requires, and how cleanly our `Need ↔ Mandate ↔ Gift` framework expresses each. Calibrate the v1 / Phase-5 scope from a real landscape rather than from one example.

---

## 0. Why we're not building OpenSea

OpenSea is a two-party marketplace:

```
Seller offer ↔ Buyer bid → Sale (escrow + transfer)
```

It works because:
- The good is directly transferred (NFT, token).
- Both parties' interests align *at the moment of trade*.
- No mediation needed; the escrow is the only third party.
- Clearing is instant.

**Our problem is fundamentally different:**

- The good (resources for trauma-care training) doesn't move directly between donor and recipient.
- Donor's "interest" is the realized outcome (people trained), not what the recipient hands them.
- Mediation is *required*: mandates filter eligible recipients; reviewers vouch for proposals; validators confirm outcomes.
- The temporal sequence is asynchronous: pledges arrive when donors are ready; proposals arrive when recipients have a plan; allocation happens when governance approves; outcomes are reported months later.

So we model the marketplace as a **publish-and-discover protocol with an explicit mediator agent**:

```
GiftIntent       NeedIntent
     ↓                ↓
  Pledge          Proposal
     ↓                ↓
        FundMandate (mediates)
              ↓
        GrantAward
              ↓
       Disbursement
              ↓
       OutcomeReport
              ↓
     OutcomeValidation → TrustUpdate
```

The Fund / Hub is the mediator. Different funding *models* are different mediator policies on top of the same primitives.

---

## 1. Survey of funding models

### 1.1 Direct gift (1:1)

| | |
|---|---|
| **Pattern** | Donor gives directly to recipient. Donor and recipient know each other (or are introduced). |
| **Real-world examples** | Personal sponsorship; matched mentor-mentee programs; church benevolence direct gifts; emergency mutual aid via friends-of-friends |
| **Mechanics** | Donor sends; recipient receives; trust based on personal relationship or one-shot vouch from a trusted third party |
| **Solves** | Lowest overhead; preserves relationship; donor sees direct impact |
| **Doesn't solve** | Doesn't scale beyond personal networks; no aggregation; no risk-spreading; donor must vet recipient personally |
| **In our framework** | Direct match (no Fund). `GiftIntent ↔ NeedIntent` aligned by matcher; both parties confirm; no mandate required. |
| **v1 status** | ✅ Supported — this is the "direct match" path in `aggregator.ts:matchesProposed` |

### 1.2 Donor-Advised Fund (DAF)

| | |
|---|---|
| **Pattern** | Donor contributes to a fund up-front (gets immediate tax benefit). Donor *advises* allocation later but the fund is the legal grant-maker. |
| **Real-world examples** | Fidelity Charitable, Schwab Charitable, Vanguard Charitable, Endaoment.org (crypto DAF); ~$230B in US DAFs as of 2023 |
| **Mechanics** | Donor → Pledge → Fund's general pool; donor recommends grants; fund's board approves; fund disburses; recipient receives from fund (not donor) |
| **Solves** | Time-decoupling (donor commits when ready; allocations later); aggregation (one donor portfolio, many recipients); legal/tax treatment; recipient sees one funder not many |
| **Doesn't solve** | Donor "advises" can become rubber-stamp; mandates are loose; no transparency on who actually benefits |
| **In our framework** | Fund-mediated with a `governance.model = donor-advised` policy. Donor's pledge has a `recommendation` annotation; fund approves with default-yes-unless-objection. |
| **v1 status** | ✅ Pattern fits exactly. Default v1 behavior is single-coach approval; DAF style (auto-approve donor recommendations within mandate) is a governance flag we can add in F11. |

### 1.3 Traditional foundation grant cycle (RFP)

| | |
|---|---|
| **Pattern** | Foundation publishes RFP describing what they fund. Applicants submit proposals during a window. Foundation reviews and awards. |
| **Real-world examples** | Lilly Endowment grant cycles; Templeton Foundation RFPs; NIH R01 grants; Gates Foundation programs |
| **Mechanics** | Foundation → publishes RFP → window opens → applicants submit → reviewers score → board approves → disburse with milestones → outcome report → trust update |
| **Solves** | Strong mandate alignment (foundation's strategy → applicant fit); rigorous review; transparent criteria; multi-year tracking |
| **Doesn't solve** | High overhead (long review cycles); favors organized applicants; strategy locked at cycle start |
| **In our framework** | Fund-mediated with explicit `GrantRound` (a refinement of FundMandate with time window). RFP = the mandate text. Applicants submit Proposals during round window. Board = governance.model multisig. |
| **v1 status** | ✅ Native fit. F11 (approval flow) supports time-windowed rounds and review queue. |

### 1.4 Mutual aid pool

| | |
|---|---|
| **Pattern** | Members of a community contribute to a shared pool; when any member has a need, they request from the pool. Often horizontal / no formal hierarchy. |
| **Real-world examples** | Mutual Aid networks during COVID-19; church benevolence funds; Quaker meetings' care funds; rotating savings clubs (ROSCAs); Unchained Capital Bitcoin mutual aid |
| **Mechanics** | Members contribute on schedule or as able; needs surface organically; consensus-light approval (often "first-come, first-served with sanity check"); no formal review |
| **Solves** | Solidarity; rapid response; low bureaucracy; bidirectional (donor today, recipient tomorrow) |
| **Doesn't solve** | Free-rider problem; can't fund large needs; no rigorous outcome tracking |
| **In our framework** | Fund-mediated with `governance.model = consensus-light` (auto-approve under threshold) and `mandate.eligibilityRules = members-only`. The membership constraint makes it a Hub-bound fund. |
| **v1 status** | ⚠️ Possible but requires adding a "membership constraint" to mandate eligibility. The hub already has HAS_MEMBER edges; the eligibility check just needs to read them. Plausible in F10 or as F10.5. |

### 1.5 Matching pool

| | |
|---|---|
| **Pattern** | A larger sponsor pledges a matching pool. Smaller donors' contributions are *matched* by the pool at some ratio (often 1:1 or tiered). |
| **Real-world examples** | GivingTuesday matching campaigns; corporate-match programs (employer matches employee donations); Gitcoin's matching pools |
| **Mechanics** | Sponsor → pledges matching pool with cap and matching ratio → public donors give → at allocation time, sponsor's match is computed and added |
| **Solves** | Amplifies small-donor impact; signaling (sponsor lends credibility); incentive design (donors give more when matched) |
| **Doesn't solve** | If sponsor walks back the pool, donors feel betrayed; ratio gaming; concentration risk if sponsor cap is too small |
| **In our framework** | Fund's pool is *partitioned* into base contributions + matching pool. The matching pool is a `Pledge` with `restrictions.matchOnly: true`. Allocation algorithm at award time computes the match. |
| **v1 status** | ⚠️ Phase 5. Requires partitioning logic and a matching-allocation algorithm. The `restrictions` field on pledges already accommodates this; just no UI/algorithm in v1. |

### 1.6 Quadratic Funding (QF)

| | |
|---|---|
| **Pattern** | Capital from a matching pool is allocated to projects in proportion to the **square of the sum of square-roots** of individual contributions: `match[p] = (Σ √(c_i))²` for each project p. This rewards *broad support* over *concentrated wealth*. |
| **Real-world examples** | Gitcoin Grants (since 2019, ~$50M+ allocated); Optimism RetroPGF Round 2; CLR.fund; Snapshot Plurality voting variants |
| **Mechanics** | <ol><li>Matching pool $M is committed.</li><li>Donors contribute $c_i to projects.</li><li>For each project p: compute QF allocation = `(Σ_i √c_i)²`.</li><li>Normalize so that Σ_p allocations == M.</li><li>Recipient gets its own donations + its QF match.</li></ol> |
| **Solves** | Public-goods funding optimally (broad support → strong signal). Anti-plutocratic: 100 donors × $1 each beats 1 donor × $100 in matching. |
| **Doesn't solve** | Sybil attacks (one entity creates many fake donors to inflate broad support). Requires identity verification. Donations must be small to be effective. |
| **In our framework** | Fund-mediated with `governance.model = quadratic-allocation`. Each Pledge is a contribution; allocation algorithm runs at round close. **Critical extra primitive: identity verification (anti-Sybil)**. We have AnonCreds — Sybil-resistance can ride on holder credentials. |
| **v1 status** | ❌ Phase 5. Requires: (a) identity-verification credential layer, (b) QF allocation algorithm, (c) per-project donor list visible at round close, (d) Pledge protocol that allows multiple small commitments per donor. The framework supports it; the implementation work is substantial. |

#### Why QF matters for our system

QF is the most *interesting* case because it **changes the role of the matchmaker**. In direct match, the matcher pairs donors and recipients. In a QF fund, the matcher just lists *eligible* projects and *eligible* donors — the *allocation* is done by an algorithm that runs at round close, not by case-by-case approval.

This means our Fund agent's `governance.model` field needs to support:

- `single-coach` (one approver)
- `multisig` (M-of-N approvers)
- `donor-advised` (donors recommend; coach rubber-stamps within mandate)
- `consensus-light` (auto-approve under threshold; review above)
- `quadratic-allocation` (algorithmic at round close)
- `dao-vote` (token-weighted)

Each is a different algorithm that takes (proposals, pledges, mandate) → (awards). The matchmaking challenge in QF is *anti-Sybil*: are these N donors actually N different humans? We can answer that with our AnonCreds rails (if a donor presents a "verified-human" credential, they count for QF; otherwise they don't).

### 1.7 DAO treasury vote

| | |
|---|---|
| **Pattern** | Token-holders of a DAO vote on grant proposals. Treasury is the DAO's. Vote is token-weighted. |
| **Real-world examples** | Compound governance grants; MakerDAO MIPs; Uniswap UNI grants; ENS DAO public-goods grants |
| **Mechanics** | Proposer submits → DAO debates → token-holders vote (often via Snapshot off-chain or on-chain) → quorum + threshold → executes treasury transfer |
| **Solves** | Permissionless allocation; alignment with token-holder interests; transparent vote |
| **Doesn't solve** | Plutocracy (1 token = 1 vote concentrates power); voter apathy; cartel formation |
| **In our framework** | Fund-mediated with `governance.model = dao-vote`, `governance.token = <token-contract>`, `governance.quorum = X%`, `governance.threshold = Y%`. |
| **v1 status** | ⚠️ Phase 5. Voting infrastructure is its own large piece (Snapshot-style or on-chain proposals contract). Defer until governance demand justifies it. |

### 1.8 Prize / bounty funding

| | |
|---|---|
| **Pattern** | Sponsor announces a bounty for solving a specific problem. Solvers submit work. Best (or any qualifying) solution gets the prize. |
| **Real-world examples** | Kaggle competitions; Gitcoin bounties; X Prize Foundation; security CTFs; Optimism's bounty board |
| **Mechanics** | Sponsor → publishes problem statement + prize → submission window → judging → award |
| **Solves** | Goal-defined funding; risk transfer (only successful solvers paid); broad participation |
| **Doesn't solve** | Winner-take-all dynamics (losers expended effort uncompensated); judging subjectivity; can incentivize narrow optimization |
| **In our framework** | Fund-mediated with `mandate.kinds = [SolvedProblemNeed]`, `governance.model = bounty-judge`, and a special case where `Proposal` includes "submitted solution" not just plan. |
| **v1 status** | ⚠️ Phase 5+. Requires problem-statement + solution-submission flow. Conceptually the same Mandate / Proposal pattern with different semantics. |

### 1.9 Retroactive funding (RetroPGF)

| | |
|---|---|
| **Pattern** | Recipients do work first; sponsor evaluates impact retroactively and rewards. Inverts the typical funding sequence. |
| **Real-world examples** | Optimism RetroPGF Rounds 1-4 (~$60M+ disbursed); Vitalik Buterin's retroactive funding essays; some impact-investing variants |
| **Mechanics** | Window of past activity → sponsors nominate impact-makers → community/badge-holders vote on impact → pool distributed proportional to votes |
| **Solves** | Bypasses speculation about future impact; rewards what actually worked; reduces grant-pitching overhead |
| **Doesn't solve** | Recipients need bootstrap capital; impact assessment is hard; favors visible/measurable impact over slow-burn projects |
| **In our framework** | Fund-mediated where `Proposal` is a *retrospective claim* of past work, and `OutcomeReport` is submitted *with* the proposal (not after award). Validators score based on demonstrated impact. The temporal arrow flips. |
| **v1 status** | ⚠️ Phase 5+. Same primitives, different sequence. Easy to add once F11 approval flow is in place. |

### 1.10 Restricted gift / endowment

| | |
|---|---|
| **Pattern** | Donor specifies that their gift can only fund things matching specific criteria (geo, kind, recipient class). Often perpetual. |
| **Real-world examples** | University endowed chairs; restricted scholarship funds; "must support women in STEM" gifts; geo-restricted disaster relief |
| **Mechanics** | Pledge has restrictions field → fund respects when allocating; only eligible proposals can draw on this pledge |
| **Solves** | Donor intent honored long after donor; theme-specific funds; multi-generational impact |
| **Doesn't solve** | Restrictions can become outdated; over-restriction blocks responsive use; tracking compliance |
| **In our framework** | Pledge has `restrictions: {kinds, geoRoot, recipientClass, temporalScope, …}`. Fund's allocation algorithm respects pledge-level restrictions when picking which pledges back which awards. |
| **v1 status** | ✅ Pledge schema accommodates this. Allocation logic in F11 must respect it (simple filter). |

### 1.11 Crowdfunding (all-or-nothing)

| | |
|---|---|
| **Pattern** | Recipient publishes campaign with goal + deadline. Donors pledge. If goal met by deadline, pledges collected and recipient funded. If not, all pledges refunded. |
| **Real-world examples** | Kickstarter; Indiegogo; GoFundMe (variant: keep-what-you-raise); Mirror.xyz crowdfunds |
| **Mechanics** | Recipient → opens campaign with target → donors pledge with conditional commit → at deadline either threshold met (collect) or not (release) |
| **Solves** | Demand validation pre-payment; donor protection (no funds disbursed if project undersubscribed); built-in marketing |
| **Doesn't solve** | Long tail of failed campaigns; gaming the goal; not suitable for ongoing operations |
| **In our framework** | A `Pledge` with `conditional.thresholdMet` predicate and `conditional.deadline`. Pledge moves from "soft" to "committed" only when threshold check passes at deadline. |
| **v1 status** | ⚠️ Phase 5. Pledge state machine extension. |

### 1.12 Patronage / subscription

| | |
|---|---|
| **Pattern** | Donor sets up recurring contribution to a recipient (or fund). Contributions can be paused/canceled; benefits delivered continuously. |
| **Real-world examples** | Patreon; Substack subscriptions; Gitcoin streaming; church tithing |
| **Mechanics** | Donor → recurring pledge with cancellation rights → fund disburses continuously to recipient(s) → ongoing outcome reporting |
| **Solves** | Sustained funding for ongoing work; donor connection; predictability for recipient |
| **Doesn't solve** | Cancellation risk; recipient-dependent (vs project-dependent) |
| **In our framework** | Pledge has `schedule: {kind: 'recurring', cadence, amount, until}`. Fund disburses on schedule. Cancellation = revoke pledge. |
| **v1 status** | ⚠️ Phase 5+. Requires scheduled-disbursement infrastructure beyond tranches. Defer. |

### 1.13 Revenue-sharing (CIL pattern)

| | |
|---|---|
| **Pattern** | Investor capital deployed to operating businesses; businesses share % of revenue back to investors until cap; capped returns recycled into new investments. |
| **Real-world examples** | Mission Collective Hub (CIL demo); Indie.vc; revenue-based financing (RBF); some impact-investing structures |
| **Mechanics** | Investor → contributes to fund → fund deploys to operator (Afia's Market, Kossi Mobile Repairs) → operator submits revenue reports → fund collects revenue share → at cap, capital returned to investor or recycled |
| **Solves** | Aligned incentives; capital recycling; non-equity (operator keeps ownership); sustainable funding stream |
| **Doesn't solve** | Hard for early-stage / pre-revenue; revenue-tracking overhead; revenue manipulation |
| **In our framework** | Fund with `mandate.kinds = [CapitalNeed]`, `governance.model = council`, and a *bidirectional* engagement: outflow (Award) and inflow (RevenueReport → returns). The CIL demo already has revenue_reports in org-mcp. |
| **v1 status** | ✅ Mostly there. CIL demo already has revenue reports + proposals. The "fund recycles capital" loop needs the F12 (disbursement) + F14 (outcome) flows hooked together. |

---

## 2. Pattern crosswalk

How each model maps onto our four-phase pipeline:

| Phase → Model ↓ | Pledge | Mandate / Round | Allocation | Disbursement | Outcome |
|---|---|---|---|---|---|
| **Direct gift** | n/a (direct) | n/a | matchmaker | direct transfer | optional |
| **DAF** | upfront | per-fund | donor-recommends + fund-approves | from fund | optional |
| **Foundation RFP** | (already in fund) | published RFP / round | board review | tranches | required |
| **Mutual aid** | recurring | members-only mandate | consensus-light | from pool | informal |
| **Matching pool** | sponsor-pool + small donors | mandate + match-ratio | algorithmic at allocation | from fund | required |
| **Quadratic funding** | many small pledges + matching pool | round + identity-verified | QF allocation algorithm | from match + own | required |
| **DAO vote** | DAO treasury | mandate | token-weighted vote | from treasury | required |
| **Bounty** | sponsor pool | problem statement | judge selects winner | to winner | (proof of work = part of submission) |
| **Retroactive** | sponsor pool | impact criteria | community votes on past impact | proportional | (already happened — claimed in submission) |
| **Restricted gift** | restricted pledge | mandate must accept restrictions | match restrictions to proposals | from restricted pool | required |
| **Crowdfunding** | conditional pledge | campaign goal/deadline | threshold check | release at deadline if met | required |
| **Patronage** | recurring pledge | none/light | continuous | scheduled | continuous reports |
| **Revenue-share** | investor capital | revenue-share contract | capital deploy | tranches | revenue reports + cap return |

The matrix shows: every model fits the four-phase pipeline. What changes is *the policy at each phase*. The Fund's `governance.model` + `pledge.restrictions` + allocation algorithm cover the variability.

---

## 3. What primitives we need to support all of them

| Primitive | Required by | v1 ships | Phase 5 |
|---|---|---|---|
| `Pledge` with `amount`, `restrictions`, `expiresAt` | All except direct gift | ✅ | |
| `Pledge.schedule = recurring` | Patronage | | ✅ |
| `Pledge.conditional.thresholdMet` | Crowdfunding | | ✅ |
| `Pledge.matchOnly: true` | Matching pool | | ✅ |
| `Pledge.donorRecommendation` | DAF | | ✅ |
| `FundMandate.governance.model` enum | All | ✅ (single-coach + multisig in v1) | quadratic, dao-vote, bounty-judge in Phase 5 |
| `FundMandate.eligibilityRules` (members-only, kind, geo) | All | ✅ | |
| `FundMandate.matchingRatio` | Matching pool | | ✅ |
| `GrantRound` (mandate refinement with time window) | RFP, QF, Retroactive | ✅ | |
| `Proposal.basedOnIntentIri` | All | ✅ | |
| `Proposal.submittedSolution` | Bounty | | ✅ |
| `Proposal.retrospective: true` | Retroactive | | ✅ |
| Identity-verification credential | QF (anti-Sybil) | (existing AnonCreds rails) | ✅ verifier integration |
| Allocation algorithm registry | All policy variants | ✅ (single-coach, multisig); | ✅ (QF, DAO-vote, bounty, retro) |
| `Disbursement` with tranches | All | ✅ | scheduled-disbursement for patronage in Phase 5 |
| `OutcomeReport` | RFP, QF, retro, restricted, revenue-share | ✅ | |
| Reverse cash-flow (`ReturnedCapital`) | Revenue-share | | ✅ in F14 extension |
| Trust update via `TrustDeposit` | All with outcomes | ✅ | |

**v1 covers about 60% of the surface** (direct, DAF, RFP, restricted, revenue-share, mutual aid with eligibility hint). **Phase 5 fills in the remainder** (matching pool, QF, DAO vote, bounty, retroactive, crowdfunding, patronage).

---

## 4. Quadratic funding — deeper dive

You asked specifically about QF. Here's the math + mechanics + integration.

### 4.1 The formula

For a pool of matching capital `M` and projects `p ∈ P`, with donor `i` contributing `c_{ip}` to project `p`:

```
For each project p:
  S_p = (Σ_i √c_{ip})²       # the QF "score" — sum of square-roots, then squared

  match_p = M × (S_p / Σ_q S_q)   # normalized share of matching pool
```

The intuition: a project with 100 donors of $1 has `S = (100 × √1)² = 10000`. A project with 1 donor of $100 has `S = (1 × √100)² = 100`. The 100 donors get **100x the matching** despite contributing the same total. *Broad support* dominates *concentrated wealth*.

### 4.2 What QF needs that single-coach doesn't

1. **Many small pledges per donor**, not one big pledge per donor. The QF math works because the marginal impact of small contributions is high.
2. **Identity verification (Sybil resistance).** If a single human can create 100 sock-puppet accounts, they get 100x matching for free. QF *requires* an identity layer.
3. **Round-based clearing.** QF computes allocations once per round, not per proposal. The matchmaker is a batch algorithm at round close, not a streaming approval.
4. **Public donor list per project** at round close. Without it, the QF score can't be computed.
5. **Capped matching pool.** Matching can't exceed the pool — normalization step handles overflow.

### 4.3 How QF integrates with our framework

**Mandate side:**

```yaml
FundMandate:
  governance.model: quadratic-allocation
  matchingPool:
    cap: 50000
    sponsors: [hub-donor-1, hub-donor-2]   # contribute to the matching pool itself
  identityRequirement:
    credentialType: "VerifiedHuman"        # AnonCreds policy
    minTrustScore: 5
```

**Pledge side:**

```yaml
Pledge:
  donor: <person-agent>
  fund: <fund-agent>
  project: <proposal-id>     # QF requires donor specifies WHICH project
  amount: 25
  identityProof:
    credentialDef: "VerifiedHuman.v1"
    presentation: <AnonCreds-proof-blob>
  restrictions: { matchingRequired: true }
```

**Allocation:**

At round close, the fund's QF-allocator runs:

```ts
function quadraticAllocate(round: GrantRound): Allocation[] {
  const projects = listEligibleProposals(round)
  const pledges = listPledgesByProject(round, projects)   // per proposal, list of (donor, amount)
  // Sybil filter: keep only pledges with valid VerifiedHuman proof
  const validatedPledges = pledges.filter(p => verifyHumanProof(p.identityProof))

  // Compute QF scores
  const scores = projects.map(proj => {
    const sumSqrt = validatedPledges
      .filter(p => p.project === proj.id)
      .reduce((s, p) => s + Math.sqrt(p.amount), 0)
    return { project: proj.id, score: sumSqrt * sumSqrt }
  })
  const total = scores.reduce((t, s) => t + s.score, 0)
  const M = round.matchingPool.cap

  return scores.map(s => ({
    project: s.project,
    matchingAllocation: M * (s.score / total),
    directContributions: sumDirect(s.project, validatedPledges),
  }))
}
```

The output is per-project allocations. The fund then creates Awards for each project (one Award per project = one Engagement = standard tranche disbursement). 

### 4.4 Why our framework supports QF cleanly

Three reasons:

1. **Mandate as policy slot.** The `governance.model` field is just a name; the implementation is registered. We can add `quadratic-allocation` without touching the rest of the pipeline.
2. **AnonCreds already exists.** We have `verifier-mcp`, `credential-registry`, holder wallets in `apps/person-mcp/askar-stores`. A "VerifiedHuman" credential is just another credential type. The existing presentation flow handles Sybil-resistance without new crypto.
3. **Round-based clearing is a batch tool.** F11 has `approve_proposal`. F11.5 (Phase 5) adds `close_round_and_allocate` — same shape, different algorithm.

### 4.5 What QF doesn't solve (and we shouldn't pretend)

- **Plutocracy at the matching-pool layer.** Whoever funds the matching pool *chooses what gets matched*. QF democratizes within a pool but not the pool's existence.
- **Project gaming.** Splitting one project into N smaller projects can harvest more matching. Heuristic mitigations (max projects per recipient, conceptual deduping) are practical but not formal.
- **Identity costs.** VerifiedHuman credentials require an issuance flow. If the issuer is captured, Sybil attacks return.

These are fundamental QF problems, not framework problems. We support QF; we don't claim to fix QF.

---

## 5. Mandates as the strategic frame

Across all 13 models, the **Mandate** is the single most important object. The mandate captures:

- *What* the fund supports (need kinds, geo, eligibility)
- *How* allocations are decided (governance model)
- *On what schedule* (continuous / round-based / triggered)
- *With what evidence* (outcomes required, validators acceptable)
- *With what privacy* (donor visibility, recipient visibility)
- *With what constraints* (per-recipient cap, total round cap, recurring vs one-shot)

A well-designed mandate is **policy-as-data**. Our design encodes this:

```yaml
FundMandate:
  acceptsGiftKinds: ['CapitalOffer', 'TimeOffer', 'CoachingOffer']
  fundsNeedKinds: ['CapitalNeed', 'CoachingNeed', 'GuidanceNeed']
  geoRoot: 'us/colorado'
  eligibilityRules:
    membersOnly: <hub-id>           # mutual-aid pattern
    minTrustScore: 5                 # quality gate
    requiredCredentials: ['VerifiedOrgWith501c3']  # legal pattern
  governance:
    model: 'quadratic-allocation' | 'multisig' | 'single-coach' | ...
    quorum: 2                        # multisig
    threshold: 0.5                   # vote threshold
    matchingRatio: 1.0               # matching-pool ratio
  schedule:
    kind: 'continuous' | 'round-based' | 'triggered'
    roundDuration: 'P30D'            # ISO 8601 duration
    nextRoundOpens: '2026-06-01'
  evidence:
    outcomesRequired: true
    validatorTrustClass: 'verified'
  privacy:
    donorVisibility: 'public' | 'public-coarse' | 'private-to-fund'
    recipientVisibility: 'public-on-award' | 'private'
  caps:
    perRecipient: 50000
    perRound: 100000
```

This is just a structured `dul:Description` (the DnS pattern from the architecture doc §5.2). Every model in §1 is a different pattern of values for these fields.

---

## 6. Strategic recommendation

### 6.1 v1 scope (4 weeks of work, 16 commits per architecture doc)

Ship the policies that cover the most demo and real-world use:

- **Single-coach approval** (most small funds)
- **Multisig governance** (CIL Capital Pool, larger orgs)
- **DAF-style donor recommendations** (Trauma-Care Fund: Sarah pledges, Maria approves matching proposals)
- **Restricted gifts** (geo + kind constraints)
- **Round-based RFP cycle** (Trauma-Care opens Q2 round)
- **Revenue-share recycling** (CIL Wave 1/2 with Afia)
- **Direct match** (preserved as fallback when no fund matches)

This is roughly the architecture doc's F1–F16 plan, with the Mandate schema generalized to accommodate richer governance models.

### 6.2 Phase 5 scope

Add the policy slots that distinguish modern funding:

- **Matching pool** (sponsor matches small donors)
- **Quadratic funding** (with AnonCreds-based Sybil resistance)
- **Retroactive funding** (claim past impact; community validates)
- **Crowdfunding goals** (all-or-nothing pledges)
- **Mutual-aid eligibility** (members-only via hub HAS_MEMBER)
- **Bounty-style problem-statement → solution-submission**
- **Patronage / recurring pledges**
- **DAO token-weighted vote**

Each is a new `governance.model` enum value + an allocation algorithm. The pipeline stays the same.

### 6.3 Out of scope for now

- **Cross-fund pledges** (one pledge that funds multiple funds proportionally)
- **Liquid democracy** (delegate vote)
- **Conviction voting** (vote weight grows with time)
- **Streaming money** (Superfluid-style continuous payments)
- **Off-chain → on-chain bridge for fiat** (need legal entity + KYC pipeline)

These are real and interesting; we revisit when there's a concrete demand.

---

## 7. Pattern that wins

The strategic insight from this survey:

> Every funding model is a different *policy* layered on the same primitives:
>   - publish intent
>   - aggregate via mandate
>   - allocate via governance
>   - disburse via tranches
>   - validate via outcomes

If we get the *primitives* right (Need/Mandate/Gift/Pledge/Proposal/Award/Disbursement/Outcome/Validation) and make *policy* configurable per Mandate, we cover the full landscape with one architecture.

This is the leverage point. **Our job is not to pick one model. Our job is to make the model the steward picks be a configuration choice on the Mandate.**

That's why the Fund-as-Agent + Mandate-as-Description + Award-as-Situation triangle in the architecture doc isn't just ontology cleanliness — it's the technical mechanism that lets us support direct gifts, foundation cycles, mutual aid, matching pools, QF, DAO votes, bounties, retroactive funding, restricted endowments, crowdfunding, patronage, and revenue-sharing **with the same code path and different mandate configurations.**

The matchmaker (next doc) is the runtime piece that makes this possible.
