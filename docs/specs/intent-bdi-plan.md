# BDI + Intent Layer — Catalyst Orchestration Upgrade

> **Status**: design — ready for first-slice implementation review.
> **Companion to**: `needs-resources-plan.md` (Need/Offering/Match layer), `discovery-ui-plan.md` (Phase 5/6 graph-aware discovery + LLM intent parsing), `catalyst-home-plan.md` (home layout), `demo-work-items.md` (per-silo coverage).
>
> **Premise**: replace Catalyst's two parallel tracks (file a Need / publish an Offering) with one unified verb — **Express an Intent**. An Intent is an *addressed, committed* desire with a **direction** (`receive` or `give`) and an **object** (the value flowing). Need = `direction=receive`. Offering = `direction=give`. Match = two compatible intents converged on the same object. The Need/Offering layer we already built becomes a *projection* of the unified table.
>
> **Why a single class + direction (not subclasses)**: the user's grammar is unreliable. "I need to contribute" sounds receive-shaped but is structurally give-shaped. Hardcoding `RequestIntent` / `OfferIntent` / `ContributionIntent` as separate classes embeds that ambiguity in the schema. **Direction** is the structural truth; the SKOS leaf-type taxonomy (`NeedCoaching`, `OfferIntroduction`, `NeedFunding`, `WantToContribute`) is a UI convenience derived from direction + object. The system's matching logic reads `direction` + `object`; the UI reads `intentType` for labels.
>
> **Why this upgrade matters now**: the user's catalyst use-cases all start with someone *expressing* something — "I need a coach for Berthoud", "we need $40k for a well project", "I have 5 hrs/wk to coach", "I want to contribute somewhere", "we want to know which UPGs in NoCo are most under-engaged". The current Need/Offering split forces the user to pick a verb (file a need vs. publish an offering) before they've even thought through what they want. **Intent** is the verb the user actually has in their head.

---

## 1. The conceptual spine — BDI in 90 seconds

| BDI concept | What it means | RDF anchor | Catalyst example |
|---|---|---|---|
| **Belief** | What the agent holds true | `prov:Entity`, `dul:Description` (and existing `AgentAssertion`) | "Berthoud has 5 farm-worker families that don't have a discipler." |
| **Desire** | What the agent *would* want — latent, not committed | `dul:Description`, `sah:Goal` (new) | "I'd love for Berthoud to have a coach." |
| **Intent** | A *committed, expressed, addressed* desire — actionable | `dul:Plan`, `prov:Plan`, `sah:Intent` (new) | "I, Sofia, am asking the catalyst hub for a coach for Berthoud." |
| **Outcome** | The end-state the intent aims to produce | `sah:Outcome` (new) | "Berthoud Circle has an active coach, baptisms recorded, G2 plant identified." |

The key move: **only Intent is actionable**. Beliefs feed into Intent ("because I believe X, I express the intent Y"). Desires feed into Intent ("because I want Z, I express the intent that gets me Z"). The system doesn't try to read minds — it works on the expressed surface.

Outcome is the success criterion the intent commits to. It's how the system knows the intent has been fulfilled, not just touched.

---

## 2. What's new vs. what we keep

### 2.1 Class shape (one class, two structural axes)

```
sah:Intent                  ← single top class; NO subclasses
  • direction: 'receive' | 'give'      ← STRUCTURAL truth — the only field the matcher reads
  • object: skos:Concept                ← what value is flowing (resource-type vocab)
  • topic: string                       ← free-text scope ("UPGs in NoCo", "well-water filter")
  • intentType: skos:Concept            ← UI label only ("intentType:NeedCoaching" etc.)

sah:Outcome                 ← linked from intents (intentExpects) and from
                              FulfillmentActivities (achievesOutcome)

sah:Belief                  ← light wrapper over AgentAssertion
                              informsIntent → sah:Intent

sah:Desire                  ← latent goal — kept private; matures into Intent
                              when expressed
```

The five "subclasses" from earlier drafts (`RequestIntent`, `OfferIntent`,
`CollaborationIntent`, `InformationIntent`, `ContributionIntent`) are dropped.
They re-derive trivially as views:

| Legacy class | Derived as |
|---|---|
| RequestIntent      | `Intent WHERE direction='receive'` |
| OfferIntent        | `Intent WHERE direction='give'` |
| InformationIntent (asking) | `Intent WHERE direction='receive' AND object='resourceType:Information'` |
| InformationIntent (answering) | `Intent WHERE direction='give' AND object='resourceType:Information'` |
| ContributionIntent | `Intent WHERE direction='give' AND intentType='intentType:WantToContribute'` (the open-ended "place me" case) |
| CollaborationIntent | TWO intents, each `direction='give'`, on the same `topic`, plus an `OrchestrationPlan` that converges them. |

### 2.2 What stays

- `AgentSkillRegistry` — Capability claims still live there. An OfferIntent's *capability* references a skill claim; we don't duplicate.
- `AgentRelationship` — Coaching, alliance, governance edges stay where they are. A RoleAssignment after intent acceptance is still the bridge.
- `NeedResourceMatch` — Match artifact still bridges intents. Renamed conceptually to `IntentMatch` but keep the existing table during migration; views adapt.
- `WorkItem` — `triggeredBy` becomes more powerful: an intent can produce many work items across many agents (orchestration).
- `activityLogs.fulfillsNeedId` — renamed `fulfillsIntentId` (need-rooted intents accept the same column).

### 2.3 What changes

- **`needs` table → projection of `intents`** (where `direction='receive'`): keep existing schema; insert/update routes still work; every write shadows into `intents`.
- **`resource_offerings` table → projection of `intents`** (where `direction='give'`): same.
- **Discover** is reframed: *"find compatible counter-intents on the same object."* The current `runDiscoverMatch` becomes `findCompatibleIntents(intentId)` — given a receive-shaped intent, find give-shaped intents on the same object; given a give-shaped intent, find receive-shaped intents on the same object.
- **Catalyst home**: the "Where the hub needs help" strip becomes "**Open Intents in the hub**" with **direction chips** (📥 Receive / 📤 Give) — not subclass chips.

---

## 3. Ontology — `tbox/intents.ttl` + `cbox/intent-types.ttl` + `cbox/intent-shapes.shacl.ttl`

### 3.1 Class spine (PROV-O + DUL aligned)

```turtle
@prefix saint:   <https://smartagent.io/ontology/intent#> .
@prefix sa:      <https://smartagent.io/ontology/core#> .
@prefix saoffer: <https://smartagent.io/ontology/offering#> .
@prefix prov:    <http://www.w3.org/ns/prov#> .
@prefix dul:     <http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#> .
@prefix skos:    <http://www.w3.org/2004/02/skos/core#> .

# Single Intent class. NO direction subclasses. Direction is a property,
# not a class — keeps the matcher simple and avoids the "need to
# contribute" subclass-misclassification pitfall.
saint:Intent  a owl:Class ; rdfs:subClassOf dul:Plan , prov:Plan ;
    rdfs:comment "An addressed, committed desire with a direction (receive | give) and an object (the value flowing). All matching, scoring, and orchestration reads `direction` + `object`." .

saint:Direction a owl:Class ; rdfs:subClassOf skos:Concept ;
    rdfs:comment "Two-valued: saint:Receive | saint:Give. Modelled as a class so SHACL can validate the enum, and so SPARQL queries can discriminate without a string-equality test." .

saint:Receive a saint:Direction ; skos:prefLabel "receive"@en .
saint:Give    a saint:Direction ; skos:prefLabel "give"@en .

saint:Belief  a owl:Class ; rdfs:subClassOf prov:Entity , dul:Description .
saint:Desire  a owl:Class ; rdfs:subClassOf dul:Description ;
    rdfs:comment "Latent. NOT addressed. Maturing into Intent makes it actionable." .
saint:Outcome a owl:Class ; rdfs:subClassOf prov:Entity , dul:Situation .

saint:OrchestrationPlan a owl:Class ; rdfs:subClassOf dul:Plan , prov:Plan ;
    rdfs:comment "Decomposes one parent Intent into N sub-intents addressed at different agents. Replaces the would-be CollaborationIntent class — collaboration is two give-intents converged via this plan, not its own class." .

saint:IntentMatch a owl:Class ; rdfs:subClassOf dul:Situation , prov:Entity ;
    rdfs:comment "Two compatible intents converged on the same object with complementary directions. Generalises NeedResourceMatch." .
```

### 3.2 Properties

```turtle
# Direction + object are the structural axes. Everything else is metadata.
saint:direction        rdfs:domain saint:Intent ; rdfs:range saint:Direction ;
    rdfs:comment "saint:Receive or saint:Give. The matcher reads ONLY this and the object — never the intentType label." .
saint:object           rdfs:domain saint:Intent ; rdfs:range skos:Concept ;
    rdfs:comment "What value is flowing. Bridges to resource-types vocab (resourceType:Information, resourceType:Money, resourceType:Worker, etc.)." .
saint:topic            rdfs:domain saint:Intent ; rdfs:range xsd:string ;
    rdfs:comment "Free-text scope: 'unreached people groups in NoCo', 'Loveland well-water filter project'." .
saint:intentType       rdfs:domain saint:Intent ; rdfs:range skos:Concept ;
    rdfs:comment "UI label only — e.g. intentType:NeedCoaching, intentType:OfferIntroduction. Derived from direction + object. The matcher does NOT branch on this." .

# Expression — Intent is *addressed*. This is what makes it actionable.
saint:expressedBy      rdfs:domain saint:Intent ; rdfs:range sa:Agent .
saint:addressedTo      rdfs:domain saint:Intent ; rdfs:range sa:Agent ;
    rdfs:comment "Who the intent is asked of — a person, an org, a hub, the network." .
saint:expressedAt      rdfs:domain saint:Intent ; rdfs:range xsd:dateTime .
saint:intentStatus     rdfs:domain saint:Intent ; rdfs:range skos:Concept .   # Drafted | Expressed | Acknowledged | InProgress | Fulfilled | Withdrawn | Abandoned

# Outcome
saint:intentExpects    rdfs:domain saint:Intent ; rdfs:range saint:Outcome .
saint:achievesOutcome  rdfs:domain prov:Activity ; rdfs:range saint:Outcome .
saint:outcomeStatus    rdfs:domain saint:Outcome ; rdfs:range skos:Concept .  # Pending | Partial | Achieved | NotAchieved
saint:outcomeMetric    rdfs:domain saint:Outcome ; rdfs:range xsd:string .    # JSON: how do we know it's achieved?

# BDI plumbing
saint:informsIntent    rdfs:domain saint:Belief  ; rdfs:range saint:Intent .
saint:expressesDesire  rdfs:domain saint:Intent  ; rdfs:range saint:Desire .   # optional — the desire that matured into this intent

# Orchestration
saint:hasSubIntent     rdfs:domain saint:OrchestrationPlan ; rdfs:range saint:Intent .
saint:planFor          rdfs:domain saint:OrchestrationPlan ; rdfs:range saint:Intent .   # the parent intent the plan decomposes
saint:orchestratedBy   rdfs:domain saint:Intent           ; rdfs:range sa:Agent .

# Match (rename of NeedResourceMatch's role)
saint:matchesIntent    rdfs:domain saint:IntentMatch ; rdfs:range saint:Intent .
saint:matchedAgainst   rdfs:domain saint:IntentMatch ; rdfs:range saint:Intent ;
    rdfs:comment "The opposing intent that fits — typically a RequestIntent matched against an OfferIntent." .
```

### 3.3 Intent-type controlled vocabulary (`cbox/intent-types.ttl`)

Each leaf type is the (direction, object) pair, with the user's grammar normalised:

| Concept | direction | object | Example phrasing |
|---|---|---|---|
| `intentType:NeedInformation`   | receive | resourceType:Data        | "Need to know which UPGs in NoCo are most under-engaged" |
| `intentType:NeedHelp`          | receive | resourceType:Worker      | "Need help with Wellington's youth-night logistics" |
| `intentType:NeedCoaching`      | receive | resourceType:Worker      | "Need a coach for Berthoud" |
| `intentType:NeedFunding`       | receive | resourceType:Money       | "Need $4,800 for the Loveland well-water filter project" |
| `intentType:NeedScripture`     | receive | resourceType:Scripture   | "Loveland: heart-language scripture" |
| `intentType:NeedVenue`         | receive | resourceType:Venue       | (existing venue) |
| `intentType:NeedSafePlace`     | receive | resourceType:Venue       | "Familia Morales: short-term housing" (sensitive) |
| `intentType:WantToContribute`  | **give**    | resourceType:Worker  | "I have 5 hrs/wk; put me where I'm useful" *(grammar says "need" but direction is give)* |
| `intentType:OfferSkill`        | give    | resourceType:Skill       | (existing skill offerings) |
| `intentType:OfferPrayer`       | give    | resourceType:Prayer      | (existing prayer commitments) |
| `intentType:OfferIntroduction` | give    | resourceType:Connector   | (existing connector offerings) |
| `intentType:OfferInformation`  | give    | resourceType:Data        | "I have research on UPGs; ask me" |
| `intentType:OfferFunding`      | give    | resourceType:Money       | "I'll fund matching well projects" |

Two intents are compatible iff `(a.direction != b.direction) AND (a.object == b.object) AND (topic-similarity above threshold)`. **The matcher never branches on `intentType`** — it's a UI label.

### 3.4 SHACL invariants

- Every Intent must have `direction` (exactly `saint:Receive` or `saint:Give`) AND `object` (a SKOS concept). These are the structural axes the matcher reads.
- Every Intent must have `expressedBy` AND `addressedTo` (drafts can have `addressedTo = sa:Self` or `sa:Hub`).
- Every Intent must have an `intentStatus`.
- Every `OrchestrationPlan` must have ≥2 `hasSubIntent` and exactly one `planFor`.
- Sensitive `object` values (e.g. `resourceType:Venue` when paired with `intentType:NeedSafePlace`, or any `intentType:NeedTraumaCare`) must carry a `Visibility` of `PrivateCommitment` or stronger — same fence as the geo/skill privacy SHACL shape.
- An `IntentMatch` must reference exactly two intents whose directions are opposite (one `Receive`, one `Give`) — this is what makes them a *match* rather than a co-occurrence.

---

## 4. Information architecture — DB schema

### 4.1 New `intents` table (the unifying record)

```ts
export const intents = sqliteTable('intents', {
  id: text('id').primaryKey(),
  /** Structural axis 1 — the matcher reads this. */
  direction: text('direction', { enum: ['receive', 'give'] }).notNull(),
  /** Structural axis 2 — what value is flowing.
   *  SKOS URI from cbox/resource-types.ttl (e.g. 'resourceType:Money'). */
  object: text('object').notNull(),
  /** Free-text scope — "unreached people groups in NoCo", "well-water filter". */
  topic: text('topic'),
  /** UI label only. Derived from direction + object. Matcher does not branch on this.
   *  e.g. 'intentType:NeedCoaching', 'intentType:OfferIntroduction'. */
  intentType: text('intent_type').notNull(),
  intentTypeLabel: text('intent_type_label').notNull(),
  expressedByAgent: text('expressed_by_agent').notNull(),
  expressedByUserId: text('expressed_by_user_id'),
  /** addressedTo: 'agent:0x…' | 'hub:catalyst' | 'network:catalyst' | 'self'. */
  addressedTo: text('addressed_to').notNull(),
  hubId: text('hub_id').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  /** Open-ended payload (JSON) — direction-typed shape (requirements for receive,
   *  capabilities/capacity for give). */
  payload: text('payload'),
  status: text('status', {
    enum: ['drafted', 'expressed', 'acknowledged', 'in-progress', 'fulfilled', 'withdrawn', 'abandoned'],
  }).notNull().default('expressed'),
  priority: text('priority', { enum: ['critical','high','normal','low'] }).notNull().default('normal'),
  visibility: text('visibility', { enum: ['public','public-coarse','private','off-chain'] }).notNull().default('public'),
  /** Outcome JSON — `{ description, metric, status }`. */
  expectedOutcome: text('expected_outcome'),
  /** Soft FK back to `needs.id` (when direction='receive') or
   *  `resource_offerings.id` (when direction='give'). The projection link. */
  projectionRef: text('projection_ref'),
  validUntil: text('valid_until'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})
```

`direction='receive' AND projectionRef` points at a `needs.id`.
`direction='give' AND projectionRef` points at a `resource_offerings.id`.
A `direction='give'` intent without a projection ref is a free-form Offer that hasn't been promoted into the legacy table (used by `WantToContribute` and other open-ended give-shaped intents that don't fit the offering schema).

Plus three smaller tables:

```ts
// Outcomes (separate so an intent can have many; achievement is tracked over time)
export const outcomes = sqliteTable('outcomes', {
  id: text('id').primaryKey(),
  intentId: text('intent_id').notNull().references(() => intents.id),
  description: text('description').notNull(),
  /** JSON: { kind: 'count'|'boolean'|'date'|'narrative', target: any, observed?: any }. */
  metric: text('metric').notNull(),
  status: text('status', { enum: ['pending','partial','achieved','not-achieved'] }).notNull().default('pending'),
  observedAt: text('observed_at'),
  observedBy: text('observed_by'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// Multi-agent orchestration plans (decomposes one parent intent into sub-intents)
export const orchestrationPlans = sqliteTable('orchestration_plans', {
  id: text('id').primaryKey(),
  parentIntentId: text('parent_intent_id').notNull().references(() => intents.id),
  authorAgent: text('author_agent').notNull(),
  /** JSON: { steps: [{ subIntentId, dependsOn?: [subIntentId], targetAgent }], rationale }. */
  blueprint: text('blueprint').notNull(),
  status: text('status', { enum: ['draft','active','paused','completed','abandoned'] }).notNull().default('active'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// Beliefs (light wrapper over AgentAssertion — most beliefs are already on chain)
export const beliefs = sqliteTable('beliefs', {
  id: text('id').primaryKey(),
  heldByAgent: text('held_by_agent').notNull(),
  /** Optional: backing AgentAssertion id from the on-chain contract. */
  assertionId: text('assertion_id'),
  statement: text('statement').notNull(),
  /** Confidence 0..100 — 100 = held with certainty. */
  confidence: integer('confidence').notNull().default(75),
  validUntil: text('valid_until'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})
```

### 4.2 `activityLogs` extension

```ts
// already present from N9:
fulfillsNeedId: text('fulfills_need_id'),     // → maps to fulfillsIntentId via the projection ref
usesOfferingId: text('uses_offering_id'),

// new:
fulfillsIntentId: text('fulfills_intent_id'),
achievesOutcomeId: text('achieves_outcome_id'),
```

The `fulfillsNeedId` column **stays** so existing demo seed activities don't lose their links. The action layer copies the legacy column into `fulfillsIntentId` at write time.

### 4.3 Migration strategy

1. Create `intents` table.
2. Backfill: for every `needs` row, insert a corresponding `intents` row with `intentClass=RequestIntent`, `projectionRef={needs.id}`, `addressedTo='hub:catalyst'`, `expressedByAgent={needs.neededByAgent}`. Same for `resource_offerings` with `intentClass=OfferIntent`, `addressedTo='hub:catalyst'`.
3. Update `runDiscoverMatch` (and its successor `findIntentMatches`) to query `intents` directly.
4. Keep `needs` and `resource_offerings` writable for back-compat — every write triggers an `intents` upsert via a trigger or action-side hook.
5. Once the UI fully uses Intents, deprecate the projection tables (v3+).

---

## 5. Catalyst UI — what changes

### 5.1 New surfaces

| Route | Purpose |
|---|---|
| `/h/catalyst/intents` | Hub-wide intent inbox/board, filterable by class/type/status/audience |
| `/h/catalyst/intents/new` | **Express an intent** composer — single entry point that replaces "+ File a need" / "+ Offer something" buttons |
| `/h/catalyst/intents/[id]` | Intent detail — expression, status, matches, orchestration plan, work items, outcomes, fulfillment chain |
| `/h/catalyst/inbox` | **Intents addressed to ME** — the actionable inbox |
| `/h/catalyst/outbox` | **Intents I expressed** — track what I asked for and how it's going |
| `/h/catalyst/orchestrations/[id]` | Multi-agent plan view — DAG of sub-intents and their assignees |

### 5.2 The Express-an-Intent composer

Single-screen form that adapts to the *kind* of intent:

```
┌─ What do you want to express? ──────────────────────────────────────┐
│  ( ) I need help with something            [Request]                │
│  ( ) I have something to offer             [Offer]                  │
│  ( ) I want us to do something together    [Collaboration]          │
│  ( ) I need to know something              [Information]            │
│  ( ) I want to contribute somewhere        [Contribution]           │
└─────────────────────────────────────────────────────────────────────┘
       ↓ pick one — form below adapts to the choice
┌─ Title — one sentence ──────────────────────────────────────────────┐
│  [ Berthoud Circle needs an assigned coach                       ]  │
└─────────────────────────────────────────────────────────────────────┘
┌─ Who are you addressing? ──────────────────────────────────────────┐
│  ( ) The whole hub          ( ) A specific agent: [             ]   │
│  ( ) A specific role group  ( ) A specific circle: [            ]   │
└─────────────────────────────────────────────────────────────────────┘
┌─ What would success look like? ─ (drives outcome tracking) ────────┐
│  Description: [ Active coach assigned, biweekly cadence       ]    │
│  Metric:      ( ) count: [3 fulfillment activities]                 │
│               ( ) boolean: assigned/not                             │
│               ( ) narrative                                         │
│               ( ) date: by [ 2026-06-01 ]                           │
└─────────────────────────────────────────────────────────────────────┘
┌─ Constraints (optional) ────────────────────────────────────────────┐
│  Geo, skill, role, credential, time window, capacity                │
│  (these are the same `requirements` we have today)                  │
└─────────────────────────────────────────────────────────────────────┘
                                                  [Save draft] [Express →]
```

The form's payload is the `payload` JSON column. When `Express →` lands:
1. Insert into `intents` (`status='expressed'`).
2. If `intentClass=RequestIntent`, also insert into `needs` (back-compat) and trigger `runDiscoverMatch`.
3. If `intentClass=OfferIntent`, also insert into `resource_offerings` and trigger reverse-discovery (find open intents this offering could match).
4. Insert the Outcome record from the success-criteria fields.
5. Fan out an inbox notification to every agent in `addressedTo`.

### 5.3 The Inbox / Outbox

Direct extensions of `MyWorkPanel`'s mode picker — each persona sees:

- **Inbox tab** — "Intents addressed to me, awaiting acknowledgment / response"
- **Outbox tab** — "Intents I expressed; status, fulfillment progress, outcome state"
- **Discover tab** (existing) — open intents in the hub I could volunteer for

### 5.4 Orchestration view

When an intent decomposes into multiple sub-intents (e.g. "host a joint Wellington+Loveland Easter outreach" → needs venue + needs prayer-cover + needs ESL volunteers + needs childcare):

- DAG visualization (parent → children with `dependsOn` edges)
- Per-sub-intent: status chip, assignee, work-items count, outcome chip
- "Add another step" action (extends the plan)
- "Mark plan complete" action (rolls up to parent intent)

The blueprint is JSON; the renderer is dumb. v0 ships a list view; v1 adds the DAG.

---

## 6. Discover redefined (again, but properly this time)

Today's flow:
> 1. Find active NeedOccurrences
> 2. Find ResourceOfferings with capabilities, role fit, geo fit, availability, trust evidence
> 3. Generate NeedResourceMatch records
> 4. Explain the match
> 5. Turn promising matches into WorkItems
> 6. Track FulfillmentActivities
> 7. Update the NeedOccurrence status

Tomorrow's flow:
> 1. Receive an **expressed Intent**
> 2. Decompose if needed (orchestration plan)
> 3. For each sub-intent, **find compatible counter-intents** (an Offer that satisfies this Request, an Information source that answers this Information intent, etc.)
> 4. Score, rank, explain
> 5. Generate **IntentMatch** records and route them to the addressed agents
> 6. As work items + activities accumulate, observe progress against the **Outcome metric**
> 7. When the metric is achieved, transition the parent intent to `fulfilled` and close the chain

The change is small in code (intent-class-aware scoring) but big in framing — the same engine handles **information requests** ("answer me"), **resource requests** ("help me"), **contribution offers** ("place me"), **collaboration proposals** ("partner with me") with the same machinery.

---

## 7. Phased build (the slice you actually ship)

| Phase | Deliverable | Effort |
|---|---|---|
| **I1** | Ontology — `intents.ttl` + `intent-types.ttl` + `intent-shapes.shacl.ttl` | 1 day |
| **I2** | DB schema — `intents`, `outcomes`, `orchestration_plans`, `beliefs` tables; `activityLogs.fulfillsIntentId` + `achievesOutcomeId` columns; migration | 1 day |
| **I3** | Backfill projection — every existing `needs` row gets a parent `intents` row; same for `resource_offerings`; bidirectional sync hook | 1 day |
| **I4** | Server actions — `expressIntent`, `acknowledgeIntent`, `withdrawIntent`, `findIntentMatches`, `composeOrchestrationPlan` | 1.5 days |
| **I5** | Express-an-Intent composer — `/h/catalyst/intents/new` route + form per class | 1 day |
| **I6** | Intent inbox + outbox routes — `/h/catalyst/inbox` + `/h/catalyst/outbox` + work-queue extensions | 1 day |
| **I7** | Intent-detail page — `/h/catalyst/intents/[id]` — replaces / supersedes `/needs/[id]` and `/offerings/[id]`; both legacy routes redirect to the unified detail | 1 day |
| **I8** | Outcome tracking — Outcome composer in the form, observation server action, automatic status transition when metric achieved | 1 day |
| **I9** | Orchestration plan view — `/h/catalyst/orchestrations/[id]` — list view (v0); DAG view (v1) | 1.5 days |
| **I10** | Catalyst home integration — "Open intents" strip replaces "Where the hub needs help" with class-typed pills (Request / Offer / Collab / Info / Contribute); inbox count surfaces in the global nav | 0.5 day |
| **I11** | Demo seed — 4 collaboration intents (Wellington+Loveland Easter, Front Range pastors gathering, Plains digital evangelism pilot, Denver Metro coffee-shop discipleship cohort), 3 information intents (NoCo UPG demographics, treasurer benchmarks, scripture-translation status), 2 well-project funding intents — across the catalyst persona graph | 0.5 day |
| **I12** | LLM intent parser — typing free-text "I need a Spanish-speaking grant writer in Loveland who can coach a new circle leader" → returns the structured intent envelope, ready to express. (This is Phase 6 of `discovery-ui-plan.md`, now *of* the intent layer instead of of generic search.) | 1.5 days |

Total: **~12 days** for the full upgrade. The smallest demoable slice is I1 + I2 + I3 + I5 + I7 + I10 ≈ **5 days** — enough to express an intent, see it on the home, and view the detail page.

---

## 8. The smallest-shippable slice (≈ 4–5 days)

The demoable moment: **a user signs in as Maria (Program Director), clicks "Express an intent" on the home, picks "I need to know something" (InformationIntent), types "Which UPGs in NoCo are most under-engaged?", addresses it to "the catalyst hub", and the discover engine surfaces 3 candidate agents who carry research/data offerings — even though none of them have offered an *answer* directly.**

That moment requires:

1. **I1** (subset) — `intents.ttl` + `intent-types.ttl`; defer SHACL shapes
2. **I2** — `intents` + `outcomes` tables + the activity-log column extension
3. **I3** (lightweight) — read-only projection; UI reads from `intents`, writes still hit `needs`/`resource_offerings` and the action shadows them into `intents`
4. **I5** (subset) — composer with the 5 intent classes but only RequestIntent/InformationIntent/ContributionIntent/OfferIntent live; CollaborationIntent stubs to "coming soon"
5. **I7** (subset) — intent detail page; hide the orchestration block (I9 ships that)
6. **I10** — home strip retitled "Open intents" with class pills

After this slice, the user has the unified verb live and can express any of the user's six example intents through one entry point.

---

## 9. Mission-org grounding (v0 demo seed targets)

Each persona's outbox should carry a couple of intents that map back to organizations we've used:

| Persona | direction | object | Title | Mission-org bridge |
|---|---|---|---|---|
| Maria   | receive | Data       | "Which NoCo UPGs are most under-engaged?" | **Joshua Project + IMB Frontier Strategy** |
| David   | give    | Worker     | "Wellington + Loveland Easter outreach — I'll lead joint planning" | **NewThing multi-circle coordination** *(plus a sibling give-intent from the Loveland circle leader on the same `topic`; the OrchestrationPlan converges them — no CollaborationIntent class needed)* |
| Sarah   | receive | Money      | "$4,800 for the Loveland well-water filter project" | **NCF restricted-grant pattern** |
| Rosa    | receive | Data       | "Trauma-care training pathways for ESL volunteers" | **GMCN trauma-informed care curriculum** |
| Carlos  | **give**    | Worker | "5 hrs/wk available — place me where useful" *(grammar says "need to contribute"; direction is give)* | **Indigitous handoff pattern** |
| Ana     | receive | Worker     | (existing Berthoud coach gap, now an Intent) | **Catalyst Leadership Network coach-of-coaches** |
| Sofia   | receive | Venue      | "Familia Morales: short-term housing during eviction" *(sensitive — visibility=private)* | **World Relief immigration legal-aid clinic + safeguarding pattern** |
| Luis    | receive | Scripture  | "Heart-language scripture status for indigenous-Mexican families in Loveland" | **Wycliffe + Progress.Bible** |
| Diego   | give    | Connector  | "Connector: high-school athletes + coaches + Spanish-speaking families" | **Athletes In Action** |

These give I11 demo content that exercises every intent class.

---

## 10. Open questions

1. **Drafted vs. Expressed** — should an intent be private when drafted? Yes, default. Visibility flips on expression. SHACL-checked.
2. **Sensitive intents** — `NeedSafePlace`, `NeedTraumaCare`, `NeedLegalAid` should default to `private` visibility and route to a credentialed-agent channel. Add a SHACL invariant.
3. **Acknowledgement vs. Acceptance** — an addressed agent can *acknowledge* receipt without committing. Two-step: `expressed → acknowledged → in-progress`. Acknowledgement is a notification with a button; acceptance produces a RoleAssignment.
4. **Multi-agent fulfillment** — when an Intent decomposes, do sub-intents share the parent's outcome metric, or does each sub-intent get its own? Lean to: each sub-intent has its own; parent's outcome is rolled up from children.
5. **InformationIntent fulfillment** — what's the activity that "answers" an Information intent? A new activity type `inform`? A linked Belief record? Lean to: an `Activity { type: 'inform', achievesOutcomeId }` with a payload of the answer text.
6. **Cross-hub intents** — addressed to "the global network" rather than just catalyst? v2.
7. **LLM intent parser** (I12) — same caveats as `discovery-ui-plan.md` Phase 6; rate-limit, structured output only, taxonomy-bounded.

---

## 11. Out of scope (defer)

- ZK-proof of intent authorship (cryptographic intent expression)
- On-chain `IntentRegistry` with stake / slashing
- Cross-chain intents
- Intent expiration via on-chain epoch (today: client-side `validUntil`)
- "Negotiate the terms" — counter-intent flow that lets the addressed agent propose alternative outcomes before accepting
- Multi-currency money intents (USD only for v0)
- Intent privacy via AnonCreds (intent-presentation without revealing identity)

---

## 12. Mermaid diagrams (mental model)

Park at `docs/ontology/diagrams/intent-bdi.md` once I1 lands. The most important three:

1. **BDI flow** — Belief informs Intent; Desire matures into Intent; Intent expects Outcome; Outcome achieved by Activity
2. **Intent class lattice** — Intent → Request / Offer / Collaboration / Information / Contribution; each subtype has a SKOS-leaf taxonomy beneath it
3. **End-to-end orchestration** — Maria expresses InformationIntent → Discover finds 3 data offerings → Maria accepts one → Activity logged with `fulfillsIntentId` + `achievesOutcomeId` → Outcome flips to `achieved` → Intent flips to `fulfilled`

---

## 13. Migration story (one-paragraph summary)

"`Need` and `Offering` are good. `Intent` is better. We're not throwing away the Need/Offering layer — we're putting it in a frame that makes a Belief, a Desire, a question, a contribution, an offer, and a request all *the same kind of thing* from the system's point of view: an Intent expressed by an agent, addressed to another agent or audience, expecting an outcome the system can observe. The catalyst home becomes the place where every catalyst persona's intents are visible; the inbox becomes their ask-list; the outbox becomes their commitment-list. Discover stops being 'find people' and becomes 'find intents that fit my expressed intent'."

That's the upgrade. Tell me to ship I1 + I2 + I3 + I5 + I7 + I10 (the 4–5 day slice) or to start with I1 + I2 in isolation (the foundation) and review before building the UI.
