# Entitlement & Fulfillment Layer — Catalyst Marketplace → Outcome

> **Status**: design — ready for first-slice implementation review.
> **Companion to**: `intent-bdi-plan.md` (Intent + Match marketplace), `needs-resources-plan.md` (Need/Offering projection), `discovery-ui-plan.md` (Discover surface), `catalyst-home-plan.md` (home layout).
>
> **Premise**: today's flow ends at "match accepted." That's the *marketplace* — supply meets demand. Real value happens in the **fulfillment phase**: the coaching sessions, the funded grant disbursements, the prayer commitments, the introductions made. We need a first-class artifact that lives between *acceptance* and *outcome*: an **Entitlement**.

> **The two-phase model:**
>
> ```
> ┌─── Marketplace phase ──────────────┐    ┌─── Fulfillment phase ─────────────┐
> │  Intent expressed                   │    │  Entitlement (granted from match)  │
> │  Discovery finds matches            │    │  Fulfillment work items (both sides)│
> │  Match proposed                     │    │  Fulfillment activities (logged)    │
> │  Match accepted ────────────────────┼───▶│  Outcome metric advances            │
> │                                     │    │  Outcome achieved → Intent fulfilled│
> └─────────────────────────────────────┘    └─────────────────────────────────────┘
> ```

---

## 1. Why Entitlement is the missing piece

Today's chain stops one step short:

```
Intent  →  Match (proposed)  →  Match (accepted)  →  ???  →  Outcome
```

The "???" is where the actual work happens, but we have no first-class artifact for it. Today acceptance fires:
- A status flip on the match (`proposed` → `accepted`)
- A status flip on the need (`open` → `in-progress`)
- An optional `RoleAssignment` if the need had a role requirement
- A `relationship_proposed` message to the offerer

That's a notification, not a workflow. The *holder* of the accepted intent doesn't know what to do next; the *provider* doesn't have a structured place to log fulfillment activities; the outcome metric is decoupled from any single artifact.

**Entitlement** fills the gap. An Entitlement is:

> A granted right by Provider Agent to Holder Agent, carrying terms (what, how much, until when, under what cadence), tied to a specific accepted match, anchored to an outcome metric, and surfaced as a *fulfillment workspace* in both agents' UIs until the outcome is achieved or the entitlement is revoked.

It's the *workflow* layer above the *transaction* layer.

### Concrete catalyst example

> Sofia (Berthoud Circle) needs a coach. Maria offers regional coaching capacity. Match scored 93%. Sofia accepts.
>
> **Today**: status flips. Sofia gets a notification. Nothing else happens until someone manually books time.
>
> **With Entitlement**:
> - On accept, an Entitlement is granted: *"Maria's coaching capacity (15 hrs/wk), reserved for Sofia, weekly cadence, valid 6 months, outcome = G2 plant identified"*.
> - Both Sofia and Maria see a "Berthoud coaching engagement" workspace in their dashboards.
> - Auto-generated work items: *"Schedule first session"* (Maria), *"Share goals doc"* (Sofia), *"Weekly check-in"* (recurring, both).
> - Each coaching session is a `FulfillmentActivity` logged against the entitlement; capacity counter ticks down (15 hrs → 14 → 13).
> - The outcome metric ("G2 plant identified") is observed when an activity is tagged `achievesOutcome=true`.
> - When achieved, entitlement → fulfilled, intent → fulfilled, match → fulfilled. Audit chain closes cleanly.

---

## 2. Class shape — Entitlement is a Plan with terms

```
Marketplace (data we have today)              Fulfillment (new)
┌─────────────────────────────┐                ┌──────────────────────────┐
│ Intent                       │                │ Entitlement              │
│   direction, object, topic   │                │   sourceMatchId          │
│   expressedBy, addressedTo   │                │   holderAgent (receive)  │
│   intentType, status         │                │   providerAgent (give)   │
│   intentExpects → Outcome    │ ─acceptance──▶ │   terms (JSON)           │
└─────────────────────────────┘                │   capacityRemaining       │
                                                │   cadence (weekly, …)    │
┌─────────────────────────────┐                │   validUntil              │
│ IntentMatch                  │                │   linkedOutcomeId         │
│   matchesIntent (receive)    │                │   status                  │
│   matchedAgainst (give)      │                └──────┬───────────────────┘
│   score, satisfies, misses   │                       │
│   status: proposed | accepted│                       │ generates
└─────────────────────────────┘                        ▼
                                                ┌──────────────────────────┐
                                                │ FulfillmentWorkItem       │
                                                │   entitlementId           │
                                                │   assignee (holder|provider)│
                                                │   cadence (one-shot|recurring)│
                                                │   suggestedTask           │
                                                │   dueAt                   │
                                                └──────┬───────────────────┘
                                                       │ resolved by
                                                       ▼
                                                ┌──────────────────────────┐
                                                │ FulfillmentActivity       │
                                                │   = activityLogs row      │
                                                │     fulfillsEntitlementId │
                                                │     achievesOutcomeId     │
                                                └──────────────────────────┘
```

The big move: **work items + activities + outcomes are anchored to Entitlement, not to Intent directly.** An Intent can produce multiple Entitlements (one need, three coaches share the load). Each Entitlement has its own workspace, capacity, and lifecycle.

---

## 3. Ontology additions — `tbox/entitlements.ttl`

```turtle
@prefix saent:  <https://smartagent.io/ontology/entitlement#> .
@prefix saint:  <https://smartagent.io/ontology/intent#> .
@prefix samatch: <https://smartagent.io/ontology/match#> .
@prefix dul:    <http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#> .
@prefix prov:   <http://www.w3.org/ns/prov#> .

saent:Entitlement a owl:Class ;
    rdfs:subClassOf dul:Plan , prov:Plan ;
    rdfs:comment "A granted right by a Provider Agent to a Holder Agent, with terms (what, how much, until when, under what cadence), tied to a specific IntentMatch acceptance, anchored to an Outcome." .

saent:FulfillmentWorkItem a owl:Class ;
    rdfs:subClassOf dul:Plan ;
    rdfs:comment "A specific action assigned to one of the two parties to advance the entitlement. May be one-shot ('schedule first session') or recurring ('weekly check-in'). Generated by the system from entitlement terms; can also be added by either party." .

saent:FulfillmentActivity a owl:Class ;
    rdfs:subClassOf prov:Activity , dul:Action ;
    rdfs:comment "What actually happened — a logged activity (existing activityLogs row) tagged with an entitlement reference. Consumes capacity, may achieve an outcome metric." .

# Properties
saent:sourceMatch       rdfs:domain saent:Entitlement ; rdfs:range samatch:NeedResourceMatch .
saent:holderAgent       rdfs:domain saent:Entitlement ; rdfs:range sa:Agent .
saent:providerAgent     rdfs:domain saent:Entitlement ; rdfs:range sa:Agent .
saent:entitlementTerms  rdfs:domain saent:Entitlement ; rdfs:range xsd:string .   # JSON
saent:capacityGranted   rdfs:domain saent:Entitlement ; rdfs:range xsd:decimal .
saent:capacityRemaining rdfs:domain saent:Entitlement ; rdfs:range xsd:decimal .
saent:cadence           rdfs:domain saent:Entitlement ; rdfs:range skos:Concept . # one-shot|weekly|biweekly|monthly|on-demand
saent:linkedOutcome     rdfs:domain saent:Entitlement ; rdfs:range saint:Outcome .
saent:entitlementStatus rdfs:domain saent:Entitlement ; rdfs:range skos:Concept . # granted|active|paused|suspended|fulfilled|revoked|expired

saent:fulfillsEntitlement rdfs:domain prov:Activity ; rdfs:range saent:Entitlement .
saent:hasWorkItem        rdfs:domain saent:Entitlement ; rdfs:range saent:FulfillmentWorkItem .
saent:workItemAssignee   rdfs:domain saent:FulfillmentWorkItem ; rdfs:range sa:Agent .
saent:resolvedByActivity rdfs:domain saent:FulfillmentWorkItem ; rdfs:range prov:Activity .
```

`cbox/entitlement-statuses.ttl`, `cbox/cadences.ttl`, and `cbox/entitlement-shapes.shacl.ttl` for the controlled vocab + invariants:
- Every Entitlement must have `sourceMatch`, `holderAgent`, `providerAgent`, `entitlementStatus`.
- `capacityRemaining ≤ capacityGranted` always.
- An Entitlement with `entitlementStatus=fulfilled` must have at least one Activity with `achievesOutcome=true`.

---

## 4. Information architecture — DB schema

### 4.1 New tables

```ts
/**
 * Entitlement — granted right tied to an accepted match. Sits between
 * the marketplace (intent / match) and the activity log.
 */
export const entitlements = sqliteTable('entitlements', {
  id: text('id').primaryKey(),
  /** Soft FK back to need_resource_matches.id — the acceptance that granted this. */
  sourceMatchId: text('source_match_id').notNull(),
  /** The intent that's being fulfilled (receive-shaped). */
  holderIntentId: text('holder_intent_id').notNull(),
  /** The intent that's providing the resource (give-shaped). */
  providerIntentId: text('provider_intent_id').notNull(),
  holderAgent: text('holder_agent').notNull(),
  providerAgent: text('provider_agent').notNull(),
  hubId: text('hub_id').notNull(),
  /** What's entitled — JSON: { object, topic, role?, skill?, scope, geo? }. */
  terms: text('terms').notNull(),
  /** JSON: { unit, granted, remaining }. */
  capacity: text('capacity'),
  /** SKOS concept URI from cbox/cadences.ttl. */
  cadence: text('cadence', {
    enum: ['one-shot', 'weekly', 'biweekly', 'monthly', 'quarterly', 'on-demand'],
  }).notNull().default('weekly'),
  /** Cached pointer to the outcome row this entitlement targets. */
  linkedOutcomeId: text('linked_outcome_id'),
  status: text('status', {
    enum: ['granted', 'active', 'paused', 'suspended', 'fulfilled', 'revoked', 'expired'],
  }).notNull().default('granted'),
  validFrom: text('valid_from').notNull(),
  validUntil: text('valid_until'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

/**
 * FulfillmentWorkItem — a unit of action attached to an entitlement.
 * Either party can have items assigned; cadence drives recurrence.
 */
export const fulfillmentWorkItems = sqliteTable('fulfillment_work_items', {
  id: text('id').primaryKey(),
  entitlementId: text('entitlement_id').notNull().references(() => entitlements.id),
  /** Who needs to act. */
  assigneeAgent: text('assignee_agent').notNull(),
  /** SKOS: schedule-session | log-progress | confirm-receipt | provide-update | review | sign-off. */
  taskKind: text('task_kind').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  /** one-shot | recurring. */
  cadence: text('cadence', { enum: ['one-shot', 'recurring'] }).notNull().default('one-shot'),
  /** For recurring items, when the next instance is due. */
  dueAt: text('due_at'),
  /** Soft FK to activity_logs.id — when this item is resolved. */
  resolvedByActivityId: text('resolved_by_activity_id'),
  status: text('status', { enum: ['open', 'in-progress', 'done', 'skipped'] }).notNull().default('open'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})
```

### 4.2 `activityLogs` extension

```ts
fulfillsEntitlementId: text('fulfills_entitlement_id'),
// Already there: fulfillsNeedId, fulfillsIntentId, achievesOutcomeId.
// New column lives next to them; the activity action backfills both
// `fulfillsIntentId` and `fulfillsNeedId` from the entitlement's link
// when only `fulfillsEntitlementId` is supplied.
```

### 4.3 `roleAssignments` extension

```ts
sourceEntitlementId: text('source_entitlement_id'),
// When acceptMatch creates a RoleAssignment (already happens for
// role-bearing needs), tag it with the entitlement that granted it.
// Lets us walk: RoleAssignment → Entitlement → Match → Intent → Outcome.
```

---

## 5. Lifecycle — entitlement state machine

```
                ┌─ on accept ─┐
                │              │
intent(open) → match(proposed) → match(accepted) → entitlement(granted)
                                                       │
                                                       ▼ first activity logged
                                                  entitlement(active)
                                                       │
                                            ┌──────────┼──────────┐
                                            ▼          ▼          ▼
                                          paused    suspended    fulfilled
                                            │          │              │
                                       provider     dispute       outcome metric
                                       unavailable  filed          satisfied
                                            │          │              │
                                            └────┬─────┘              ▼
                                                 ▼               match(fulfilled)
                                            revoked|expired      intent(fulfilled)
                                                                     │
                                                                     ▼
                                                                  audit chain
                                                                  closes cleanly
```

Transitions:
- `granted → active` — first FulfillmentActivity logged (any cadence)
- `active → fulfilled` — Outcome.status flips to `achieved`
- `active → paused` — provider explicitly pauses; recurring work-items don't generate
- `active → suspended` — dispute filed; same effect, different reason
- `paused/suspended → active` — resume
- `* → revoked` — either party explicitly terminates early
- `* → expired` — `validUntil` reached without fulfillment

When an entitlement reaches `fulfilled`, the system also flips:
- The `holderIntentId` row's status → `fulfilled`
- The `sourceMatchId` row's status → `fulfilled`
- The provider's `providerIntentId` capacity is released back into the offering

---

## 6. Catalyst UI — the fulfillment workspace

### 6.1 New routes

| Route | Purpose |
|---|---|
| `/h/catalyst/entitlements` | Index — Active / Granted / Paused / Fulfilled / Revoked, filter by holder/provider |
| `/h/catalyst/entitlements/[id]` | The fulfillment workspace — terms, work items, activities, outcome, status |
| `/h/catalyst/fulfillment` | "What needs my attention right now" — collapsed view across all my entitlements |

### 6.2 Entitlement-detail surface (the workspace)

Five panels stacked:

1. **Header** — direction badge (holder/provider), counterpart agent name, terms chip ("15 hrs/wk · Coach role · Berthoud · 6 months"), status chip with state-machine button (Pause / Resume / Mark fulfilled / Revoke)
2. **Outcome card** — *what success looks like*, current observed value, target, status
3. **Work items board** — open work items (one-shot + next instances of recurring), grouped by who-needs-to-act. Each row: due date, task kind icon, "log activity" CTA pre-filled with the entitlement
4. **Activity feed** — every activity logged against this entitlement, in reverse-chronological order, with capacity-consumed indicator
5. **Audit trail** — collapsed by default — the PROV chain back to match → intent → outcome

### 6.3 Catalyst home integration

A new strip — **"Active fulfillments"** — sits between the work zone and the field zone:

```
Active fulfillments
3 entitlements, 2 needing your action
┌─────────────────────────────────────────────────────────────────────┐
│ 🤝 Coaching Sofia (Berthoud) · 12/15 hrs remaining · next session   │
│    due Thursday                              [Log session →]        │
├─────────────────────────────────────────────────────────────────────┤
│ 💰 Receiving $4,800 well-water grant · disburse-tranche 2 of 3      │
│    pending NCF · provide receipts                  [Provide →]      │
├─────────────────────────────────────────────────────────────────────┤
│ 🙏 Praying for Wellington families · weekly cadence · last Mon      │
│                                                  [Pray now →]      │
└─────────────────────────────────────────────────────────────────────┘
```

Each row: emoji-coded by resource-type, brief terms, the **next work item due** with one-click action button. Visually different from "Open intents" (marketplace strip) and "On your plate" (personal triage strip) — the third primary band on the catalyst home.

### 6.4 New work-queue source

`MyWorkPanel` gets a new source — `entitlement-work-item` — that surfaces FulfillmentWorkItems where I'm the assignee and status is `open` or `in-progress`. Mode mapping: maps to `discover` mode (since fulfillment is the post-discovery phase).

### 6.5 Updated `acceptMatch` action

Today's `acceptMatch`:
1. Promote match status `proposed → accepted`
2. Move need `open → in-progress`
3. Mint RoleAssignment if role-required
4. Send `relationship_proposed` message

Tomorrow's `acceptMatch`:
1. (Steps 1–4 unchanged, plus:)
2. **Mint Entitlement** with terms derived from `match.satisfies` + the offering's payload
3. **Auto-generate initial FulfillmentWorkItems** based on cadence:
   - One-shot: `"Schedule first session"` (provider) + `"Confirm goals"` (holder)
   - Recurring: first instance of the recurring item, due in 7 days
4. **Tag any RoleAssignment** with `sourceEntitlementId`
5. Send notifications to both parties about the entitlement (not just the match)

### 6.6 Updated `logActivity` action

Today: `fulfillsNeedId` ⟹ counts toward fulfillment threshold.

Tomorrow: `fulfillsEntitlementId` ⟹
1. Decrement `entitlement.capacity.remaining`
2. Resolve any matching open `fulfillmentWorkItem` (assignee + same kind)
3. If activity is tagged `achievesOutcome=true`, flip the linked Outcome
4. Cascade: outcome achieved → entitlement fulfilled → match fulfilled → holder intent fulfilled

The legacy `fulfillsNeedId` path stays — it just becomes a slower way to reach the same end-state.

---

## 7. Mission-org grounding — the catalyst examples

| Persona | Intent | Match → Entitlement | Fulfillment work items | Outcome | Bridges |
|---|---|---|---|---|---|
| Sofia (Berthoud) | NeedCoaching | Maria's Worker offering | "Schedule first session" (Maria), "Share goals doc" (Sofia), "Weekly check-in" (both, recurring) | G2 plant identified | **Catalyst Leadership Network** coach-of-coaches; **NewThing** multiplication chain |
| Sarah (Network) | NeedFunding $4,800 | NCF restricted-grant offering | "Provide due-diligence packet" (Sarah), "Sign disbursement memo" (NCF), "Submit tranche-1 receipts" (Sarah, recurring quarterly) | Well-water filter installed; usage report submitted | **NCF** restricted-grant pattern; **ECFA** compliance |
| Maria (Network) | NeedInformation "NoCo UPGs" | OfferInformation from a research provider | "Send research links" (provider), "Confirm receipt + acknowledge usefulness" (Maria) | Maria's prioritization list updated | **Joshua Project + IMB Frontier Strategy** |
| Carlos (community partner) | WantToContribute (5 hrs/wk) | Match → an open NeedHelp at Wellington | "First volunteer shift" (Carlos), "Confirm fit" (Wellington) | Sustained partnership for ≥ 4 weeks | **Indigitous handoff pattern** |
| Ana (Wellington) | NeedTraumaCare for Familia Morales | Rosa's GMCN-trained offering | "Initial assessment" (Rosa), "Care plan handoff" (Ana → Rosa), "Weekly check-in" (recurring) | Familia Morales reports stable footing | **GMCN** trauma-informed care |

These give the demo seed natural narratives that span all five intent types.

---

## 8. Phased build

| Phase | Deliverable | Effort |
|---|---|---|
| **E1** | Ontology — `entitlements.ttl` + `entitlement-statuses.ttl` + `cadences.ttl` + SHACL shapes | 0.5 day |
| **E2** | DB schema — `entitlements`, `fulfillment_work_items` tables; activityLogs.fulfillsEntitlementId; roleAssignments.sourceEntitlementId; migration | 0.5 day |
| **E3** | Server actions — `mintEntitlement`, `listEntitlements`, `getEntitlement`, `pauseEntitlement`, `resumeEntitlement`, `revokeEntitlement`, `markEntitlementFulfilled` | 1 day |
| **E4** | `acceptMatch` upgrade — auto-mints Entitlement + initial FulfillmentWorkItems; tags RoleAssignment | 0.5 day |
| **E5** | `logActivity` upgrade — fulfillsEntitlementId, capacity decrement, work-item auto-resolve, outcome cascade | 1 day |
| **E6** | Entitlement detail page — `/h/catalyst/entitlements/[id]` with the 5 panels | 1.5 days |
| **E7** | Entitlement index — `/h/catalyst/entitlements` (status filter pills, mine/all toggle) | 0.5 day |
| **E8** | Catalyst home strip — "Active fulfillments" between work and field zones; one-click "Log session" CTA per row | 0.5 day |
| **E9** | Work-queue source — `entitlement-work-item` kind; `MyWorkPanel` surfaces fulfillment items in `discover` mode | 0.5 day |
| **E10** | Demo seed — convert the 4 currently-accepted matches in catalyst into accepted matches with active entitlements + 2–3 fulfillment activities each (so the demo lands with fulfillment in flight) | 0.5 day |
| **E11** | Recurring work-item generator — daily cron (or polling check on render) that emits the next instance of recurring items as their previous instance is resolved | 1 day |
| **E12** | Cascade tests — accept → entitlement granted → activity → outcome achieved → entitlement fulfilled → intent fulfilled (e2e Playwright covering the chain) | 1 day |

Total: **~9 days** for the full upgrade. Smallest demoable slice is E1 + E2 + E3 + E4 + E5 + E6 + E8 ≈ **5 days**.

---

## 9. Smallest demoable slice (≈ 5 days)

The demoable moment: **Sofia accepts Maria's coaching match → an entitlement workspace appears → Maria logs a session against it → the capacity counter ticks down → after 3 sessions the outcome flips to achieved → entitlement fulfilled → Berthoud's coach-needed intent fulfilled.**

Required:
1. **E1** (subset) — only `entitlements.ttl`; defer SHACL shapes
2. **E2** — full schema + migration
3. **E3** (subset) — only `mintEntitlement`, `listEntitlements`, `getEntitlement`, `markEntitlementFulfilled`. Pause/resume/revoke deferred.
4. **E4** — `acceptMatch` mints the entitlement + 1 initial work item per side
5. **E5** — `logActivity` accepts `fulfillsEntitlementId`; decrements capacity; cascades to outcome on threshold (re-using the per-need-type thresholds we already shipped)
6. **E6** — workspace page with terms, single work-item list, activity feed, and "Log session" CTA. Audit trail panel deferred.
7. **E8** — home strip with up to 3 entitlements, one-click action

After this slice, the catalyst home has all three primary bands: **personal triage** (on your plate), **marketplace** (open intents), **fulfillment** (active entitlements). The PROV chain closes end-to-end.

---

## 10. Open questions

1. **Whose work item is whose?** — when a coaching session happens, BOTH parties did something (one taught, one received). Do we generate one work-item per side or one shared item? Lean to one shared item that *either* party can resolve — fewer notifications, simpler UI. SHACL still requires `assigneeAgent` (set to the *primary* actor).
2. **Capacity unit per resource type** — coaching = hours/week; funding = dollars; prayer = weekly slots; venue = bookings; information = a single yes/no transfer. Per-type capacity unit defaults need a config table, not hard-coded.
3. **Multiple entitlements per intent** — a need for a coach might be met by Maria + Sarah jointly (sharing the load). The intent has one `holderIntentId`; multiple entitlements reference it. SHACL: an intent reaches `fulfilled` when *any* of its accepted entitlements does — or when *all* do? Lean to "any" because outcome metric is single-source.
4. **Outcome with multiple entitlements** — same: outcome metric tracks the parent intent. Each entitlement can claim partial credit. Score model: each FulfillmentActivity contributes a weight to the outcome metric; metric advances by weighted sum.
5. **Provider-side outcome tracking** — does the provider also see the outcome state? Yes — the workspace is shared. Both parties see *"3/5 sessions completed; 1 G2 candidate identified"*.
6. **Recurring work-item drift** — if a weekly check-in is missed, does the next one still fire on schedule, or does it slip? Lean to "fires on schedule, accumulates a missed-cadence flag" — gives the dashboard a signal to escalate.
7. **Suspension vs. revocation** — distinct UX or same? Lean to same primitive (status enum), different UI labels and triggers.
8. **Trust impact of revoked entitlements** — does early revocation hurt the provider's trust score? Should — but how much? Defer scoring impact to v2.

---

## 11. Out of scope (defer)

- Cross-hub entitlements (Catalyst holder, CIL provider) — v2
- On-chain `EntitlementRegistry` with stake/slashing — v2; v0 is DB-only
- Multi-currency funding entitlements (USD only)
- Calendar integration for cadence-driven sessions
- Entitlement marketplace (transfer / re-assign an entitlement to a third agent)
- AI-driven work-item suggestions ("you should probably schedule a check-in" without an explicit cadence) — phase-6-style ML
- Smart contract escrow for funding entitlements

---

## 12. The unified mental model (the one-paragraph summary)

> An Intent expresses a desire, addressed to someone, expecting an outcome. A Match converges two compatible intents. An Entitlement is what a holder *gets* when a match is accepted — a granted right with terms, capacity, and a cadence, anchored to the same outcome the intent expected. A FulfillmentWorkItem is a specific action the entitlement asks of one party. A FulfillmentActivity is the action actually taken — it consumes capacity, may resolve a work item, may achieve an outcome. When the outcome metric is achieved, the chain unwinds: entitlement → fulfilled, match → fulfilled, intent → fulfilled. **The system is no longer just a marketplace; it's a workflow.**

That's the upgrade. Tell me to ship the 5-day slice (E1+E2+E3+E4+E5+E6+E8) or to hold for review of the 12-section plan first. Or redirect — drop recurring cadences for v0, ship without the home-strip panel, etc.
