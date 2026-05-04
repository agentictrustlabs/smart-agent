# Faith Funding & Stewardship — Three Lanes of Generosity

**Status:** Strategic / domain reference doc
**Companion to:** `funding-models-survey.md`, `gitcoin-grants-deep-dive.md`, `matchmaking-strategy.md`, `agentic-hub-and-bdi.md`
**Purpose:** Faith-based mission funding is the closest real-world analogue to what we're building — a hub of aligned intents across multiple coordinated mechanisms, not a two-party marketplace. This doc surveys the patterns, refines the object model to honor stewardship properly, and defines the "three lanes" framing that drives the matcher's card types.

---

## 0. The strategic claim

Faith communities have been doing distributed generosity at scale for centuries. The infrastructure they built — designated giving, missions budgets, faith promises, missionary support teams, donor-advised funds, giving circles, mission emphasis campaigns — is a battle-tested *coordination protocol*, not just a payment rail.

The protocol's central insight: **generosity flows through three structurally different lanes, each with different cadence, evidence, trust, and stewardship requirements**. A system that flattens all three into a single "donate" button systematically excludes most actual giving practice.

Our hub architecture should support all three:

| Lane | Pattern | Faith analogue | Match-card flavor |
|---|---|---|---|
| **Relationship** | Direct, recurring, rapport-driven | Missionary partnership; mentorship; benevolence | "Start support", "Schedule conversation", "Make recurring pledge" |
| **Pool** | Stewarded aggregation; donor influence not control | Church missions budget; DAF; giving circle; faith promise | "Pledge to fund", "Recommend grant", "Join circle", "Honor faith promise" |
| **Proposal** | Formal review, rigorous outcomes | Foundation grant; mission board award; partnership grant | "Submit proposal", "Apply to round", "Request review" |

Plus a meta-pattern that activates the lanes:

| Wrapper | Pattern | Faith analogue |
|---|---|---|
| **Campaign** | Time-bounded mobilization | Year-end giving; mission emphasis week; GivingTuesday; disaster relief; matching campaign |

This doc walks through each lane, the mechanisms within them, the stewardship rules they imply, and the object-model refinement required to support them faithfully.

---

## 1. The scale of faith funding (why this matters)

Some context on the order of magnitude:

| Source | Figure | Year | Reference |
|---|---|---|---|
| US giving to religion | $146.54 B | 2024 (Giving USA) | annual report |
| US giving to international affairs | $35.54 B | 2024 (Giving USA) | annual report |
| US giving to human services | $91.15 B | 2024 (Giving USA) | annual report |
| DAF assets | $251.52 B | 2023 (NPT DAF Report) | annual report |
| DAF grants disbursed | $54.77 B | 2023 (NPT) | annual report |
| Christian DAF (NCF) annual grants | $2.6 B to 36,000+ ministries | 2024 | NCF report |
| Giving circles in US | ~4,000 groups, 370,000 members, $3.1 B (2017–2023) | aggregate | Philanthropy Together |
| GivingTuesday 2024 (US) | $3.6 B from 36.1 M participants | 2024 | GivingTuesday |
| % of giving in last 3 months of year | 34% | 2024 (Blackbaud) | Blackbaud Index |

The patterns we're modeling already move hundreds of billions of dollars annually. Designing the hub to mirror these patterns isn't a stylistic choice — it's the difference between *being usable* and *being toy*.

---

## 2. Lane 1 — Relationship

### 2.1 What it looks like

> A church planter in Wellington needs $400/month in personal support. Sarah, a member of Maria's circle, commits to $50/month for the next two years. Each quarter Sarah receives a one-page update with a story, a prayer request, and a financial summary. After two years they sit down to pray about renewal.

This is *missionary partnership*, *direct support*, *coaching relationships*, *peer mentorship*, *recurring sponsorship*. The ratio is typically **few givers : one recipient** with rapport-driven trust.

### 2.2 Mechanisms in the relationship lane

| Mechanism | Typical structure | Faith reference |
|---|---|---|
| **Missionary support raising** ("friend raising") | Recipient builds team of partners; partners commit recurring monthly support | International Project, Missio Nexus, OMF, IMB |
| **Recurring direct gift** | Donor sets up monthly transfer, possibly to a fund-as-passthrough | Patreon-style |
| **Mentorship / coaching support** | Coach commits time + personal donation; recipient commits to engagement | Pastoral coaching; ministry mentorship |
| **In-kind service** | Donor commits volunteer hours or skills | Short-term mission teams; pro-bono professional service |
| **Sponsorship** | Donor sponsors a specific child / project / scholarship long-term | Compassion International; Operation Christmas Child families |

### 2.3 What makes this lane structurally different

- **Cadence**: monthly or quarterly, multi-year
- **Evidence**: testimony + relational connection, not metric KPIs
- **Trust source**: personal vouch + recipient's reputation in shared community
- **Privacy**: recipient often shares more (children's names, ministry struggles) with their support team than they would publicly
- **Failure mode**: support fades when relationship cools (funder retention)

### 2.4 Object-model implications

```yaml
RelationshipSupport:
  recipient: <person-or-team agent>
  donor: <person agent>
  cadence: monthly | quarterly | recurring
  duration: open-ended | n-year-commitment
  amount: fixed | flexible
  reportingObligations:
    cadence: quarterly
    contentExpected: [testimony, prayerRequests, financialSummary]
    permissions: [shareWithSupportTeam, doNotPublishToPublic]
  trustEvidence: [personalRelationship, sharedCommunity, pastReports]
```

The crucial decoupling: a `RelationshipSupport` is not a `GrantAward`. It's a *commitment to ongoing partnership* that may flow through a fund (as passthrough) but is fundamentally a person-to-person agreement.

Our v1 architecture already supports this through:
- Direct match (donor + recipient, no fund)
- Existing engagement model with `recurring` schedule (Phase 5)
- Cross-delegation between donor and recipient for private reports

Match-card actions for this lane (caller = donor):

```
Card: relationship-support-direct
  Verb: "Start ongoing support"
  Subject: <recipient>
  Predicted: "$50/mo × 24 months = $1,200 toward Wellington Circle"
  Required: signed RecurringSupportCommitment + ACH/token rails
  Evidence cycle: quarterly testimonial reports

Card: relationship-support-via-passthrough
  Verb: "Support through your church"
  Subject: <recipient>, mediated by <church-fund>
  Predicted: same as above; church handles tax receipt
  Required: church-fund cross-delegation
```

---

## 3. Lane 2 — Pool

### 3.1 What it looks like

> Sarah commits $5,000 to her giving fund at the start of the year. Throughout the year, when she encounters mission needs that align with her values, she recommends grants from the fund. The fund's stewardship board reviews each recommendation against its mandate and disburses to qualifying recipients.
>
> Or: Maria pledges $1,200 to the Catalyst NoCo Trauma-Care Fund as her Faith Promise for the year. The fund pools her pledge with others; Trauma-Care board allocates to approved trauma-care training proposals.
>
> Or: A circle of 8 friends each contribute $100/month to a shared fund. They vote quarterly on which approved proposals from their network get funded.

This is *stewarded aggregation*. The donor's intent is honored but the *stewardship authority* lives in the fund / circle / sponsor. The ratio is typically **many givers : one or few funds : many recipients**.

### 3.2 Mechanisms in the pool lane

| Mechanism | Structure | Faith analogue | Real-world examples |
|---|---|---|---|
| **Church missions budget** | Members give to church; church allocates % to missions; missions committee disburses | Most evangelical churches | budget line items, designated giving |
| **Designated giving** | Donor specifies "for trauma-care" within a broader fund | Universal | Restricted gifts |
| **Faith Promise** | Member commits annual missions total; church/fund operates the disbursement | TMS Global, mission emphasis weeks | annual missions pledge |
| **Donor-Advised Fund (DAF)** | Donor contributes upfront, advises grants over time, sponsor approves | NCF, Fidelity Charitable, Schwab Charitable, Endaoment.org | $251B+ in DAFs |
| **Giving circle** | Group pools contributions, members vote on grants | Latino Community Fdn, Asian Women Giving Circle | 4,000+ US circles |
| **Mission cooperative / network fund** | Multiple churches pool for a shared field/region | Cooperative Program (SBC), Lottie Moon, Annie Armstrong | Long-running networks |
| **Mutual aid pool** | Members contribute to shared fund for member needs | ROSCAs, church benevolence, disaster response | Global pattern |

### 3.3 What makes this lane structurally different

- **Cadence**: Pledge cadence (annual / monthly) decoupled from allocation cadence (continuous, quarterly, annual)
- **Authority split**: donor *advises* or *votes*; the fund *decides*
- **Restrictions**: pledge can have restrictions; fund must respect when allocating
- **Evidence**: outcome reports back to donors are *aggregated* (not per-donor); donors trust the fund's stewardship
- **Failure mode**: mandate drift (fund deviates from original purpose); donor disenchantment; opacity

### 3.4 Stewardship authority — the core principle

This is where faith funding gets philosophically distinct from buyer-seller marketplaces. Within the pool lane:

- Donor has **advisory authority** (recommend, vote, pledge with restrictions)
- Fund has **stewardship authority** (decide allocations, honor restrictions, report back)
- Recipient has **execution authority** (use funds, report outcomes)

ECFA (Evangelical Council for Financial Accountability) standards encode this:

> *"Charitable appeals shall be current, complete, accurate, and avoid creating misleading impressions. Gifts solicited for restricted purposes shall be used as represented. Donors should be acknowledged appropriately and timely."*

The system must preserve that authority gradient. A donor can't simply *override* the fund's judgment; the fund can't *ignore* the donor's stated restrictions. It's a fiduciary relationship encoded in software.

### 3.5 Object-model implications

```yaml
Pledge:
  donor: <agent>
  fund: <fund-agent>
  amount: <total>
  cadence: one-time | recurring(monthly|quarterly|annual)
  duration: <years>
  restrictions:
    kinds: [trauma-care, church-planting, local-outreach]
    geoRoot: us/colorado
    notForUseInAdmin: true
    notForUseInDiscretionary: false
  donorRecommendations: [<proposal-id>, ...]    # advisory only
  acknowledgmentExpected:
    cadence: annual
    format: receipt + impact-summary
    disclosureLevel: aggregate-only
  storyPermissions: [shareWithSupportTeam, doNotPublishToPublic]

FaithPromiseCampaign:                         # a Pledge wrapper
  hub: <hub-agent>
  fund: <fund-agent>
  totalCommitted: <number-of-pledges>
  durationMonths: 12
  startDate: 2026-01-01
  recommendedAllocation:
    [{ kind: 'trauma-care', percent: 30 }, ...]

GivingCircle:                                  # a small-fund variant
  members: [<agent>, ...]
  governanceModel: vote | consensus | rotating-steward
  fundMandate: <inherited-from-circle-charter>
  monthlyMeetingCadence: true
  decisionLatency: 1-2 weeks
```

The pool-lane is where most of the F1–F16 architecture work lives. Three new objects beyond what's in the architecture doc:

1. **`Acknowledgment`** — distinct from Disbursement. The system owes the donor *acknowledgment* (receipt + impact summary) at a defined cadence. Acknowledgment can be aggregate (don't expose per-recipient details).

2. **`Restriction`** as a first-class object on the Pledge — restrictions follow the dollars through allocation; a restricted pledge can only fund eligible proposals. The fund's allocator must check.

3. **`StorePermissions`** — controls how the donor's identity and contribution can be referenced in outcome stories ("Sarah supported this trauma-care training" vs anonymous aggregation).

### 3.6 Match cards for the pool lane

```
Card: pool-pledge-to-fund
  Verb: "Pledge to fund"
  Subject: <fund>
  Predicted: "Your $100 toward NoCo Trauma-Care Fund"
  Variants:
    - one-time
    - recurring (monthly)
    - faith-promise (annual)

Card: pool-recommend-DAF-grant
  Verb: "Recommend grant from your fund"
  Subject: <approved-recipient> via <DAF>
  Predicted: "Sponsor approves; recipient receives within 14d"

Card: pool-join-giving-circle
  Verb: "Join circle"
  Subject: <circle-agent>
  Predicted: "Monthly $X commitment + voting rights"

Card: pool-honor-faith-promise
  Verb: "Honor your annual missions commitment"
  Subject: <church-or-mission-fund>
  Predicted: "Your $1,200 annual pledge — $400 remaining"
```

---

## 4. Lane 3 — Proposal

### 4.1 What it looks like

> A regional ministry coordinator drafts a 4-page proposal: $50,000 to train 40 trauma-care leaders in Northern Colorado over 6 months. The proposal includes budget, milestones, expected outcomes, reporting cadence, and named validator. The Catalyst NoCo Trauma-Care Fund's board reviews; approves with conditions; awards in 3 tranches gated on milestone completion.
>
> Or: A house church in Wellington applies to the cooperative church-planting fund for a 3-year start-up grant of $30k/year, with year-by-year renewal contingent on KPIs.
>
> Or: A research team submits a proposal to the Lilly Endowment for a 3-year cohort study; quarterly progress reports; final paper required.

This is the **formal grant cycle**. The ratio is typically **fund : proposal**, mediated by rigorous review.

### 4.2 Mechanisms in the proposal lane

| Mechanism | Structure | Real-world examples |
|---|---|---|
| **RFP grant cycle** | Fund publishes RFP; window of submission; review; award | Lilly Endowment, Templeton Foundation, NIH, MacArthur |
| **Cooperative mission award** | Network of churches pools for specific project grants | Cooperative Program, Mission Increase |
| **Foundation strategic grant** | Foundation invites proposals matching strategic plan | Bill & Melinda Gates Foundation programs |
| **Capital campaign award** | Capital project (building, equipment) funded against milestones | Generis-style church capital campaigns |
| **Mission board partnership grant** | Multi-year grant with annual renewal | IMB, OMF, Pioneers partnership funding |
| **Retroactive impact award** | Reward demonstrated past impact | Optimism RetroPGF; emerging in faith-based |

### 4.3 What makes this lane structurally different

- **Cadence**: round-based windows (quarterly / annually) or one-shot
- **Effort**: high — proposers expend significant time on application
- **Evidence**: rigorous, multi-stage (proposal → milestones → outcomes → validation)
- **Trust source**: fund's review process + recipient's track record + mandate fit
- **Failure mode**: review fatigue; bias toward established applicants; long cycles

### 4.4 Object-model implications

The architecture doc's `Proposal` and `GrantAwardAgreement` objects already cover this lane well. The faith-funding refinements:

```yaml
Proposal:
  basedOnIntent: <NeedIntent>
  submittedTo: <FundMandate>
  basedOnRound: <GrantRound | none>
  budget: { lineItems: [...], total }
  plan: <prov:Plan>
  milestones: [{name, dueDate, evidenceRequired, trancheAmount}]
  desiredOutcomes: [{statement, measurable, validators}]
  reportingObligations:
    cadence: quarterly | milestone | none
    format: written + financial + (testimony if requested)
  organizationalBackground: <prior-track-record>
  validatorAccepted: [<agent>, ...]                    # who can validate outcomes
```

```yaml
GrantAwardAgreement:
  fund: <agent>
  recipient: <agent>
  proposal: <Proposal>
  awardedAmount: ...
  tranches: [{ amount, milestone, releaseCondition }]
  expectedOutcomes: <linked-to-proposal.desiredOutcomes>
  reportingObligations: <inherited from proposal>
  storyPermissions: [shareWithDonors, anonymizeBeneficiaries, ...]
  trustUpdatePolicy:
    onSuccessfulValidation: depositOnRecipient = +1
    onFailedValidation: depositOnRecipient = -2
    onNonReporting: warningFlag
```

### 4.5 Match cards for the proposal lane

```
Card: proposal-submit-to-fund
  Verb: "Submit proposal"
  Subject: <fund-mandate>
  Predicted: "8/10 similar proposals funded; expected decision in 14d"
  Required: 2-page proposal + budget + milestones
  Caveat: requires VerifiedHuman credential for QF-rounds (Phase 5)

Card: proposal-apply-to-round
  Verb: "Apply to grant round"
  Subject: <grant-round> within <fund>
  Predicted: "Round closes in 12d; 24 proposals so far; allocation $200k"

Card: proposal-request-feedback-pre-submit
  Verb: "Get feedback before submitting"
  Subject: <fund-steward>
  Predicted: "Stewards typically respond within 5d for pre-submit consultation"

Card: proposal-renew-multi-year
  Verb: "Renew for next year"
  Subject: <existing-engagement>
  Predicted: "Year 1 outcomes met 4/5 milestones; renewal likely"
```

---

## 5. Campaign — the cross-cutting wrapper

### 5.1 What it looks like

> Year-end. The catalyst hub launches a 30-day campaign: "Equip 100 trauma-care leaders by Christmas." Matching pool of $50k from a sponsor. Donors give; sponsor matches 1:1 up to $50k. Total raised by deadline determines whether to proceed with proposed program (or refund pledges if undersubscribed).

Campaigns activate any of the three lanes within a time-bounded window with collective momentum. They aren't a separate object so much as a *wrapper* that adds:

- **Time window** (start/end)
- **Optional matching pool** (additional capital from sponsor)
- **Public progress meter** (raised so far)
- **Optional all-or-nothing trigger** (crowdfunding-style)
- **Story-driven mobilization** (what's the urgent need?)
- **Aggregated outcome report** (what did we collectively achieve?)

### 5.2 Mechanisms

| Campaign type | Trigger | Faith analogue |
|---|---|---|
| **Year-end giving** | Calendar (Nov-Dec) | Year-end appeal, last-day giving |
| **GivingTuesday** | Calendar (Tuesday after Thanksgiving) | Annual mobilization day |
| **Mission emphasis week** | Church calendar | Annual missions focus |
| **Disaster response** | Trigger event (earthquake, hurricane) | Emergency relief campaigns |
| **Matching campaign** | Sponsor commits matching pool | Lottie Moon Christmas Offering |
| **Capital campaign** | Building project / asset acquisition | Church capital campaigns |
| **Birthday / honor giving** | Personal milestone | Memorial gifts, birthday gifts |

### 5.3 Object model

```yaml
Campaign:
  hub: <hub-agent>
  scope: <fund-or-need-or-proposal>
  startDate, endDate
  goalAmount: <number>
  matchingPool:
    sponsor: <agent>
    matchAmount: <number>
    matchRatio: 1.0
    matchTriggers: [perDollarPledged | atDeadlineIfGoalMet]
  conditional:
    allOrNothing: true | false
    refundIfNotMet: true | false
  story:
    headline, narrative, visualAssets
    storyPermissions: { useNamedRecipients, useTestimonials }
  publicMeter: <updated-on-pledge>
  participants: [<donor-agent>, ...]
  finalOutcome: <aggregateReport>
```

### 5.4 Match cards for campaigns

```
Card: campaign-active
  Verb: "Give now"
  Subject: <campaign>
  Predicted: "$10k of $50k matching remaining; your $25 = $50 matched"
  Urgency: deadline 12d

Card: campaign-honor-pledge
  Verb: "Honor your campaign pledge"
  Subject: <previously-pledged-campaign>
  Predicted: "$200 commitment due by Dec 31"

Card: campaign-share
  Verb: "Share with your community"
  Subject: <campaign>
  Predicted: "Tap into your circle's network for momentum"
```

---

## 6. Refined object decomposition

The faith-funding patterns require splitting some objects more carefully than the architecture doc's first cut. Here's the revised list:

| Object | Stage | Note |
|---|---|---|
| **GiftSignal** (new) | Pre-intent | "I might give to missions" — soft preference, not yet a commitment |
| **GiftIntent** | Intent | Public projection: "I want to give $X to kind Y" |
| **NeedIntent** | Intent | Public projection: "I need X for purpose Y" |
| **FundMandate** | Description | What a fund accepts and funds |
| **Campaign** | Description | Time-bounded mobilization |
| **GrantRound** | Description | Refines FundMandate for a specific window |
| **Proposal** | Plan | Bridge from NeedIntent to fundable plan |
| **PledgeCommitment** | Commitment | Bridge from GiftIntent to allocatable resource |
| **Restriction** (new, attached to Pledge) | Constraint | Donor's conditions on use |
| **Contribution** (new) | Activity | The actual transfer of money/resources from donor to fund |
| **FundAllocation** (new) | Decision | Fund's decision to assign pledge → proposal |
| **GrantAwardAgreement** | Commitment | Fund + recipient sign |
| **Disbursement / Tranche** | Activity | Actual transfer fund → recipient |
| **Acknowledgment** (new) | Activity | Fund's communication back to donor |
| **OutcomeReport** | Entity | Recipient's report of what happened |
| **OutcomeValidation** | Activity | Validator's confirmation |
| **Story** (new) | Entity | Optional narrative attached to outcome, with permissions |
| **TrustUpdate** | Activity | Trust-graph mutation following validation |
| **StewardshipPolicy** (new, attached to FundMandate) | Description | Acknowledgment cadence, transparency norms, restriction handling, story permissions |

**Why this many objects?** Because conflating them loses important rights and permissions:

- **GiftIntent vs PledgeCommitment vs Contribution**: A donor's "I want to give" (intent) isn't the same as their signed pledge (commitment) isn't the same as the money actually moving (contribution). Each has different signature requirements, different reversibility, different reporting.

- **Acknowledgment vs Disbursement**: A donor is owed acknowledgment (receipt, impact summary) regardless of whether the disbursement has happened. Acknowledgment is the fund's obligation to the donor; Disbursement is the fund's obligation to the recipient. Don't merge.

- **Story vs OutcomeReport**: An outcome report is "what happened" (factual, may have private parts). A story is a *narrative* about it for publication, with explicit permissions on who's named and how. Without separation, donors get either too little story (just numbers) or recipients lose privacy control.

- **StewardshipPolicy vs FundMandate.governance**: Governance is *who decides*. Stewardship is *how the fund treats donors and recipients ethically* — acknowledgment timing, restriction respect, story permissions, conflict-of-interest rules. They overlap but aren't the same.

---

## 7. ECFA-style stewardship requirements (encoded)

The Evangelical Council for Financial Accountability publishes seven standards. Three are directly relevant for our object model:

### Standard 4 — Use of Resources

> *"Every organization shall expend funds in accordance with the wishes of donors. Funds solicited for restricted purposes shall not be used for other purposes."*

**Encoding:** Pledge.restrictions are first-class. Fund's allocator MUST check restrictions before allocating a pledge to a proposal. Audit log records every allocation decision with the linked restrictions.

### Standard 5 — Transparency

> *"Every organization shall provide a copy of its current financial statements upon written request."*

**Encoding:** Fund's principal must expose `list_audit_log` to (at minimum) its own donors via cross-delegation. Donors who pledged see their share of the fund's activity.

### Standard 6 — Compensation-Setting and Related-Party Transactions

> *"Every organization shall set compensation of its top leader and address related-party transactions with disinterested oversight."*

**Encoding:** Phase 5+ — multi-signer governance for funds, conflict-of-interest declaration in mandate.

### Standard 7 — Stewardship of Charitable Gifts

> *"a) Truthfulness in communications — current, complete, accurate. b) Honoring donor expectations — gifts shall be used as represented. c) Donor acknowledgment — appropriate, timely. d) Avoiding gifts that result in family hardship."*

**Encoding:**
- **a)** Story permissions on outcome reports; required honesty in campaign appeals.
- **b)** Restriction handling (Standard 4 again).
- **c)** Acknowledgment as a first-class object with cadence policy.
- **d)** Phase 5+ — donor pledges include affordability self-certification; system warns on unusual ratios.

These aren't just nice-to-haves. They're the difference between *technically working* and *trustworthy at scale*.

---

## 8. The "given how you give" UX principle

The user's most important UX insight: instead of one "Donate" button, surface **intent-aware actions** matching the way faith communities already give:

| Action | Card kind | Lane |
|---|---|---|
| "I want to support **this person**" | direct-relationship | Relationship |
| "I want to support **this mission field**" | pledge-to-themed-fund | Pool |
| "I want to give **through my church**" | pool-via-org-passthrough | Pool |
| "I want to **join a group**" | join-giving-circle | Pool |
| "I want to make **a yearly pledge**" | faith-promise-pledge | Pool |
| "I want to **recommend a grant**" | DAF-grant-recommendation | Pool |
| "I want to **fund a proposal**" | proposal-direct-fund | Proposal |
| "I want to **respond to an urgent need**" | campaign-active | Campaign |
| "I want to give **skills, not money**" | service-gift-direct | Relationship |

The matcher's job is to surface the *right cards* for the user's current intent, role, and context. We've already seen this in the matchmaking-strategy.md — this section gives the cards real semantics from the faith-funding domain.

---

## 9. v1 scope per lane

| Lane | v1 status | Required |
|---|---|---|
| **Relationship** — direct match | ✅ ships in F3+F4 | DM via A2A; Propose Meeting card |
| **Relationship** — recurring support | ⚠️ Phase 5 | requires recurring-pledge state machine |
| **Pool** — basic pledge to fund | ✅ ships in F9 | one-time pledges |
| **Pool** — restricted pledge | ✅ ships in F9 | restrictions field on pledge |
| **Pool** — DAF-style donor recommendation | ✅ ships in F9+F11 | governance model = donor-advised |
| **Pool** — Faith Promise (annual) | ⚠️ Phase 5 | requires recurring/scheduled-pledge |
| **Pool** — Giving Circle | ⚠️ Phase 5 | circle-agent type + member voting |
| **Pool** — Mutual aid (membership-only) | ⚠️ Phase 5 | mandate.eligibilityRules.membersOnly |
| **Proposal** — single-coach approval | ✅ F11 | already planned |
| **Proposal** — multisig approval | ✅ F11 | already planned |
| **Proposal** — round-based RFP | ✅ F6 (rounds = mandate refinements) | already planned |
| **Proposal** — multi-year renewal | ⚠️ Phase 5 | engagement renewal flow |
| **Campaign** — basic time-bounded | ⚠️ Phase 5 | campaign object as a pledge wrapper |
| **Campaign** — matching pool | ⚠️ Phase 5+ | matching-pool allocation |
| **Campaign** — all-or-nothing | ⚠️ Phase 5+ | conditional pledge state machine |
| **Stewardship** — restriction handling | ✅ F11 | mandatory in allocator |
| **Stewardship** — acknowledgment | ⚠️ F14 (extension) | Acknowledgment as first-class object |
| **Stewardship** — story permissions | ⚠️ F15 | StoryPermissions on outcome |
| **Stewardship** — ECFA-aligned audit | ⚠️ Phase 5 | audit-log + transparency tools |

v1 covers the *core* of all three lanes. Phase 5 fills in the recurring/campaign mechanisms and the rich stewardship surface.

---

## 10. Demo seed for the three lanes

Augmenting `seed-catalyst-onchain.ts` to exercise each lane:

**Relationship lane:**
- Sarah supports Maria (already exists in part) — formalize as `RelationshipSupport` row
- Hannah (G2 apprentice) gets monthly support from one of her cousin's network

**Pool lane:**
- NoCo Trauma-Care Fund (single-coach, Maria) — already designed
- Bilingual Discipleship Pool (multisig, David + Rosa) — already designed
- Add: NoCo Mission Faith Promise Campaign (12-month wrapper, opens 2026-Q1)
- Add: NoCo Stewards Circle (giving circle of 6 members; monthly $50 commitment; rotating-steward governance)

**Proposal lane:**
- Ana submits proposal to NoCo Trauma-Care Fund (existing in plan)
- Add: A research team submits multi-year proposal to NoCo Bilingual Discipleship Pool

**Campaign lane (Phase 5):**
- Year-end 2026 campaign: "Equip 100 trauma-care leaders" — matches against NoCo Trauma-Care Fund

After this seed, the catalyst hub demo demonstrates all three lanes simultaneously, with appropriate match cards for each user role.

---

## 11. Take-away

Faith funding gives us:

1. **The three-lane framing** — relationship / pool / proposal, with campaigns as cross-cutting mobilization. This is the right surface.
2. **Object refinements** — separate Pledge / Contribution / Acknowledgment / Story / Restriction. Honoring donor intent demands this.
3. **Stewardship-as-policy** — ECFA-aligned standards encoded in mandate.stewardshipPolicy. Trust at scale requires this.
4. **The UX principle** — give-aware actions, not generic "donate" buttons. Match cards mirror how communities actually give.
5. **The scale signal** — patterns we model already move $300B+ annually. This is not toy domain.

Fund-as-Agent + Mandate-as-Description (architecture doc §3) + Strategy registry (Gitcoin doc §4) + three-lane match cards (this doc §10) + stewardship policy (this doc §7) = a hub that supports the actual diversity of generous practice, not just buyer-seller transactions.

The next strategic move is the *agentic* layer — what makes the Fund / Hub / Person / Org *intelligent* rather than just configurable. That's `agentic-hub-and-bdi.md`.
