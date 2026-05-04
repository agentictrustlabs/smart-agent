# Agentic Hub & BDI — Why Every Hub, Fund, Person, and Org Has Its Own Intelligence Engine

**Status:** Strategic / architectural design doc
**Companion to:** `grants-fund-architecture.md`, `faith-funding-and-stewardship.md`, `matchmaking-strategy.md`
**Purpose:** Articulate the unique opportunity in our system — *every* agent (Person, Org, Fund, Hub, Validator) has its own A2A intelligence engine running a Belief–Desire–Intention loop. This is what differentiates us from Allo Protocol, Gitcoin, and traditional grant infrastructure: those treat the fund as passive storage + a strategy contract; we treat it as a living agent that participates in the marketplace. This doc explains why that matters, what each agent's BDI looks like, how multi-hub participation works, and how the three lanes (relationship / pool / proposal) generate different agent behaviors.

---

## 0. The big move

Allo Protocol's model:

```
Pool (storage) ─→ Strategy (contract that runs at lifecycle events)
                 ↑
            triggered by external transactions
```

Our model:

```
Fund Agent (BDI loop, A2A endpoint)
   │
   ├── Beliefs: who pledged, what proposals are pending, what worked, what didn't
   ├── Desires: outcomes the mandate wants (more trauma-care, more leaders trained)
   └── Intentions: open this round, approve this proposal, release this tranche, refer this proposal to a sibling fund

The fund proactively:
  - reaches out to potential donors who match its mandate
  - solicits proposals from recipients in its geo
  - refers proposals to better-aligned funds when needed
  - learns which donor pitches resonate
  - reports outcomes back to donors with story
```

This is not a small change. It moves us from *grant infrastructure* to *agentic coordination*.

The same architectural choice applies to every other agent. A Person Agent isn't just a wallet + an MCP — it's an intelligent agent monitoring the marketplace, surfacing opportunities, drafting proposals, and negotiating commitments on the human's behalf. A Hub Agent isn't just a registry — it's a curator detecting funding gaps and seeding new funds.

Every agent runs a BDI cycle. The marketplace is the **emergent behavior** of all these BDI loops interacting via A2A messages.

---

## 1. Why BDI is the right framework

Belief–Desire–Intention is a well-established AI architecture (Bratman 1987; Rao & Georgeff 1995). It distinguishes three states:

| State | Definition | In our domain |
|---|---|---|
| **Beliefs** | What the agent currently holds true about the world | Public on-chain assertions, validated outcomes, trust scores, the agent's own MCP rows, the social graph |
| **Desires** | Goals the agent would prefer realized | The agent's intents (NeedIntent, GiftIntent), the FundMandate's outcome priorities, the StewardshipPolicy |
| **Intentions** | Subset of desires the agent has *committed* resources to | Pledges signed, proposals submitted, awards approved, tranches released |

The cycle:

```
PERCEIVE (update Beliefs from world events)
   ↓
DELIBERATE (pick which Desires to commit to, given current Beliefs)
   ↓
PLAN (form Intentions — concrete actions that should advance Desires)
   ↓
ACT (execute the Intentions via A2A messages, on-chain transactions, MCP writes)
   ↓
   (back to PERCEIVE)
```

This is exactly how the marketplace will run. Every time a new on-chain assertion is minted, every Fund and Person Agent's beliefs update. They re-deliberate. They re-plan. They send new A2A messages or mint new transactions.

**Why BDI vs simpler alternatives:**

- **Reactive agents** (just rules): can't accumulate state, can't plan multi-step actions, can't represent partial commitments
- **Pure utility maximizers**: can't represent *commitment* — once a fund signs a pledge it should not re-deliberate just because a higher-utility option appears
- **BDI**: explicitly distinguishes *what I'd prefer* from *what I've committed to* — which is *exactly* the difference between intent, pledge, and disbursement in our domain

BDI is the framework that *naturally* matches the philanthropy semantics.

---

## 2. The five agent types and their BDI

Each agent type runs a BDI loop with type-specific beliefs/desires/intentions.

### 2.1 Person Agent (BDI per individual)

**Beliefs** (state held in person-mcp + public chain):
- My intents, pledges, proposals, awards, reports
- My membership in hubs, circles, congregations
- My trust score (from on-chain TrustDeposits)
- My credentials (in askar wallet)
- My validated past outcomes
- Social graph: who I trust, who I'm a coach for, who I'm coached by, who shares my circle
- Public observations: pending proposals in funds I'm part of, active campaigns, eligible matches surfaced by my matcher

**Desires** (from intents + preferences):
- "I want to give $X/month to missions in Colorado"
- "I want to receive coaching for my Wellington Circle"
- "I want to support Sarah's mission work specifically"
- "I want my giving to honor my ECFA-aligned values"
- "I want my outcome stories to be shareable with my support team but not public"

**Intentions** (committed plans):
- Active pledges to specific funds with restrictions
- Submitted proposals awaiting review
- Recurring support commitments to specific recipients
- Validation tasks I've taken on (validate Hannah's outcome by April 30)

**A2A engine capabilities:**

```
- Listen for new public mandates / campaigns / direct-match opportunities
- Compute matches periodically (request-time)
- Receive A2A messages from funds (proposal-feedback, pledge-acknowledgment, award-status)
- Send A2A messages (propose-meeting, send-outcome-update)
- Respond to fund-agent solicitations (with consent)
- Initiate proposal drafts based on stored NeedIntents
- Schedule recurring pledges / faith promise honors
- Maintain story permissions per donor relationship
```

### 2.2 Org Agent (BDI per organization)

Same shape as Person Agent, but with org-specific scaling:

**Beliefs** add:
- Roster of members and their roles
- Org-level outcomes and trust score
- Aggregated needs across members ("Wellington Circle needs ...")
- Operational state (revenue if revenue-generating; budget cycles)

**Desires** add:
- Org-level mission outcomes
- Member capacity-building
- Relationships with peer orgs (alliances, generational lineage)

**Intentions** add:
- Submit org-level proposals to funds
- Issue credentials to members (e.g. coach-of-circle credential)
- Maintain relationships with sibling orgs

A Wellington Circle Org Agent's BDI cycle: every new in-circle need gets surfaced; the agent drafts a proposal aggregating member needs; submits to NoCo Trauma-Care Fund or Bilingual Discipleship Pool depending on best fit; tracks outcome.

### 2.3 Fund Agent (BDI per fund — the new architectural primitive)

**Beliefs:**
- All pledges received (with restrictions — via cross-delegations from donors)
- All proposals received (via cross-delegations from proposers)
- All active and past awards
- Outcomes reported and validated
- Mandate text (own — but this is also a Belief about what the fund commits to)
- Stewardship history (donor acknowledgment quality, restriction-honoring track record)
- Sibling funds' mandates (read from public on-chain)
- Hub steward feedback

**Desires** (from FundMandate.outcomePriorities + StewardshipPolicy):
- Outcomes the mandate wants ("80% of awards complete milestones; total impact = N leaders trained")
- Ethical operation per ECFA standards
- Donor satisfaction (acknowledgment timing, story quality)
- Recipient flourishing (multi-year support where appropriate; trust-based philanthropy)
- Mandate evolution (learn from past rounds; refine for next)

**Intentions:**
- Open round (with specific window, cap, criteria)
- Approve / decline / request-revision on each proposal
- Allocate pledges to awards (respecting restrictions)
- Release tranche on milestone completion
- Issue acknowledgment to donor on cadence
- Request validation from a Validator Agent
- Refer proposal to better-fitting sibling fund
- Solicit pledge from a donor whose past intent matches mandate
- Refine mandate for next round based on what worked

**A2A engine capabilities — the differentiator:**

| Capability | What the fund agent does | Difference from Allo |
|---|---|---|
| **Listen** | Subscribe to new NeedIntents that match mandate | Allo's Pool is passive; ours actively surfaces |
| **Solicit** | Send A2A message to potential donors: "based on your past gifts, you might be interested in supporting our trauma-care round" | Allo doesn't do outreach |
| **Refer** | When a proposal doesn't fit our mandate but fits sibling fund's, message the proposer + the sibling fund | Allo has no inter-pool routing |
| **Negotiate** | Ask proposer to revise scope ("you asked $80k; we can fund $50k; here's why") | Allo's review is pass/fail |
| **Coordinate** | Coordinate with sibling funds on co-funding ("we'll fund tranches 1-2; can you fund tranche 3?") | Allo has no coordination |
| **Learn** | Adjust criteria for next round based on outcome track record | Allo strategies are hard-coded |
| **Tell stories** | Aggregate outcomes into donor-facing narratives respecting StoryPermissions | Allo has no narrative layer |
| **Defend** | Publish position papers / mandate justifications | Allo has no advocacy layer |

These capabilities turn the Fund from infrastructure into a *participant*. A donor who pledges to NoCo Trauma-Care Fund isn't pledging to a smart contract — they're pledging to *an agent* that they can talk to, that learns, that represents the mandate's mission with character.

### 2.4 Hub Agent (BDI per hub — the curator)

**Beliefs:**
- All hosted funds' mandates and current state
- All member orgs' needs (public projections)
- All member persons' aggregate intent patterns (anonymized aggregations)
- Geographic and thematic coverage gaps (areas underserved)
- Cross-fund metrics (which fund types succeed; which underdeliver)

**Desires:**
- Comprehensive coverage of community needs
- Vibrant multi-fund ecosystem (no single fund monopoly)
- Healthy trust dynamics across the network
- Long-term sustainability (rounds keep happening)

**Intentions:**
- Seed new funds when gaps detected ("we need a youth-discipleship fund; no current fund covers")
- Recommend funds to specific persons/orgs based on their intents
- Coordinate cross-fund campaigns (year-end push across all funds)
- Curate validators (maintain a registry of trusted validators)
- Issue hub-membership credentials
- Mediate disputes between funds and recipients

**A2A engine capabilities:**

```
- Detect gap: "no fund matches need-kind X in geo Y"
- Propose to existing org steward: "would you sponsor a new fund for ...?"
- Aggregate cross-fund metrics for steward dashboard
- Coordinate seasonal campaigns
- Maintain validator pool quality
- Mediate when fund and recipient have outcome dispute
```

### 2.5 Validator Agent (BDI per validator — the trust auditor)

**Beliefs:**
- Outcomes I've validated and their downstream trust deposits
- Standards I apply (linked to mandate-specified validator criteria)
- My own trust score
- My commitments (validations I've agreed to perform)

**Desires:**
- Maintain own integrity (don't validate fraud)
- Build accurate impact assessment over time
- Earn trust deposits from accurate validations
- Stay efficient (don't take on validations I can't credibly perform)

**Intentions:**
- Accept / decline validation requests
- Schedule validation activities (site visit, evidence review, witness interviews)
- Sign validation assertions on-chain
- Update own trust profile based on past validation accuracy

A Validator Agent could be a trusted person (e.g. Sarah validates Wellington-area trauma-care outcomes), an organization (a regional ministry coordinator), or a specialty validator (a financial-audit firm).

---

## 3. How A2A messages implement the BDI cycle

A2A is the existing agent-to-agent protocol with delegation tokens, audience-scoped sessions, and request/response over HTTP. We extend it to support BDI semantics.

### 3.1 New A2A message kinds

| Message | From → To | Purpose |
|---|---|---|
| **Solicit** | Fund → Donor | "Your past intent matches our mandate; consider pledging" |
| **Refer** | Fund_A → Fund_B + Proposer | "This proposal might fit your mandate better" |
| **Request-revision** | Fund → Proposer | "Reduce scope; here's the gap" |
| **Co-fund-invite** | Fund_A → Fund_B | "Will you fund tranches 3-4 of this award?" |
| **Acknowledge** | Fund → Donor | Acknowledgment per StewardshipPolicy cadence |
| **Story-update** | Fund → Donors | Aggregated narrative on outcomes |
| **Validate-request** | Fund → Validator | "Please validate this outcome by date X" |
| **Outcome-dispute** | Recipient or Validator → Hub | "Disagreement on this outcome's interpretation" |
| **Gap-detected** | Hub → Steward | "We're missing a fund covering need-kind X in geo Y" |

These ride on the existing A2A infrastructure (delegation tokens, audience='urn:mcp:server:fund' or 'urn:a2a:hub-coordination', etc.). The token-based auth means the recipient agent can verify the sender's identity and authority cryptographically.

### 3.2 BDI cycle realization

Each agent runs the cycle:

```
PERCEIVE phase:
  - Subscribe to public on-chain events (new mandates, new pledges, new awards, trust deposits)
  - Listen on A2A inbox for direct messages
  - Check own MCP for state changes
  - Refresh trust scores and credentials

DELIBERATE phase:
  - Score current Desires by:
    - alignment with mandate (own or perceived)
    - feasibility given resources
    - ethical constraints (StewardshipPolicy)
  - Pick top-K Desires to advance this cycle

PLAN phase:
  - For each selected Desire, generate Intention(s):
    - Solicit donor X
    - Refer proposal Y to fund Z
    - Approve proposal P with revisions R
    - Release tranche T

ACT phase:
  - Send A2A messages per Intention
  - Mint on-chain assertions per Intention
  - Update own MCP per Intention
  - Wait for responses / world events
```

Cycle frequency: not real-time. Could be:
- **Reactive**: triggered by new on-chain event or A2A message (immediate)
- **Periodic**: every hour / day / week (for proactive solicitation, gap detection)
- **Round-aligned**: at round open / close / midpoint

Different agents have different cycle rhythms. A Person Agent reacts on demand. A Fund Agent might run a daily proactive cycle plus event-triggered reactive cycles. A Hub Agent might run weekly gap-detection.

### 3.3 Implementing it in Node.js

This is *not* heavy AI infrastructure. The BDI loop fits in a few hundred lines per agent type:

```typescript
class FundBDIEngine {
  private beliefs: FundBeliefs        // refresh from on-chain + own MCP + cross-delegated reads
  private desires: FundDesires        // from FundMandate
  private intentions: FundIntentions  // from this.deliberate(beliefs, desires)

  async cycle(): Promise<void> {
    await this.perceive()
    this.deliberate()
    const newIntentions = this.plan()
    await this.act(newIntentions)
  }

  async perceive(): Promise<void> {
    this.beliefs.pendingProposals = await listReceivedProposals(...)
    this.beliefs.activePledges = await listReceivedPledges(...)
    this.beliefs.outcomesByPastAwards = await listOutcomesForFund(...)
    this.beliefs.siblingFunds = await listFundMandates({hub: this.hubId})
    // ... etc.
  }

  deliberate(): void {
    // Rank pending proposals by mandate-fit + recipient-trust + capacity-available
    // Decide which proposals to approve, which to request revisions, which to refer
    // Decide whether to open a new round, send acknowledgments, request validations
  }

  plan(): Intention[] {
    return [
      ...this.proposalDecisions(),
      ...this.acknowledgmentSchedule(),
      ...this.solicitationOpportunities(),
      ...this.referrals(),
    ]
  }

  async act(intentions: Intention[]): Promise<void> {
    for (const i of intentions) {
      switch (i.kind) {
        case 'approve-proposal': await mintAwardAgreement(...); break
        case 'send-acknowledgment': await a2aSend({to: i.donor, kind: 'Acknowledge', ...}); break
        case 'refer-proposal': await a2aSend({to: i.siblingFund, kind: 'Refer', ...}); break
        // ...
      }
    }
  }
}
```

Each cycle is a few hundred RPC calls + a few signed messages + a few MCP queries. Trivially affordable. The intelligence isn't in heavyweight ML — it's in the *consistent application* of policy across the BDI loop.

That said: the deliberate / plan steps can absolutely use LLM-based reasoning when policy gets complex (drafting proposal feedback in natural language, summarizing outcomes into donor-facing stories, detecting nuanced gaps). The architecture supports both rule-based and LLM-augmented deliberation. v1 starts rule-based; LLM augmentation lands in later phases.

---

## 4. Multi-hub participation

The user's question: a person or org can be part of multiple hubs. What's the right behavior?

### 4.1 The three approaches

| Approach | Model | Pros | Cons |
|---|---|---|---|
| **Hub-isolated** | Each hub has separate views; user sees them as separate apps | Privacy-by-default; no cross-hub data leakage | Disjointed experience; user has to context-switch; no cross-hub leverage |
| **Hub-aware unified** | Single unified dashboard; matches tagged with hub context; user filters | Coherent UX; preserves per-hub privacy; user is in control | Some cross-hub aggregation in user's session (acceptable since user is the data principal) |
| **Cross-hub propagation** | A pledge or membership in one hub auto-replicates to siblings | Maximum convenience | Violates hub-as-trust-boundary; privacy regression; not what people actually want |

**Recommendation: hub-aware unified.**

User's session aggregates data *they have access to* across hubs. Each match card carries a hub-context badge. Filters allow scoping to specific hubs. No data leaves the user's session into a sibling hub without explicit action.

### 4.2 What this means in practice

Maria is a member of:
- **Catalyst Hub** (NoCo coaching network)
- **Mission Collective Hub** (CIL revenue-share — she's an advisor, not member)

Maria's session, on visit to `/discover`:

```
┌────────────────────────────────────────────────────────────┐
│  Filter: [All hubs] [Catalyst] [Mission Collective]        │
├────────────────────────────────────────────────────────────┤
│ 🤝 [Catalyst] Sofia needs a Wellington Circle coach        │
│    [Propose meeting]                                       │
├────────────────────────────────────────────────────────────┤
│ 💰 [Catalyst] NoCo Trauma-Care Fund matches your gift      │
│    [Pledge $25] [Pledge other amount]                      │
├────────────────────────────────────────────────────────────┤
│ 🌍 [CIL] Afia's Market needs $250k capital                 │
│    [Submit advisor recommendation] (you're not an investor) │
└────────────────────────────────────────────────────────────┘
```

The hub badge is a *visual filter aid* and a *trust boundary*. Maria's data (intents, pledges, etc.) lives in her person-mcp; the matcher reads it once and queries each hub's public projections separately. No cross-hub writes.

### 4.3 Per-hub identity stamps

Membership credentials are per-hub. Maria has:
- `CatalystHubMember` credential
- `MissionCollectiveHubAdvisor` credential

When she pledges to a fund within Catalyst, the eligibility check uses her CatalystHubMember credential. When she advises on CIL matters, the AdvisorRole credential. The wallet supports both; the verifier-mcp enforces per-mandate credential requirements.

### 4.4 The Person Agent across hubs

Maria's Person Agent runs *one* BDI loop (she's one person). Beliefs include all hubs she's part of. Desires are her global intents. Intentions can be hub-specific:

```
DELIBERATE:
  - Catalyst hub has 2 high-trust matches for my give-coaching intent
  - CIL hub has 1 capital-need but I'm not a capital donor in that hub
  - Hub priority weighting: Catalyst (primary) > CIL (advisor only)

PLAN:
  - Intention: Surface Catalyst trauma-care fund matches with high priority
  - Intention: Surface CIL advisor opportunities at lower priority
```

The agent's *behavior* differs per hub because of the role she plays in each. The *agent itself* is one entity.

### 4.5 Cross-hub coordination (Phase 5)

Where it gets interesting: emergent behavior across hubs.

**Example: cross-hub fund referral.** Ana submits a trauma-care proposal to NoCo Trauma-Care Fund (Catalyst Hub). The fund's deliberate phase realizes the proposal's geo doesn't quite fit (it's actually serving Cheyenne, WY, not NoCo). The fund agent A2A-messages a sibling fund in a hypothetical Wyoming Hub asking "does this fit your mandate?" If yes, the proposal gets cross-hub-referred without losing context.

**Example: cross-hub donor portfolio.** A donor wants to give $1,000/month split across multiple causes. Their Person Agent's BDI realizes the optimal split is across funds in multiple hubs (some catalyst, some CIL, some other). It generates pledges to each. The donor sees a unified portfolio view; each hub sees its own pledge.

These are emergent behaviors of the multi-agent system. We don't need to build them as central features — they fall out of the BDI architecture once we have the message kinds.

### 4.6 Privacy boundaries in multi-hub

Critical: **a Hub does not see another Hub's data.** Specifically:

- A Catalyst fund's beliefs *do not include* CIL fund pledges, even if some pledger is in both hubs
- A Catalyst hub's gap-detection runs only on Catalyst data
- Cross-hub coordination requires *explicit messaging* between fund agents (consent-driven)

This is the same owner-routing rule as person/org agents. Hub data is hub-scoped. Coordination is opt-in.

### 4.7 The cross-hub user dashboard

The exception: the *user's own* dashboard *can* show their multi-hub state because the user is the data principal. Maria's dashboard shows:
- Her catalyst-side data (her right)
- Her CIL-side data (her right)
- *Not* other people's CIL-side data (not her right)

This is the same single-user-multi-tenant pattern as person-mcp itself. The dashboard is just rendering owner-scoped views.

---

## 5. The three lanes drive different agent behaviors

Each lane (relationship / pool / proposal) generates different BDI behaviors. The same Fund Agent operates differently depending on which lane it's currently focused on.

### 5.1 Relationship lane behaviors

**Person Agent (recipient — supported missionary):**
- Beliefs: my support-team list; current monthly commitments; quarterly report obligations
- Desires: maintain support relationships; communicate well; receive renewals
- Intentions: send quarterly reports; respond to support-team messages; pray-and-renew

**Person Agent (donor — supporter):**
- Beliefs: who I support; their last update; my commitment cadence
- Desires: see lives changed; maintain relationships; hear stories
- Intentions: honor monthly commitment; read quarterly updates; pray; consider renewal

**Fund Agent's role here:** Mostly passthrough. Fund-as-passthrough takes the donor's recurring support, charges a small administrative fee, disburses to recipient with tax receipt. Fund agent's BDI is minimal here — but it can still solicit ("based on your past support, here are 3 missionaries you might add to your team").

### 5.2 Pool lane behaviors

**Person Agent (donor):**
- Beliefs: my pledges, restrictions, advisory recommendations, fund acknowledgments
- Desires: my mandate values; story permissions honored
- Intentions: pledge to funds matching my values; recommend grants; trust the fund's stewardship

**Fund Agent (this is where it shines):**
- Beliefs: pool composition; restrictions across pledges; pending proposals
- Desires: optimal allocation to highest-impact eligible proposals; donor satisfaction
- Intentions: open round; allocate per algorithm; acknowledge donors; tell stories
- *Most BDI-active behavior* — proactive solicitation, sibling-fund coordination, mandate refinement

**Hub Agent:**
- Beliefs: ecosystem of funds within hub
- Desires: coverage gaps closed; sustainable funding cadence
- Intentions: coordinate cross-fund campaigns; seed new funds; recommend funds to donors

### 5.3 Proposal lane behaviors

**Person/Org Agent (proposer):**
- Beliefs: open rounds; mandate fit scores; my track record
- Desires: get proposal funded; build relationship with reviewers
- Intentions: draft proposal; submit; respond to revisions; deliver milestones

**Fund Agent:**
- Beliefs: review queue; mandate criteria; available pool
- Desires: high-quality awards; timely review; honest feedback to declined proposals
- Intentions: review proposals; approve/decline/request-revision; create awards; release tranches

**Validator Agent:**
- Beliefs: outcome reports awaiting validation
- Desires: accurate validation; build own trust profile
- Intentions: review evidence; sign validation assertions; report concerns

### 5.4 Why each lane has a different BDI rhythm

| Lane | Cycle frequency | Trigger |
|---|---|---|
| **Relationship** | Slow (monthly/quarterly) | Recurring schedule; donor-recipient communication |
| **Pool** | Medium (continuous-ish) | New pledge; new proposal; round close; allocation algorithm |
| **Proposal** | Discrete (round-bounded) | Round open / submission deadline / review window / award decision |

The Fund Agent's BDI engine handles all three, but its *attention shifts* depending on what's happening. Daily runs through relationship-lane acknowledgments; round-close runs the pool-lane allocator; proposal-lane review is event-driven by submissions.

---

## 6. BDI for outcome-driven action

The user mentioned "Belief-Desire-Intent of people and organizations" tied to outcomes. This is exactly the trust-update loop closing.

### 6.1 The outcome → belief update cycle

```
OutcomeReport submitted by recipient
   ↓
OutcomeValidation by validator
   ↓
TrustDeposit on relevant agents (recipient, fund, validator)
   ↓
EVERY OBSERVING AGENT updates Beliefs:
   - Person Agents: trust scores of other agents update
   - Fund Agents: track record of recipient improves; donor stories generated
   - Hub Agents: ecosystem health metric updates
   - Validator Agent: own validation accuracy track record updates
   ↓
Next BDI cycle uses updated Beliefs to reshape Desires and Intentions
```

This is the **closed loop**. Past outcomes → present beliefs → future intentions. The system *learns* from what worked.

### 6.2 What this enables

**Trust-based philanthropy at scale:**
- A recipient who's delivered 3 awards successfully has high trust score
- Funds give them larger, longer-term, less-restricted awards (trust-based philanthropy default)
- They get matched as low-risk in future allocator runs

**Mandate evolution:**
- A fund whose mandate isn't producing outcomes (deliberate phase observes this) generates revision proposals
- Hub steward sees trend; convenes governance for mandate update
- New mandate published; round refreshes; behavior adapts

**Failure detection:**
- Recipient who's missed milestones gets surfaced in fund-admin queue
- Fund agent sends gentle nudge; if persistent, requests intervention from hub
- Trust deposit decreases; future allocator runs deprioritize

**Donor relationship deepening:**
- Past outcomes get rendered as stories (with permission) for that donor's portfolio
- Donor agent's beliefs include "this fund is honoring my intent" — strengthens commitment
- Cross-hub: donor sees their multi-hub portfolio coherence

These are *emergent* properties of running BDI loops with genuine outcome feedback. No central optimizer.

---

## 7. Trust and privacy in agent negotiation

Agentic agents talking to each other need clear trust and privacy rules.

### 7.1 What an agent reveals during negotiation

| Negotiation step | Agent reveals | Agent does not reveal |
|---|---|---|
| Fund solicits donor | Public mandate; aggregated track record | Other donors' identities; private fund decisions |
| Fund refers proposal to sibling fund | Proposal IRI (already public on chain) + summary | Proposer's full plan (cross-delegation transfers separately if accepted) |
| Fund negotiates with proposer | Mandate fit assessment; suggested revisions | Internal review notes from other reviewers |
| Donor responds to solicitation | Whether they're interested | Their existing pledges to other funds |
| Validator negotiates with fund | Validation methodology; cost; timeline | Other validations they've performed (unless aggregated reputation) |

### 7.2 Authentication of agent identity

Every A2A message is signed by the sending agent's session signer (existing infrastructure). The receiver verifies via ERC-1271 on the sender's smart account. Sybil attacks become expensive (each agent identity = a smart account deployment with credentials).

For Fund and Hub Agents, the message also asserts the agent's *mandate* (or hub policy) — a malicious agent claiming to be a fund must have a corresponding on-chain mandate publication.

### 7.3 Reputation-bounded negotiation

Agents only negotiate with counterparties whose trust score crosses a threshold. Configurable per agent:

```
Person Agent's negotiation policy:
  - accept proposals from agents with trust ≥ 5
  - accept solicitations from funds with mandate-fit ≥ 0.7 AND trust ≥ 7
  - decline outright if counterparty is on personal block-list
```

Funds can be more / less liberal depending on their mandate's risk tolerance.

### 7.4 Adversarial mitigation

What if a malicious agent floods solicitations? Standard rate-limiting + reputation-based filtering. The marketplace sees adversarial behavior reflected in low trust scores; well-behaved agents naturally rise.

What if a fund agent acts in bad faith (approves cronies, ignores restrictions)? The TrustDeposit + OutcomeValidation chain catches this within a round or two. Donors' beliefs update; pledges stop flowing; the fund withers.

The system has natural feedback loops that don't require central enforcement — but Hub stewards can intervene (Hub agent's Intentions include mediation).

---

## 8. What this means for v1 scope

Honest assessment: **full BDI engines for all 5 agent types is Phase 6+ work.** v1 should ship a stripped-down version where each agent has a *minimal* BDI loop with clear extension points.

### 8.1 v1 BDI scope per agent

| Agent | v1 BDI surface |
|---|---|
| **Person Agent** | Reactive only: matcher runs on /discover visit; surfaces match cards. No proactive solicitation. |
| **Org Agent** | Same as Person. |
| **Fund Agent** | Reactive: process pledges and proposals as they arrive; basic allocator (single-coach or multisig). Acknowledgments scheduled (cron). No proactive solicitation, no sibling-fund referral. |
| **Hub Agent** | Mostly passive: registry of funds, member-list management. No gap detection. |
| **Validator Agent** | Mostly passive: process validation requests as they arrive. |

This is what F1–F16 in the architecture doc actually covers. The BDI framing is the *architecture* to grow into.

### 8.2 Phase 5 BDI additions

| Agent | Phase 5 add |
|---|---|
| **Person Agent** | Proactive scheduled match-checking; recurring-pledge state machine |
| **Org Agent** | Aggregate org-level needs into proposal drafts |
| **Fund Agent** | Proactive donor solicitation; sibling-fund referrals; mandate refinement based on past outcomes |
| **Hub Agent** | Gap detection; cross-fund campaign coordination |
| **Validator Agent** | Schedule validation; report patterns |

### 8.3 Phase 6+ BDI additions

| Agent | Phase 6+ add |
|---|---|
| **All** | LLM-augmented deliberation (drafting feedback, summarizing outcomes, detecting nuanced gaps) |
| **Fund Agent** | Cross-hub coordination; mandate proposal generation |
| **Hub Agent** | Predictive coverage analysis |
| **Validator Agent** | Self-policing (decline validations beyond competence) |

### 8.4 Non-goals for v1

We're explicitly **not** building:
- Real-time agent negotiations (chatbots talking to each other)
- LLM-driven deliberation
- Cross-hub coordination
- Adversarial-resistant reputation algorithms beyond TrustDeposit basics

These are research-stage. v1 is the *foundation* on which they can later land.

---

## 9. Why this is uniquely possible in our system

Three preconditions that almost no other grants infrastructure has:

1. **Every agent has its own MCP** — private state with delegation-gated reads. This is the BDI's "private beliefs" infrastructure.
2. **Every agent has an A2A endpoint** — already-built message-passing rails with delegation tokens.
3. **Every relevant fact has an on-chain assertion** — public beliefs are fully addressable.

The combination is rare. Allo has the on-chain layer but no per-agent MCPs and no rich A2A. Gitcoin has Passport for identity but no per-agent intelligence engines. Traditional grant software has none of the three.

The architectural choices we made for *people-group MCP*, *delegation/cross-delegation patterns*, *agent-account resolver*, and *agent-to-agent messaging* are exactly the rails BDI agents need. The grants-fund layer is the *first* genuinely-multi-agent application of this stack.

---

## 10. Strategic value summary

What does the BDI / agentic framing buy us, concretely?

| Benefit | Why it matters |
|---|---|
| **Funds with personality** | A donor relating to "NoCo Trauma-Care Fund" feels different than donating to a smart contract. The fund becomes an entity with reputation, voice, history. |
| **Active matchmaking** | The marketplace finds *you* — funds reach out when your past intent suggests fit. Reduces user effort. |
| **Cross-fund coordination** | Proposals get routed to best-fit funds without manual rerouting. Sibling fund collaboration on co-funding. |
| **Mandate evolution** | Funds learn from outcomes; mandates iterate. Static foundations get displaced by ones that adapt. |
| **Trust-based philanthropy** | Multi-year, less-restricted awards become natural defaults for high-trust recipients. |
| **Story generation** | Outcomes get rendered as donor-facing narratives respecting permissions. Fund retains donor engagement. |
| **Multi-hub identity** | One person operating in multiple hubs has a coherent agent identity, with hub-scoped contexts. |
| **Belief-Desire-Intent semantics** | The system's behavior maps to philosophical categories that match how humans actually act. Disputes and decisions are explainable. |

The big claim: **once the BDI rails are in, the marketplace becomes intelligent without central intelligence.** Each agent acts on its own beliefs in pursuit of its own desires. The aggregate behavior is the emergent property.

This is fundamentally different from a traditional database-driven funding platform. It's why Fund-as-Agent matters not just for the ontology (per the architecture doc) but for the runtime semantics. The two arguments converge on the same conclusion: **agents, not contracts, not pools, not configurations.**

---

## 11. Open questions for further design

1. **BDI cycle scheduling**: cron + event-driven hybrid? what's the right cadence per agent type? Empirical question.
2. **Persistent vs ephemeral beliefs**: should an agent's beliefs persist across sessions or be re-derived each cycle? Probably mostly re-derive (since on-chain + own MCP is authoritative); cache only for efficiency.
3. **LLM augmentation**: when do we add it? gradually per agent type, or for specific deliberation steps? Recommendation: start with rule-based deliberation; add LLM for narrative-generation tasks (acknowledgments, story-rendering) in Phase 5.
4. **Adversarial agent detection**: monitoring for agents acting outside their stated mandate. Manual mediation in v1; pattern-detection in Phase 5+.
5. **Cross-hub coordination protocols**: define the message kinds and ack patterns for sibling-hub fund coordination. Phase 5 design topic.
6. **Story generation permissions**: explicit machine-readable consent on how outcome stories can be told. Phase 5+ design.
7. **Validator credential issuance**: who issues "validated trauma-care expert" credentials? Bootstrapping the validator pool. Hub-steward issued in v1; community-issued in later phases.
8. **Scaling**: when there are 10,000 funds and 1M persons, how do we keep BDI cycle compute reasonable? Probably partition by hub + lazy evaluation. Future scaling concern.

---

## 12. Take-away

The strategic move is **agents, not pools.**

Every agent runs a Belief–Desire–Intention cycle. Beliefs come from public on-chain data + own MCP + cross-delegated reads. Desires come from intents + mandates + stewardship policies. Intentions are committed plans signed and acted on.

This single architectural commitment delivers:
- The *three-lane* funding model (relationship / pool / proposal) naturally — each lane = different agent behaviors
- Multi-hub participation naturally — one agent, multiple hub contexts
- Outcome-driven trust updates naturally — beliefs update, future intentions adapt
- Multi-agent emergent coordination naturally — sibling-fund referrals, donor-portfolio optimization, hub gap-detection
- The faith-funding stewardship rich-object-model naturally — separate Pledge / Contribution / Acknowledgment / Story / Restriction objects fall out of clean BDI separation

We don't claim to ship full BDI engines in v1. We ship the *rails* (MCPs, A2A, on-chain assertions, delegation, audit logs, trust deposits). The intelligence layers in successively over Phases 5, 6, 7.

The unique opportunity the user identified is correct: a multi-agent system built on consent-based delegation, owner-routed private state, and public assertion projections is exactly the substrate where agentic philanthropy can finally live. The grants-fund layer is the first proof of that substrate's value. The faith-funding domain is the rich first market that exercises every aspect of the design.

The Fund is an Agent. The Hub is an Agent. The Person is an Agent. The Validator is an Agent. The marketplace is what they do together.
