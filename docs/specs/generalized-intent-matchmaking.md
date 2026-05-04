# Generalized Intent Matchmaking — The Universal Pattern

**Status:** Foundational / re-framing doc
**Companions:** All other docs in this directory build on this one.
**Purpose:** The recent docs got narrow — they framed the marketplace as a *grants/funding* system. That's wrong. The system is fundamentally an **intent matchmaking** platform, of which funding is one specialization among many. This doc restates the universal pattern: Intent → Commitment → Engagement → Activity → Outcome → Validation → TrustUpdate, the BDI cycle that drives it, and the catalog of intent specializations (coaching, prayer, mentorship, skills, hospitality, in-kind, witness, intercession, advocacy, …) that share the same structure.

This is the *foundation* on which the funding ontology, faith-funding patterns, and grant-fund infrastructure sit. Everything else specializes this.

---

## 1. The course correction

The user's reminder, paraphrased:

> Intent isn't only about funding. It's also matchmaking of skills, coaching, prayer, hospitality, witness, accountability — anything where someone *desires* something they don't have, or *offers* something others might need.

Rewinding to first principles: every act of generosity (broadly conceived) is the same shape:

- Someone has a **desire** (a Need or a Gift)
- Someone else has a complementary desire
- They **commit** to each other (or to a mediator)
- They **engage** through some activity
- An **outcome** results
- The outcome is **validated** by some standard
- **Trust updates** flow through the social graph
- **Beliefs update**; future intents are shaped by what worked

This is the BDI loop, instantiated across every domain where humans match desires.

Funding is one domain. Coaching is another. Prayer is another. The pattern is the same. The variation is in what flows (money / time / words / presence / skills) and how outcomes are measured (financial reports / growth markers / answered prayers / deliverables produced).

The strategic move: **make the core BDI loop universal in the ontology.** Specializations are configurations.

---

## 2. The universal pattern

```
              ACTIVATION LAYER
        (story, exposure, awareness, push)
                       ↓
                       ↓ generosity starts with awareness
                       ↓
   ┌───────────────────┴────────────────────┐
   │                                        │
   │            UNIVERSAL BDI CYCLE         │
   │                                        │
   │   Intent (desire-as-published)         │
   │      │                                 │
   │      ▼                                 │
   │   Commitment (intent + signature)      │
   │      │                                 │
   │      ▼                                 │
   │   Engagement (mutual commitment)       │
   │      │                                 │
   │      ▼                                 │
   │   Activity (the actual exchange)       │
   │      │                                 │
   │      ▼                                 │
   │   Outcome (what was produced)          │
   │      │                                 │
   │      ▼                                 │
   │   Validation (was it real / good?)     │
   │      │                                 │
   │      ▼                                 │
   │   Trust Update (graph edge mutation)   │
   │      │                                 │
   │      ▼                                 │
   │   Belief Update (next-cycle inputs)    │
   │      │                                 │
   └──────┴─── back to Intent ──────────────┘
```

Every domain runs this cycle. The classes — Intent, Commitment, Engagement, Activity, Outcome, Validation, TrustUpdate — are *generic*. They specialize per domain.

---

## 3. The intent kinds catalog

Real domains people actually generate intent in. Not exhaustive, but illustrative:

| Domain | Give-direction kind | Receive-direction kind | What's exchanged |
|---|---|---|---|
| **Funding (capital)** | `sa:CapitalOfferType` | `sa:CapitalNeedType` | Money |
| **Funding (in-kind)** | `sa:InKindOfferType` | `sa:InKindNeedType` | Goods, materials, equipment |
| **Coaching** | `sa:CoachingOfferType` | `sa:CoachingNeedType` | Mentorship time, frameworks |
| **Mentorship** | `sa:MentorshipOfferType` | `sa:MentorshipNeedType` | Long-term life-on-life relationship |
| **Skills / labor** | `sa:SkillOfferType` | `sa:SkillNeedType` | Specific expertise (translation, design, web dev, accounting) |
| **Volunteer service** | `sa:ServiceOfferType` | `sa:ServiceNeedType` | Hours of work for a project |
| **Prayer** | `sa:PrayerOfferType` | `sa:PrayerNeedType` | Intercessory commitment |
| **Hospitality** | `sa:HospitalityOfferType` | `sa:HospitalityNeedType` | Meal, lodging, welcome |
| **Witness / testimony** | `sa:WitnessOfferType` | `sa:WitnessNeedType` | Sharing one's story; needing to hear someone's |
| **Accountability** | `sa:AccountabilityOfferType` | `sa:AccountabilityNeedType` | Mutual checking-in, struggle-sharing |
| **Advocacy** | `sa:AdvocacyOfferType` | `sa:AdvocacyNeedType` | Public-voice support |
| **Listening / counsel** | `sa:CounselOfferType` | `sa:CounselNeedType` | Pastoral / advisory presence |
| **Information / referral** | `sa:ReferralOfferType` | `sa:ReferralNeedType` | "I know someone who can help" |
| **Equipment / tool sharing** | `sa:EquipmentOfferType` | `sa:EquipmentNeedType` | Lend tools / facilities |
| **Transportation** | `sa:TransportOfferType` | `sa:TransportNeedType` | Rides, logistics |
| **Capacity / facility** | `sa:FacilityOfferType` | `sa:FacilityNeedType` | Meeting space, retreat venue, classroom |
| **Childcare / eldercare** | `sa:CareOfferType` | `sa:CareNeedType` | Caregiving help |
| **Translation / interpretation** | `sa:TranslationOfferType` | `sa:TranslationNeedType` | Language access |
| **Connection / introduction** | `sa:ConnectionOfferType` | `sa:ConnectionNeedType` | Network access |
| **Capital + revenue-share (CIL pattern)** | `sa:RevenueShareCapitalOfferType` | `sa:RevenueShareCapitalNeedType` | Capital with profit-sharing |

This is the actual surface of generosity. Funding is rows 1-2. Everything else is just as real.

The seed data already exercises several:
- Maria has `sa:CoachingOfferType` (give) — coaching mentorship
- Sofia has `sa:CircleCoachNeededType` (receive) — coaching for her G2 apprentice
- David has `sa:LeaderApprenticeNeedType` (receive) — apprentice for Wellington
- CIL Cameron has `sa:BusinessCoachingOfferType` (give) — Togo cohort
- Afia has `sa:CapitalNeedType` (receive) — $250k
- Maria has `sa:GuidanceNeedType` (receive, private) — trauma-care training

We're not designing a funding system in the abstract. We're designing a system that already has half a dozen intent kinds in production.

---

## 4. Specialization dimensions

Each intent kind specializes the universal BDI cycle along these axes:

| Dimension | Funding | Coaching | Prayer | Skills | Hospitality |
|---|---|---|---|---|---|
| **Unit exchanged** | money | hours of mentorship | intercessory commitment | specific deliverable | meal/bed/welcome |
| **Cadence** | one-time / recurring | ongoing relationship | per-need / ongoing | one-shot / project-based | event-based |
| **Validation evidence** | financial report + outcome metrics | growth markers + relational health | testimony + answered-prayer reports | deliverable inspection | gratitude + relational outcomes |
| **Trust source** | track record + audit | personal vouch + chemistry | spiritual reputation + faithfulness | portfolio + references | personal recommendation |
| **Commitment durability** | strong (money signed) | medium (relational) | varies | medium (project scope) | low-friction (one-event) |
| **Privacy concerns** | gift restriction respect | confidentiality | prayer-list privacy | IP / confidentiality | guest privacy |
| **Mediator pattern** | Fund (pool / DAF / circle) | Hub coordinator / coaching network | Prayer chain / circle | Skills marketplace / staffing | Hospitality network |
| **Match dynamics** | many givers : few recipients | 1:1 or 1:few | many ↔ many (overlapping) | 1:1 | 1:1 |
| **Scale** | unlimited | bounded by mentor capacity | unlimited (each prayer is light) | bounded by skill availability | bounded by physical capacity |
| **Failure mode** | money misallocated | relationship breakdown | spiritual deception | deliverable not produced | discomfort / harm |

The structure of the cycle is identical across these. The *content* and *constraints* vary. Our system needs to treat the cycle as universal and the variations as configuration.

---

## 5. BDI for each specialization

The Belief–Desire–Intention loop applies to every specialization. Here's how it varies.

### 5.1 Funding BDI

Already covered in `agentic-hub-and-bdi.md`. Briefly:
- Beliefs: pledges, proposals, financial state, mandate, track record
- Desires: outcomes funded, donor satisfaction, recipient flourishing
- Intentions: pledge, propose, approve, allocate, disburse, validate

### 5.2 Coaching BDI

**Beliefs** (coach perspective):
- Who I'm currently coaching, their state, recent sessions, growth markers
- Who's seeking coaching whose context fits my expertise
- My capacity (how many disciples can I sustainably support)
- Track record of past disciples' growth
- My own coach's input

**Desires:**
- Disciples reaching maturity / fruitfulness
- Healthy multiplication (G2 apprentices ready to coach)
- Personal sustainability (don't burn out)

**Intentions:**
- Schedule next session with each current disciple
- Accept or decline new disciple requests
- Schedule own development (read, retreat, peer learning)
- Make introductions when fit better matches another coach

**A2A engine:**
- Listen for new public coaching needs in my geo / domain
- Compute match for my capacity + chemistry
- Send invitation to potential disciple ("I have capacity; would you like to talk?")
- Schedule session reminders
- Capture session notes (with disciple consent)

**Match cards (coach view):**
```
Card: coaching-direct-match
  Verb: "Reach out to potential disciple"
  Subject: <person with public CoachingNeedType matching my expertise>
  Score: chemistry + geo + capacity-fit
```

### 5.3 Prayer BDI

**Beliefs** (intercessor perspective):
- Current prayer commitments (people / situations / promises)
- Recent answered prayers / God's faithfulness in my history
- Burdens I've been carrying
- Prayer rhythm (daily? hourly? specific times?)

**Desires:**
- People/situations brought before God
- Faithfulness to commitments
- Spiritual sensitivity / hearing

**Intentions:**
- Pray at scheduled times for committed names
- Add new urgent burdens to list
- Report back to those I'm praying for (with permission)

**A2A engine:**
- Listen for new public prayer requests
- Schedule prayer reminders for committed names
- Track answered prayers (with permission to share testimony)
- Pass burdens to wider prayer network when appropriate

**Match cards:**
```
Card: prayer-direct-commitment
  Verb: "Commit to pray for <name> for <duration>"
  Subject: <person who published a prayer need>
  Score: relational distance + capacity + spiritual sensitivity

Card: prayer-chain-mobilization
  Verb: "Forward to your prayer network"
  Subject: <urgent need flagged in hub>

Card: prayer-circle-join
  Verb: "Join intercessory circle"
  Subject: <ongoing prayer group focused on a region/issue>
```

### 5.4 Skills BDI

**Beliefs** (skill-offerer perspective):
- My skills + current availability
- Active skill needs in my network
- Past projects and outcomes
- My professional reputation

**Desires:**
- Use my skills meaningfully (not just for pay)
- Build relationships through skill exchange
- See work I do produce visible outcomes

**Intentions:**
- Take on skill projects matching my values + availability
- Decline projects misaligned with values
- Volunteer for high-impact one-off projects

**Match cards:**
```
Card: skill-project-match
  Verb: "Apply to project"
  Subject: <person/org with SkillNeedType matching my expertise>
  Score: skill-fit + values-alignment + scope-fit

Card: skill-bench-recruitment
  Verb: "Join the skills bench for <hub>"
  Subject: <hub or fund recruiting standby skills>
```

### 5.5 Hospitality BDI

**Beliefs:**
- My household state, capacity (rooms, meal availability)
- Coming guests, schedule, dietary needs
- Hospitality history

**Desires:**
- Welcome people; build community through table fellowship
- Support travelers, refugees, retreat attendees

**Intentions:**
- Open home for specific dates / guests
- Coordinate group meals
- Refer when at capacity to another in network

**Match cards:**
```
Card: hospitality-direct-host
  Verb: "Offer to host"
  Subject: <traveler with HospitalityNeedType in my city>
  Score: schedule-fit + dietary-fit + chemistry

Card: hospitality-network-join
  Verb: "Join hospitality network"
  Subject: <regional network coordinating multiple hosts>
```

### 5.6 The pattern

For every intent kind, the same triad of questions applies:

1. **What does my BDI loop need to know?** (Beliefs — domain-specific state)
2. **What outcomes do I want?** (Desires — domain-specific goals)
3. **What concrete plans am I committed to?** (Intentions — domain-specific actions)

The BDI cycle code is the same. The *content* of beliefs/desires/intentions is per-domain. This is exactly what BDI architectures provide: a generic loop with pluggable domain semantics.

---

## 6. Three lanes apply universally

The relationship/pool/proposal lanes from `faith-funding-and-stewardship.md` aren't funding-specific. They apply to every intent domain:

| Lane | Funding | Coaching | Prayer | Skills | Hospitality |
|---|---|---|---|---|---|
| **Relationship** | direct gift, missionary support | 1:1 coaching pair, mentorship | personal prayer commitment | 1:1 skill volunteer | direct hosting |
| **Pool** | DAF, giving circle, faith promise | Coaching network (members commit hours) | Prayer chain, intercessory team | Skills bench / volunteer pool | Hospitality network |
| **Proposal** | grant round, RFP | Apprenticeship program with structured curriculum | Strategic prayer initiative (40 days, etc.) | Project-based skill engagement | Retreat / event-hosting plan |

All three lanes work for every domain. Funding is one domain that exercises all three lanes; coaching is another that exercises all three; prayer; skills.

This re-frames what we've designed: not "funding lanes," but **generosity lanes**.

---

## 7. Activation layer is universal

Same with activation. *Every* intent type has the awareness → desire → commitment cycle:

| Intent type | What "activates" the giver | Stories that move people |
|---|---|---|
| Funding | story of impact, urgent need, mission update | a missionary letter, a campaign video |
| Coaching | seeing someone struggle, feeling called to mentor | a peer's testimony of growth, a leader's invitation |
| Prayer | hearing of suffering, sensing the Holy Spirit's prompt | a friend's burden shared, a news story |
| Skills | encountering a project that aligns with values | "we need a designer" call from a movement |
| Hospitality | learning of a traveler / refugee / retreat attendee | a host's testimony of welcome |

The user's insight — *"generosity often starts with awareness"* — was domain-general. It applies to every intent type. The activation layer (Story, Subscription, OutreachMessage, push notifications, hub announcements) flows generosity in *all* of these cases.

---

## 8. Privacy patterns apply universally

The six privacy patterns from `giver-activation-and-private-needs.md` aren't funding-specific:

| Pattern | Funding example | Coaching example | Prayer example |
|---|---|---|---|
| **Selective disclosure** | sensitive trauma-recovery fund | confidential coaching for at-risk leaders | intercession for endangered missionary |
| **Trusted intermediary** | refugee aid attestation | pastor vouching for at-risk leader | prayer-chain coordinator vouching for urgency |
| **Coarse-only** | "$X for trauma-care in Colorado" | "experienced coach needed in NoCo" | "prayer for persecuted believers in country X" |
| **ZK proofs** | proof of geo without revealing | proof of vetting without revealing | proof of ministry status |
| **Fund-as-shield** | refugee fund | coaching network as confidentiality buffer | prayer chain as buffer |
| **Escrow-then-reveal** | major sensitive grant | coaching engagement with binding NDA | prayer commitment with revealed details |

Every domain has sensitive cases. Every domain benefits from the same six patterns.

---

## 9. The matcher is universal

`/discover` doesn't render only funding cards. It renders cards across all domains the user has intents in. The matcher (matchmaking-strategy.md) is *kind-aware* but otherwise uniform.

Maria's discover panel might surface:
- Direct coaching match (Sofia needs a coach) — *coaching domain*
- Pool fund match (NoCo Trauma-Care Fund) — *funding domain*
- Proposal match (her own apprentice needs a structured curriculum) — *coaching/proposal*
- Prayer commitment opportunity (a missionary support team request) — *prayer domain*
- Skill-share match (someone needs a Spanish-speaking facilitator) — *skills domain*
- Hospitality match (a visiting trainer needs lodging) — *hospitality domain*
- Active campaign — *activation/funding*

The matcher iterates over all the user's intents (across all domains) and queries the appropriate public projection (on-chain or hub feed) for each. Same code path; different intent kinds.

---

## 10. Refactored ontology layering

The previous ontology consolidation doc put everything in `sagrant:`. That was wrong.

### 10.1 Clean layering

```
sa:                          [universal — all intent matchmaking]
├── Agent (Person, Org, Hub, Fund, Validator, AI)
├── Intent (NeedIntent, GiftIntent — direction-tagged)
├── Commitment (formalized intent — Pledge, Promise, Reservation, ...)
├── Engagement (mutual commitment situation)
├── Activity (the actual exchange)
├── Outcome (what was produced)
├── Validation (assessment)
├── TrustUpdate (graph mutation)
├── Story / Subscription / OutreachMessage (activation layer)
├── Restriction / StewardshipPolicy (constraint primitives)
└── PrivacyPattern (sensitivity handling)

sageo:                       [geographic facets]
sapg:                        [people-group concepts]
sagrant:                     [funding-specific specializations]
sacoach:                     [coaching-specific specializations]    ← NEW (or stay in sa:)
saskill:                     [skills-specific specializations]      ← NEW (or stay in sa:)
sapray:                      [prayer-specific specializations]      ← NEW (or stay in sa:)
sahost:                      [hospitality-specific specializations] ← NEW (or stay in sa:)
```

### 10.2 The refactor

Move from the consolidated ontology doc into `sa:`:

- `sagrant:GiftIntent` → `sa:GiftIntent` (already exists in sa:)
- `sagrant:NeedIntent` → `sa:NeedIntent` (already exists)
- `sagrant:PledgeCommitment` → `sa:Commitment` with subclass `sa:Pledge`
- `sagrant:Engagement` → already exists in `sa:`
- `sagrant:OutcomeReport` → `sa:OutcomeReport`
- `sagrant:OutcomeValidation` → `sa:OutcomeValidation`
- `sagrant:TrustUpdate` → already in sa via TrustDeposit pattern
- `sagrant:Story` → `sa:Story`
- `sagrant:Subscription` → `sa:Subscription`
- `sagrant:OutreachMessage` → `sa:OutreachMessage`
- `sagrant:PrivacyPattern` and 6 patterns → `sa:PrivacyPattern` etc.
- `sagrant:StewardshipPolicy` → `sa:StewardshipPolicy`
- `sagrant:Restriction` → `sa:Restriction`

Keep in `sagrant:`:
- `sagrant:FundAgent` (subclass of `sa:OrganizationAgent`)
- `sagrant:FundMandate` (subclass of `sa:Description`)
- `sagrant:Pledge` (subclass of `sa:Commitment` for capital/in-kind specifically)
- `sagrant:GrantAwardAgreement` (subclass of `sa:Engagement`)
- `sagrant:DisbursementActivity` (subclass of `sa:Activity`)
- `sagrant:CapitalResource`, `sagrant:Treasury`, `sagrant:FundPoolEntry`
- `sagrant:` SKOS schemes for funding mechanisms, governance models specific to funding
- `sagrant:` SHACL shapes for funding-specific constraints

New domain-specific namespaces (or sa: subclasses):

**`sacoach:`** (or `sa:Coaching*`):
- `sacoach:CoachingEngagement` (subclass of `sa:Engagement`)
- `sacoach:CoachingSession` (subclass of `sa:Activity`)
- `sacoach:GrowthMilestone` (subclass of `sa:Outcome`)
- `sacoach:CoachingCommitment` (subclass of `sa:Commitment`)
- `sacoach:CoachingNetwork` (subclass of `sa:OrganizationAgent`)

**`sapray:`** (or `sa:Prayer*`):
- `sapray:PrayerCommitment` (subclass of `sa:Commitment`)
- `sapray:IntercessorRole` (subclass of `dul:Role`)
- `sapray:PrayerEvent` (subclass of `sa:Activity`)
- `sapray:AnsweredPrayer` (subclass of `sa:Outcome`)
- `sapray:PrayerChain` (subclass of `sa:OrganizationAgent`)

**`saskill:`** (or `sa:Skill*`):
- `saskill:SkillEngagement` (subclass of `sa:Engagement`)
- `saskill:SkillDeliverable` (subclass of `sa:Outcome`)
- `saskill:SkillsBench` (subclass of `sa:OrganizationAgent`)

The decision *whether* to make these their own namespaces vs `sa:` subclasses is a judgment call:

- **Own namespace** when the domain has many specific terms + its own controlled vocabularies + likely third-party integration (e.g. `sapg:` justifies its own namespace because Global.Church publishes their own `gc:` ontology)
- **Sa: subclasses** when the domain has just a handful of terms and they're tightly coupled with sa: identity / agents

**Recommendation for v1:**
- `sagrant:` is justified — funding has distinctive terms (FundMandate, GrantAwardAgreement, FundingMechanism, Disbursement, etc.)
- Coaching, prayer, skills, hospitality should stay as `sa:` subclasses for now
- Promote to dedicated namespaces if/when third-party integration appears (e.g. a coaching standards body publishes their own ontology)

### 10.3 Refactored grants-ontology.md scope

The grants ontology doc keeps its detailed content but is no longer the *root*. The root is this generalized doc + a (to-be-written) companion `intent-matchmaking-ontology.md` that holds the universal classes.

Updated structure:

```
docs/specs/
├── generalized-intent-matchmaking.md     (THIS doc — pattern + catalog)
├── intent-matchmaking-ontology.md        (NEW — universal sa: T-Box)
├── grants-fund-architecture.md           (funding specialization architecture)
├── grants-ontology.md                    (funding-specific T-Box only)
├── faith-funding-and-stewardship.md      (faith-funding patterns)
├── funding-models-survey.md              (funding model survey)
├── gitcoin-grants-deep-dive.md           (Gitcoin reference)
├── matchmaking-strategy.md               (caller-side matcher across all domains)
├── agentic-hub-and-bdi.md                (BDI for all agent types, all domains)
└── giver-activation-and-private-needs.md (activation + privacy across domains)
```

The funding docs are now correctly subordinate to the universal layer.

---

## 11. Implementation implications

### 11.1 The F-series commits ship the universal core, then specialize

Original F1–F16 plan was funding-flavored. Refactor:

| Phase | Original | Generalized |
|---|---|---|
| **Universal core** (formerly F1–F4) | "Discovery + matcher for funding intents" | **Intent matchmaking core** — works across all kinds. Maria's coaching, Sofia's coaching need, Maria's trauma need, Sarah's pledge — all surfaced uniformly. |
| **Funding specialization** (formerly F5–F12) | Fund agent + Mandate + Pledge + Award + Disbursement | Same scope; clearly labeled as funding specialization. |
| **Coaching specialization** (NEW) | not in plan | Coaching network + structured engagement + growth-markers outcome class |
| **Prayer specialization** (NEW) | not in plan | Prayer chain + commitment + answered-prayer outcome (high-privacy) |
| **Skills specialization** (NEW) | not in plan | Skills bench + project engagement + deliverable outcome |
| **Hospitality specialization** | not in plan | Hospitality network + event-hosting + relational outcomes |
| **Activation layer** (formerly F13–F15) | "Story + outcome reporting for funds" | Universal — applies to all specializations |

The implementation effort *roughly* doubles (we're shipping more domain coverage), but each specialization is small (a handful of subclasses + tools + UI variants). The universal core does the heavy lifting.

### 11.2 The matcher is one piece of code, not five

Currently planned matcher (`aggregator.ts:matchesProposed`) extends to all domains:

```typescript
async function matchesProposed(callerPrincipal): Promise<MatchCard[]> {
  const myIntents = await listMyIntents(callerPrincipal)   // ALL kinds
  const cards: MatchCard[] = []

  for (const intent of myIntents) {
    // Cross-tenant public-projection query — kind-agnostic
    const candidates = await listExpressedIntents({
      direction: opposite(intent.direction),
      kind: matchableKinds(intent.kind),
      geoOverlap: intent.geoRoot,
    })

    for (const c of candidates) {
      const cardKind = cardKindFor(intent.kind, c.kind)  // direct-match | fund-mediated | etc.
      cards.push({ kind: cardKind, ...renderActions(intent.kind, c) })
    }

    // Domain-specific mediator queries
    const mediators = await listMediatorsForKind(intent.kind, intent.geoRoot)
    for (const m of mediators) {
      cards.push({ kind: mediatorCardFor(intent.kind), mediator: m, ... })
    }
  }
  return cards
}
```

`matchableKinds(intent.kind)` is the dispatch — a small lookup table that says "give-coaching matches receive-coaching"; "give-prayer matches receive-prayer"; "give-capital matches receive-capital OR fund-mandates accepting CapitalOffer."

`renderActions(intent.kind, c)` renders the right action verbs ("Propose meeting" vs "Pledge to fund" vs "Commit to pray" vs "Apply to project").

`listMediatorsForKind` returns the right mediator type (Funds for funding, Coaching Networks for coaching, Prayer Chains for prayer).

One matcher. Many domains.

### 11.3 BDI engines per agent are domain-multi-aware

A Person Agent's BDI loop iterates over ALL their intents (regardless of domain). When deliberating, it considers:
- Coaching capacity ("I can take 1 more disciple")
- Prayer commitments ("I'm at 30 names; reluctant to add more")
- Skill availability ("project I'm on ends Q3")
- Financial pledge headroom ("I've committed $500/month; little more available")
- Hospitality (next month's open weekends)

The deliberate phase scores possible Intentions across all domains. This is important — a person might decline a coaching match this week because they're committed to a hospitality block; they might decline a prayer commitment because they're at intercession capacity. The agent's BDI is *holistic*.

This is exactly how humans actually act. Our model matches.

---

## 12. Universal ontology skeleton (proposal)

What `intent-matchmaking-ontology.md` would contain — the universal core T-Box. Not implementing here, just sketching:

```turtle
@prefix sa: <https://smartagent.io/ontology/core#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix dul: <http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#> .

# ─── The universal cycle ────────────────────────────────────────────
sa:Intent
    a owl:Class ;
    rdfs:subClassOf prov:Plan, prov:Entity ;
    rdfs:comment "A published desire to give or receive something." .

sa:NeedIntent rdfs:subClassOf sa:Intent .
sa:GiftIntent rdfs:subClassOf sa:Intent .

sa:Commitment
    a owl:Class ;
    rdfs:subClassOf prov:Entity, dul:CommitmentSituation ;
    rdfs:comment "A formalized intent — signed/witnessed/recorded." .

sa:Engagement
    a owl:Class ;
    rdfs:subClassOf prov:Entity, dul:Situation ;
    rdfs:comment "A mutual commitment between two or more parties to a coordinated activity." .

sa:Activity
    a owl:Class ;
    rdfs:subClassOf prov:Activity, dul:Action ;
    rdfs:comment "The actual exchange — disbursement, session, prayer, hosting, etc." .

sa:Outcome
    a owl:Class ;
    rdfs:subClassOf prov:Entity ;
    rdfs:comment "What was produced by an Activity in pursuit of an Engagement." .

sa:OutcomeReport
    a owl:Class ;
    rdfs:subClassOf sa:Outcome ;
    rdfs:comment "Recipient's report of an outcome." .

sa:OutcomeValidation
    a owl:Class ;
    rdfs:subClassOf prov:Activity, dul:AssessmentAction ;
    rdfs:comment "Assessment of whether an outcome was real / met expectations." .

sa:TrustUpdate
    a owl:Class ;
    rdfs:subClassOf prov:Entity ;
    rdfs:comment "A change to the trust graph following validation." .

# ─── The activation layer ───────────────────────────────────────────
sa:Story
    a owl:Class ;
    rdfs:subClassOf prov:Entity ;
    rdfs:comment "Narrative attached to an Intent / Engagement / Outcome with permissions." .

sa:Subscription rdfs:subClassOf prov:Entity .
sa:OutreachMessage rdfs:subClassOf prov:Entity .

# ─── Cross-cutting primitives ───────────────────────────────────────
sa:Restriction rdfs:subClassOf prov:Entity, dul:Description .
sa:StewardshipPolicy rdfs:subClassOf prov:Entity, dul:Description .
sa:PrivacyPattern rdfs:subClassOf prov:Entity, dul:Description .
sa:Mediator
    a owl:Class ;
    rdfs:subClassOf sa:OrganizationAgent ;
    rdfs:comment "Abstract: any agent that mediates between intent parties (Fund, CoachingNetwork, PrayerChain, SkillsBench, ...)." .

# ─── Universal object properties ────────────────────────────────────
sa:hasIntent              a owl:ObjectProperty ; rdfs:domain sa:Agent ; rdfs:range sa:Intent .
sa:formalizesIntent       a owl:ObjectProperty ; rdfs:domain sa:Commitment ; rdfs:range sa:Intent .
sa:committedTo            a owl:ObjectProperty ; rdfs:domain sa:Commitment ; rdfs:range sa:Mediator .
sa:engagementOf           a owl:ObjectProperty ; rdfs:domain sa:Engagement ; rdfs:range sa:Commitment .
sa:produces               a owl:ObjectProperty ; rdfs:domain sa:Activity ; rdfs:range sa:Outcome .
sa:reportsOn              a owl:ObjectProperty ; rdfs:domain sa:OutcomeReport ; rdfs:range sa:Engagement .
sa:validates              a owl:ObjectProperty ; rdfs:domain sa:OutcomeValidation ; rdfs:range sa:OutcomeReport .
sa:updatesTrust           a owl:ObjectProperty ; rdfs:domain sa:OutcomeValidation ; rdfs:range sa:TrustUpdate .
sa:appliesTo              a owl:ObjectProperty ; rdfs:domain sa:TrustUpdate ; rdfs:range sa:Agent .
sa:storyAbout             a owl:ObjectProperty ; rdfs:domain sa:Story ; rdfs:range prov:Entity .
sa:subscriberOf           a owl:ObjectProperty ; rdfs:domain sa:Agent ; rdfs:range sa:Agent .
sa:hasFundingMechanism    a owl:ObjectProperty ; rdfs:domain sa:Intent ; rdfs:range sa:FundingMechanism .  # general "mechanism" though
sa:hasRestriction         a owl:ObjectProperty ; rdfs:domain sa:Commitment ; rdfs:range sa:Restriction .
sa:hasPrivacyPattern      a owl:ObjectProperty ; rdfs:domain sa:Intent ; rdfs:range sa:PrivacyPattern .
sa:mediatedBy             a owl:ObjectProperty ; rdfs:domain sa:Engagement ; rdfs:range sa:Mediator .

# ─── Datatype properties ────────────────────────────────────────────
sa:direction              a owl:DatatypeProperty ; rdfs:range xsd:string .  # 'give' | 'receive'
sa:visibility             a owl:DatatypeProperty ; rdfs:range xsd:string .
sa:cadence                a owl:DatatypeProperty ; rdfs:range xsd:duration .
sa:durationCommitment     a owl:DatatypeProperty ; rdfs:range xsd:duration .
sa:capacity               a owl:DatatypeProperty ; rdfs:range xsd:integer .
sa:onChainAssertionId     a owl:DatatypeProperty ; rdfs:range xsd:string .
```

This is the *universal core*. Domain extensions sit on top.

---

## 13. Implications for the existing demo seed

The seed already has multi-domain intents. We just haven't fully recognized them as such:

| Existing intent | Domain | What's already in place |
|---|---|---|
| Maria gives CoachingOffer | Coaching | direct-match + recurring-relationship potential |
| Sofia receives CircleCoach | Coaching | direct-match recipient |
| David receives LeaderApprentice | Coaching | direct-match recipient |
| Cameron gives BusinessCoachingOffer | Coaching | direct-match (Togo cohort) |
| Afia receives Capital | Funding | fund-mediated; CIL Capital Pool target |
| Maria receives trauma-care training (private) | Funding (proposal) | sensitive-need pattern |
| Maria's coaching of Ana (existing) | Coaching | already running engagement |
| Maria's coaching of Hannah (private) | Coaching | private coaching pattern (Phase 4 implementation done) |

We've already implemented coaching engagement (apps/web has it). We've already implemented private coaching (Hannah). Funding is the *next* domain to add. The pattern was always universal; we just needed to name it.

---

## 14. Take-away

**Funding is one specialization. The system is fundamentally an Intent Matchmaking platform.**

The universal pattern:

```
Awareness → Intent → Commitment → Engagement → Activity → Outcome → Validation → TrustUpdate → Belief Update → next Intent
```

Specializations:

- **Funding** (capital, in-kind, revenue-share)
- **Coaching** (mentorship, discipleship, structured growth)
- **Prayer** (intercession, individual, chain, group)
- **Skills** (volunteer expertise, deliverables)
- **Hospitality** (welcome, lodging, meal, retreat)
- **Witness** (testimony, story-share)
- **Advocacy** (public voice for a cause)
- **Accountability** (mutual checking, struggle-sharing)
- **Connection** (introductions, network access)
- **Equipment / Facility** (lending, sharing)
- **Care** (childcare, eldercare, presence)
- **Translation / Interpretation** (language access)
- **Counsel / Listening** (advisory presence)

Every specialization fits the same cycle. Every specialization can run all three lanes (relationship / pool / proposal). Every specialization benefits from the activation layer. Every specialization may have sensitivity needs, calling for the privacy patterns.

Architectural commitments:

1. **The universal core lives in `sa:`** — Intent, Commitment, Engagement, Activity, Outcome, Validation, TrustUpdate, Story, Subscription, OutreachMessage, Restriction, StewardshipPolicy, PrivacyPattern, Mediator
2. **Funding specialization lives in `sagrant:`** — has rich enough vocabulary to justify its own namespace
3. **Other specializations (coaching, prayer, skills, hospitality, witness)** — `sa:` subclasses for v1; promote to own namespaces when/if third-party integration justifies
4. **The matcher is one piece of code** — kind-aware but otherwise uniform across domains
5. **BDI engines are domain-multi-aware** — Person Agent's deliberation considers ALL their intents across all domains
6. **Mediators are first-class** — Fund (funding), CoachingNetwork (coaching), PrayerChain (prayer), SkillsBench (skills), HospitalityNetwork (hospitality)
7. **Activation is universal** — story, exposure, awareness applies to all kinds
8. **Privacy patterns are universal** — selective disclosure, trusted intermediary, etc. apply to all sensitive needs regardless of domain

The system is a *generosity protocol*, not a grants platform. The grants-fund work is the proving ground for the protocol. Once it works, the same primitives spin up coaching networks, prayer chains, skills benches, hospitality networks, and any other generosity domain.

This is the *real* strategic frame. Everything else fits inside it.
