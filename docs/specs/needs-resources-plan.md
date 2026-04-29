# Needs ↔ Resources — Catalyst Discovery Layer

> **Status**: design — ready for first-slice implementation review.
> **Companion to**: `agent-skills-plan.md` (skills are *one* kind of capability), `validation-feedback-plan.md` (matches are validatable artifacts), `discovery-ui-plan.md` (Discover surface that this plan re-defines), `catalyst-home-plan.md` (work-items integration), `demo-work-items.md` (per-silo coverage).
>
> **Premise**: Catalyst's **Discover** is not "find people". It is *gap-to-capacity matching*: find active **NeedOccurrences**, find **ResourceOfferings** with capability/role/geo/availability fit, generate **NeedResourceMatch** records, explain the fit, turn promising matches into **WorkItems**, record **FulfillmentActivities**, update need status.

---

## 1. What exists vs. what's missing

| Layer | Has today | Missing |
|---|---|---|
| Skills (1 kind of capability) | `AgentSkillRegistry`, `tbox/skills.ttl`, AnonCred SkillsCredential (v1) | The other resource kinds: **money, data, prayer, scripture-translated, missional workers, churches, orgs, funding, connectors** |
| Geo claims | `GeoClaimRegistry`, `tbox/geo.ttl` | Geo as a *requirement* on a need / *availability* on an offering |
| Relationships | `AgentRelationship` with 25+ types incl. `coaching-mentorship`, `alliance` | Role assignments as **situations** (Kenji-coaches-Rachel-in-this-pathway-during-this-window), not as global identities |
| Roles | 47 roles in `roles.ttl` | The split: `sah:ProgramRole` (DUL contextual) vs. `sah:ActivityRole` (PROV qualified-association) |
| Work queue | `MyWorkPanel` reads 8 sources, none of them are needs/matches | `WorkItem.triggeredBy: NeedResourceMatch` and `WorkItem.suggestsTask: …` — needs become work |
| Activities | `activityLogs` table | `Activity.fulfillsNeed: NeedOccurrence` link, `Activity.usesResource: ResourceOffering` link |
| Discover UI | None today on Catalyst home (audit dropped `AgentTrustSearch`) | The Discover surface — gap heat-map + match panel + explainability |

The structural gap: **everything Catalyst tracks today is a *fact* (you have a skill, a relationship, a circle, an activity); nothing models the *gap* or the *fit*.** Adding `NeedOccurrence` + `ResourceOffering` + `NeedResourceMatch` is the missing bridge.

---

## 2. Ontology — `docs/ontology/tbox/needs.ttl` + `resources.ttl` + `matches.ttl`

### 2.1 Class spine (PROV-O + DUL aligned)

```turtle
@prefix sah:  <https://smartagent.io/ontology/core#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix dul:  <http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

# Need side
sah:NeedType         a owl:Class ; rdfs:subClassOf skos:Concept .       # "needs coach", "needs treasurer", "needs prayer"
sah:Need             a owl:Class ; rdfs:subClassOf dul:Description, prov:Entity .
sah:NeedOccurrence   a owl:Class ; rdfs:subClassOf dul:Situation, prov:Entity .
sah:Requirement      a owl:Class ; rdfs:subClassOf dul:Description, prov:Entity .

# Resource side
sah:ResourceType     a owl:Class ; rdfs:subClassOf skos:Concept .
sah:Resource         a owl:Class ; rdfs:subClassOf prov:Entity .
sah:ResourceOffering a owl:Class ; rdfs:subClassOf dul:Situation, prov:Entity .
sah:Capability       a owl:Class ; rdfs:subClassOf prov:Entity .

# Bridge
sah:NeedResourceMatch a owl:Class ; rdfs:subClassOf dul:Situation, prov:Entity .

# Action
sah:DiscoverActivity     a owl:Class ; rdfs:subClassOf prov:Activity, dul:Action .
sah:FulfillmentActivity  a owl:Class ; rdfs:subClassOf prov:Activity, dul:Action .

# Role split
sah:ProgramRole   a owl:Class ; rdfs:subClassOf dul:Role .   # contextual: "Coach", "Treasurer", "Prayer Partner"
sah:ActivityRole  a owl:Class ; rdfs:subClassOf prov:Role .  # qualified: "Dispatcher during this intro"
sah:RoleAssignment a owl:Class ; rdfs:subClassOf dul:Situation .  # Kenji-as-Coach-for-Rachel-in-pathway-X-during-Y
```

### 2.2 Properties (the user's recommendation table, lifted intact)

```turtle
# Need side
sah:hasActiveNeed      rdfs:domain sah:Agent       ; rdfs:range sah:NeedOccurrence .
sah:neededBy           rdfs:domain sah:NeedOccurrence ; rdfs:range sah:Agent .
sah:needDescription    rdfs:domain sah:NeedOccurrence ; rdfs:range sah:Need .
sah:needType           rdfs:range  skos:Concept .
sah:needStatus         rdfs:range  skos:Concept .   # Open | InProgress | Met | Cancelled
sah:hasRequirement     rdfs:range  sah:Requirement .
sah:requiresRole       rdfs:range  sah:Role .
sah:requiresSkill      rdfs:range  sah:Skill .
sah:requiresGeo        rdfs:range  sah:GeoFeature .
sah:requiresAvailability rdfs:range sah:TimeWindow .
sah:requiresCapacity   rdfs:range  sah:Capacity .
sah:requiresCredential rdfs:range  sah:CredentialType .
sah:hasPriority        rdfs:range  skos:Concept .   # Critical | High | Normal | Low

# Resource side
sah:offersResource     rdfs:domain sah:Agent           ; rdfs:range sah:ResourceOffering .
sah:offeredBy          rdfs:domain sah:ResourceOffering ; rdfs:range sah:Agent .
sah:offeredResource    rdfs:domain sah:ResourceOffering ; rdfs:range sah:Resource .
sah:resourceType       rdfs:range  skos:Concept .
sah:availableInGeo     rdfs:domain sah:ResourceOffering ; rdfs:range sah:GeoFeature .
sah:availableDuring    rdfs:domain sah:ResourceOffering ; rdfs:range sah:TimeWindow .
sah:availableCapacity  rdfs:domain sah:ResourceOffering ; rdfs:range sah:Capacity .
sah:availabilityStatus rdfs:range  skos:Concept .       # Available | Reserved | Saturated | Paused
sah:hasCapability      rdfs:range  sah:Capability .
sah:capabilitySkill    rdfs:domain sah:Capability ; rdfs:range sah:Skill .
sah:capabilityRole     rdfs:domain sah:Capability ; rdfs:range sah:Role .
sah:capabilityEvidence rdfs:domain sah:Capability ; rdfs:range prov:Entity .
sah:capabilityLevel    rdfs:domain sah:Capability ; rdfs:range skos:Concept .

# Match
sah:matchesNeed         rdfs:domain sah:NeedResourceMatch ; rdfs:range sah:NeedOccurrence .
sah:matchedOffering     rdfs:domain sah:NeedResourceMatch ; rdfs:range sah:ResourceOffering .
sah:matchedResource     rdfs:domain sah:NeedResourceMatch ; rdfs:range sah:Resource .
sah:matchedAgent        rdfs:domain sah:NeedResourceMatch ; rdfs:range sah:Agent .
sah:satisfiesRequirement rdfs:range sah:Requirement .
sah:missesRequirement   rdfs:range  sah:Requirement .
sah:matchScore          rdfs:range  xsd:decimal .
sah:matchReason         rdfs:range  skos:Concept .       # SkillRoleGeoFit | TrustGraphProximity | …
sah:matchStatus         rdfs:range  skos:Concept .       # Proposed | Accepted | Rejected | Stale
sah:matchGeneratedBy    rdfs:range  sah:DiscoverActivity .

# Fulfillment
sah:fulfillsNeed       rdfs:domain sah:Activity       ; rdfs:range sah:NeedOccurrence .
sah:fulfilledBy        rdfs:domain sah:NeedOccurrence ; rdfs:range sah:Activity .
sah:usesResource       rdfs:range  sah:ResourceOffering .
sah:assignedTo         rdfs:range  sah:Agent .
sah:forWorkMode        rdfs:range  sah:WorkMode .
sah:triggeredBy        rdfs:range  sah:Entity .            # NeedOccurrence | Match | Event
sah:suggestsTask       rdfs:range  sah:Task .
sah:producedOutcome    rdfs:range  sah:Outcome .

# Role assignment (avoids global "Kenji a role:Coach")
sah:roleBearer    rdfs:range sah:Agent .
sah:rolePlayed    rdfs:range sah:Role .
sah:roleContext   rdfs:range prov:Entity .   # Pathway, Group, Hub
sah:roleTarget    rdfs:range sah:Agent .
sah:roleStatus    rdfs:range skos:Concept .  # Active | Lapsed | Ended
```

### 2.3 ResourceType controlled vocabulary (`cbox/resource-types.ttl`)

The user's list of resource kinds, captured as SKOS concepts so the `Resource.type` is shareable across hubs:

| Concept | skos:prefLabel | Notes |
|---|---|---|
| `resourceType:Skill`        | "Skill"                    | Already modeled as `sah:Skill` — bridge |
| `resourceType:Money`        | "Funding"                  | Restricted gift, grant, micro-finance |
| `resourceType:Data`         | "Data / Knowledge"         | Datasets, research, GraphDB content |
| `resourceType:Prayer`       | "Prayer / Intercession"    | Already modeled as `sah:PrayerCommitment` — bridge |
| `resourceType:Worker`       | "Missional Worker"         | A person available to deploy / coach / serve |
| `resourceType:Scripture`    | "Scripture / Translation"  | Wycliffe, Progress.Bible bridge |
| `resourceType:Church`       | "Church / Gathering"       | Local body, multiplication parent |
| `resourceType:Organization` | "Partnering Organization"  | Org capability, alliance role |
| `resourceType:Connector`    | "Connector / Introducer"   | Someone whose value is the introduction itself |
| `resourceType:Venue`        | "Place / Venue"            | Physical hosting capacity |
| `resourceType:Curriculum`   | "Curriculum / Content"     | BibleProject videos, T4T workbooks |
| `resourceType:Credential`   | "Credential / Attestation" | ECFA, ordination, leadership cert |

Each gets a `skos:broader` link so `resourceType:Money` ⊂ `resourceType:Material`, and `resourceType:Worker` ⊂ `resourceType:Human`. SHACL shapes (in `cbox/needs-shapes.shacl.ttl`) enforce: every `ResourceOffering` must carry exactly one `resourceType`; every `NeedOccurrence` must carry exactly one `needType`.

---

## 3. Information Architecture

### 3.1 Storage tier per artifact

| Artifact | Storage | Rationale |
|---|---|---|
| `NeedType` / `ResourceType` | T-Box (RDF) — published once | Shared vocabulary, slow-changing |
| `Need` (description, requirements) | DB (`needs` table) | Slow-changing, per-template |
| `NeedOccurrence` | **DB primarily, on-chain optionally** | High volume; on-chain only for high-value (e.g. funding need) where verifiability matters |
| `Resource` | DB (`resources` table) | Slow-changing |
| `ResourceOffering` | **DB primarily, on-chain optionally** | High volume; on-chain when the offering is itself a public claim (skill claim, geo claim) |
| `Capability` | Already on-chain via `AgentSkillRegistry` | Reuse — no new contract |
| `NeedResourceMatch` | DB (with PROV chain pointing to inputs) | Computed; cached; explainable |
| `RoleAssignment` | DB | Time-bound; mutates often; not financial |
| `DiscoverActivity` / `FulfillmentActivity` | DB (`activityLogs` extended) | Already there; add `fulfillsNeedId`, `usesOfferingId` columns |
| `WorkItem` | Derived (no separate table) — work-queue aggregator | Already correct; just add a new source for "match → work item" |

### 3.2 New DB tables (Drizzle schema)

```ts
// needs — the *occurrence* (not the type definition)
export const needs = sqliteTable('needs', {
  id: text('id').primaryKey(),
  needType: text('need_type').notNull(),               // SKOS concept: "circle-coach-needed"
  needTypeLabel: text('need_type_label').notNull(),    // human label for fast UI
  neededByAgent: text('needed_by_agent').notNull(),    // agent address (org/person/group)
  neededByUserId: text('needed_by_user_id'),           // optional DB user
  hubId: text('hub_id').notNull(),                     // 'catalyst' | 'cil' | 'global-church'
  title: text('title').notNull(),
  detail: text('detail'),
  priority: text('priority', { enum: ['critical','high','normal','low'] }).notNull().default('normal'),
  status: text('status', { enum: ['open','in-progress','met','cancelled','expired'] }).notNull().default('open'),
  // Requirements as JSON for v0; promote individual columns if perf demands.
  requirements: text('requirements'),                  // JSON: { role?, skill?, geo?, time?, capacity?, credential? }
  validUntil: text('valid_until'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// offerings — what an agent has put forward
export const resourceOfferings = sqliteTable('resource_offerings', {
  id: text('id').primaryKey(),
  offeredByAgent: text('offered_by_agent').notNull(),
  offeredByUserId: text('offered_by_user_id'),
  hubId: text('hub_id').notNull(),
  resourceType: text('resource_type').notNull(),       // SKOS concept
  resourceTypeLabel: text('resource_type_label').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  status: text('status', { enum: ['available','reserved','saturated','paused','withdrawn'] }).notNull().default('available'),
  capacity: text('capacity'),                          // JSON: hours/week, dollars, count
  geo: text('geo'),                                    // featureId or place label
  timeWindow: text('time_window'),                     // JSON: { start, end, recurrence }
  capabilities: text('capabilities'),                  // JSON: [{ skill, role, level, evidence }]
  validUntil: text('valid_until'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// matches — the bridge artifact, with explainability
export const needResourceMatches = sqliteTable('need_resource_matches', {
  id: text('id').primaryKey(),
  needId: text('need_id').notNull().references(() => needs.id),
  offeringId: text('offering_id').notNull().references(() => resourceOfferings.id),
  matchedAgent: text('matched_agent').notNull(),
  status: text('status', { enum: ['proposed','accepted','rejected','stale','fulfilled'] }).notNull().default('proposed'),
  score: integer('score').notNull(),                   // 0–10000 basis points
  reason: text('reason').notNull(),                    // SKOS concept: SkillRoleGeoFit | TrustProximity | …
  satisfies: text('satisfies'),                        // JSON: list of requirement IDs hit
  misses: text('misses'),                              // JSON: list of requirement IDs missed
  generatedByActivity: text('generated_by_activity'), // FK to activityLogs
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// role assignments — Kenji-as-Coach-for-Rachel
export const roleAssignments = sqliteTable('role_assignments', {
  id: text('id').primaryKey(),
  bearerAgent: text('bearer_agent').notNull(),
  rolePlayed: text('role_played').notNull(),           // role hash (matches AgentRelationship taxonomy)
  contextEntity: text('context_entity').notNull(),    // pathway / group / hub address
  targetAgent: text('target_agent'),                  // optional: the person they play this role *for*
  startsAt: text('starts_at'),
  endsAt: text('ends_at'),
  status: text('status', { enum: ['active','lapsed','ended'] }).notNull().default('active'),
})
```

### 3.3 Activity-log extension

Two columns on the existing `activityLogs` table — keeps PROV chain intact without a separate table:

```ts
fulfillsNeedId: text('fulfills_need_id'),
usesOfferingId: text('uses_offering_id'),
```

### 3.4 No new contracts in v0

The on-chain `AgentSkillRegistry` already handles the *capability* side of things, and `AgentRelationship` already records role-relationships. Needs/Offerings/Matches stay DB-only in v0; promote to on-chain in v1 only for resource types where verifiability matters (funding commitments, scripture-translation pledges).

---

## 4. Catalyst UI — Discover surface + work-item integration

### 4.1 New routes

| Route | Surface | Purpose |
|---|---|---|
| `/h/catalyst/discover` | The Discover panel | Heat-map of open needs, ranked match list, explainability |
| `/h/catalyst/needs` | Need-list view | All needs in the hub, filterable by type/priority/status |
| `/h/catalyst/needs/[id]` | Need detail | Single need with requirements, matches, fulfillment activities |
| `/h/catalyst/offerings` | Offering-list view | What you (and people you trust) have made available |
| `/h/catalyst/offerings/[id]` | Offering detail | Single offering with capabilities, current matches |
| `/h/catalyst/matches/[id]` | Match detail | Score breakdown, satisfies/misses, accept/reject CTA |

### 4.2 Catalyst home integration

Two new zones added to `CatalystFieldDashboard` (slotting into the existing layout):

- **Open Needs strip** (between NeedsAttentionCard and KPI row) — count of open needs in the hub, top 3 by priority, click-through to `/discover`. Renders only for Hub Lead / Program Director (govern mode).
- **Match work-items** — new source in the work-queue aggregator (`aggregator.ts`): `triggeredBy: NeedResourceMatch` where `matchedAgent === me && status === 'proposed'`. Shows up in `MyWorkPanel` as `"Possible match: <need title> · score <X>%"` with `Accept` / `Decline` actions.

### 4.3 NeedResourceMatch explainability

The match-detail surface answers four questions at a glance:

1. **Why does this fit?** — bullet list of `satisfies` requirements, each with the evidence pointer (skill claim, geo claim, role assignment, capability)
2. **What's missing?** — bullet list of `misses` requirements, color-coded by severity
3. **Who proposed it?** — `matchGeneratedBy` link (DiscoverActivity record); says either "Generated automatically" or "Proposed by Maria"
4. **What's the next step?** — Accept → mints a `RoleAssignment`, fires a `FulfillmentActivity`, emits a `relationship_proposed` message to the matched agent

### 4.4 Resource-type chooser (the critical UX piece)

When an agent publishes a new offering, the type chooser is the entry point. UI: 12 tiles for the resource types from §2.3, each opens a *different* form keyed to that type's required fields.

- **Skill** → re-uses existing `AddSkillClaimPanel`
- **Money** → amount + currency + restricted-to + valid-window + due-diligence-evidence
- **Prayer** → cadence + adoption-target + privacy
- **Worker** → role + availability + travel-radius + credentials
- **Connector** → who-do-you-know form: which orgs/sectors/regions you can bridge
- **Venue** → physical capacity + accessibility + recurring-availability
- (etc.)

This is the *first* place a user gets the "you carry capacity" framing. It also makes "I offer prayer" a first-class artifact alongside "I offer my coaching skill" — closing the dichotomy the architectural reference flagged.

---

## 5. Discover redefined

The user's most important framing — copy-pasted into the spec so we don't lose it:

> **Discover is not "find people". Discover is:**
>
> 1. Find active NeedOccurrences.
> 2. Find ResourceOfferings with capabilities, role fit, geo fit, availability, and trust evidence.
> 3. Generate NeedResourceMatch records.
> 4. Explain the match.
> 5. Turn promising matches into WorkItems.
> 6. Track FulfillmentActivities.
> 7. Update the NeedOccurrence status.

The match scorer (`packages/privacy-creds/src/match-overlap.ts`) lives next to the existing `org-overlap`, `geo-overlap`, `skill-overlap` scorers. Each requirement type has a contribution function:

| Requirement | Score contribution | Evidence source |
|---|---|---|
| `requiresRole` | 1.0 if role-assignment exists; 0.5 if compatible role; 0 else | `roleAssignments` + relationship taxonomy |
| `requiresSkill` | proficiency × confidence (0-10000 scaled) | `AgentSkillRegistry` claims |
| `requiresGeo` | 1.0 if geo-claim covers requirement; decays with distance | `GeoClaimRegistry` |
| `requiresCredential` | 1.0 if held + verified; 0.5 if claimed; 0 else | AnonCreds |
| `requiresAvailability` | overlap-fraction of offering window vs. need window | `ResourceOffering.timeWindow` |
| `requiresCapacity` | min(1.0, available / requested) | `ResourceOffering.capacity` |
| Trust adjustment | trust-graph proximity bonus | existing `org-overlap` + `geo-overlap` Stage-B′ |

Matches with `score < 4000` (= 40%) drop out of the default ranked list; matches with `score < 2000` are not surfaced at all.

---

## 6. Mermaid diagrams (live, copy from the user's prompt)

Park the 10 Mermaid diagrams the user supplied at `docs/ontology/diagrams/needs-resources.md` so they render in any Markdown viewer and stay synced with the T-Box updates. Diagrams 2 ("main need-resource pattern"), 5 ("Discover as need-resource matching"), and 10 ("concept map") are the most important; they go at the top of the file.

---

## 7. Phased build (the slice you actually ship)

| Phase | Deliverable | Files | Acceptance | Effort |
|---|---|---|---|---|
| **N1** | Ontology — `tbox/needs.ttl`, `tbox/resources.ttl`, `tbox/matches.ttl`, `cbox/resource-types.ttl`, `cbox/needs-shapes.shacl.ttl` | 5 new ontology files | SHACL validates a hand-crafted A-Box example; GraphDB sync emits the new triples | 1 day |
| **N2** | DB schema + Drizzle migration | `db/schema.ts` extension, new migration file | `pnpm typecheck` clean; tables created on `pnpm dev` boot | 0.5 day |
| **N3** | Server actions — `createNeed`, `createOffering`, `runDiscoverMatch`, `acceptMatch`, `rejectMatch` | `lib/actions/needs.action.ts` + `discover.action.ts` | Round-trip: create need → create offering → run match → see scored result | 1 day |
| **N4** | Discover surface — `/h/catalyst/discover` route + components | `app/h/[hubId]/(hub)/discover/page.tsx`, `components/discover/*.tsx` | Renders open needs, ranked matches, match-detail with explainability | 1 day |
| **N5** | Catalyst home integration — Open Needs strip + match work-items in `MyWorkPanel` | extend `HubDashboard.tsx` + `aggregator.ts` | Hub Lead sees "3 open needs" strip; Maria sees a "possible match" item in her work queue | 0.5 day |
| **N6** | Resource-type chooser + 12 type forms (start with Skill/Worker/Prayer/Connector — the catalyst-relevant 4) | `components/discover/OfferResourceDialog.tsx` | Agent publishes a "connector" offering and it lands in the database with the right type tag | 1 day |
| **N7** | Match scorer | `packages/privacy-creds/src/match-overlap.ts` | Scorer ranks Rachel above no-skill peers for the Wellington Circle coach need | 1 day |
| **N8** | Demo seed — needs + offerings for the Catalyst seed | extend `seed-multiply-data.ts` | Fresh start: every catalyst circle has 1–3 open needs; every persona has 1–3 offerings | 0.5 day |
| **N9** | PROV chain — wire `Activity.fulfillsNeed` + `usesOffering` columns | `db/schema.ts`, `aggregator.ts` | A logged activity that's tagged with a need closes the need's status transition | 0.5 day |

Total: ~7–8 days for the v0 slice. v1 (cross-hub federation, on-chain promotion of high-value needs/offerings, ZK match circuit) is deferred.

---

## 8. Smallest demoable slice (1–2 days)

The user has been asking for *visible* changes. The smallest slice that makes Need↔Resource real on the catalyst home:

1. **N1 (subset)** — only `tbox/needs.ttl` + `tbox/resources.ttl` + `cbox/resource-types.ttl`; defer matches.ttl + SHACL shapes
2. **N2** — three new tables: `needs`, `resource_offerings`, `need_resource_matches`
3. **N3 (subset)** — only `createNeed`, `createOffering`, `runDiscoverMatch` (the simplest scorer: role + skill + geo)
4. **N5** — Open Needs strip on the catalyst home + match work-items
5. **N8 (subset)** — seed 3–5 open needs in the catalyst hub:
   - `needType:CircleCoachNeeded` on Berthoud (overlap dispute resolved via a coach assignment)
   - `needType:Treasurer` on Fort Collins Hub
   - `needType:PrayerPartner` on every circle (low priority)
   - `needType:ConnectorToFunder` on the Network
   - `needType:HeartLanguageScripture` on Loveland (Wycliffe bridge)

That's 1–2 days, a dozen new files, and the user can sign in as Maria and see "5 open needs in the hub" with three of them having proposed matches.

---

## 9. Open questions

1. **Need privacy** — public by default, or hub-internal? Sensitive needs (legal aid, medical, addiction recovery) need privacy controls. Lean to default-public, with a `Visibility` enum mirroring the geo/skill pattern (`Public | PublicCoarse | PrivateCommitment | OffchainOnly`).
2. **Auto-match cadence** — when does the scorer run? Options: (a) on every offering/need change, (b) nightly batch, (c) on-demand from the Discover surface. Lean to (c) for v0; (a) when realtime UX is wanted.
3. **Acceptance side-effects** — when a match is accepted, does it auto-mint a `RoleAssignment`? Auto-fire a `FulfillmentActivity`? Auto-revoke other proposed matches for the same need? Lean to: yes to RoleAssignment, no to FulfillmentActivity (humans log that), no to auto-revoke (same need can attract multiple offerings).
4. **Cross-hub matches** — Catalyst needs a coach, Mission Collective has one available. Federation across hubs is a v2 concern; v0 stays single-hub.
5. **Resource-type extensibility** — when a hub-specific type is needed (e.g. "ESL teacher" in catalyst), do we extend the SKOS scheme or use a hub-local subtype? Lean to subtypes via `skos:broader resourceType:Worker`.

---

## 10. Out of scope (defer)

- ZK match circuit (private requirement matching against private offerings)
- On-chain `NeedRegistry` / `OfferingRegistry` (DB-only for v0)
- Cross-hub federation
- Full DUL/PROV alignment ABox tooling — N1 ships the T-Box, A-Box validation is later
- Multi-currency money offerings (USD only for v0)
- Calendar integration for `availableDuring` slots
- Match-quality feedback loops (accepted matches → scorer-weight learning)
