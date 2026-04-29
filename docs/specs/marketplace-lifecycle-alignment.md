# Marketplace-Lifecycle Alignment — UFO-C + ValueFlows + PROV + ODRL

> **Status**: design + corrective alignment. Two-line summary at the top so future readers don't repeat the mistake:
>
> 1. **Intent is not a Plan.** Intent is the agent's committed orientation toward a goal or a desired economic flow. Plan is the *how*-layer chosen later to fulfill it.
> 2. **`Entitlement` was conflating three different things.** ExchangeAgreement (the contract) ≠ ClaimRight (the right/permission held by a party) ≠ FulfillmentCase (the operational container that work proceeds against). Keep them separate or you re-encode bugs.
>
> **Companion to**: `intent-bdi-plan.md` (Intent layer — gets re-aligned), `entitlement-fulfillment-plan.md` (Entitlement layer — gets re-named and split), `needs-resources-plan.md` (Need/Offering projection), `discovery-ui-plan.md`, `catalyst-home-plan.md`.

---

## 1. The corrected stack (top to bottom)

```
Cognitive layer (UFO-C)
  Desire        — motivational state toward a possible future condition
  Intention     — internal commitment to pursue a goal     ← the marketplace "Intent" is HERE
  Goal          — propositional content of the intention

Marketplace layer (ValueFlows)
  RequirementIntent ⊂ vf:Intent  — receive-shaped: "I seek X"
  ProvisionIntent   ⊂ vf:Intent  — give-shaped:    "I can provide X"
  MarketplaceProposal ⊂ vf:Proposal — public posting; carries one or more intents
  IntentMatch                     — local class; non-binding compatibility pairing

Contractual layer (UFO-C SocialRelator + VF Agreement; ODRL where it's a usage permission)
  ExchangeAgreement ⊂ vf:Agreement, ⩭ ufo:SocialRelator
       — the accepted reciprocal contract
  FulfillmentCommitment ⊂ vf:Commitment, ⩭ ufo:SocialCommitment
       — promised future flow created by an Agreement
  ClaimRight ⊂ vf:Claim, ⩭ ufo:SocialClaim
       — the entitlement; the normative right held by a party
  UsageAuthorization ⊂ odrl:Permission
       — when the right is really a permission policy over an asset

Operational layer (Plan + Case)
  FulfillmentCase     — operational container coordinating work to outcome
  FulfillmentPlan ⊂ vf:Plan, ⊂ prov:Plan — structured steps + processes
  WorkItem            — task/ticket/queue; not the activity itself

Execution layer (PROV-O + VF EconomicEvent)
  FulfillmentActivity ⊂ prov:Activity — what was done
  EconomicEvent       ⊂ FulfillmentActivity, ⊂ vf:EconomicEvent
       — observed flow / transfer / production / use / contribution
  Outcome             ⊂ prov:Entity (or ufo:Situation) — achieved state
  OutcomeEvidence     ⊂ prov:Entity — receipts, attestations, artifacts
```

**Reading the diagram**: each row is a different *kind* of thing. The mistake to avoid is sliding two rows together — it's tempting to treat "the Entitlement" as one record carrying terms + permissions + work, but that's three records bound by FK relationships, not one fat row.

---

## 2. Where today's code lands

Mapping what's already shipped to the corrected vocabulary:

| Today's name (DB / code) | Corrected ontology class | Ship plan |
|---|---|---|
| `intents` table; `Intent` class | `hub:Intention` (with subtypes `RequirementIntent` / `ProvisionIntent` discriminated by `direction` column) | Re-anchor T-Box: drop `subClassOf prov:Plan, dul:Plan`; replace with `subClassOf ufo:Intention`, `skos:closeMatch vf:Intent`. **DB stays.** |
| `need_resource_matches` table | `hub:IntentMatch` | Already correct; just add the proper external alignment in the T-Box. |
| `needs` / `resource_offerings` legacy tables | Projections of `hub:Intention` | Already projected via `intents.projection_ref`. No change. |
| `entitlements` table — current single class | **Conflates three things**: `ExchangeAgreement` + primary `ClaimRight` + `FulfillmentCase` | v0: keep the single physical table but **document the conceptual projection**. Add separate ontology classes; treat the row as a denormalized projection of the three. v1: split when a single Agreement legitimately needs >1 ClaimRight or >1 Case. |
| `fulfillment_work_items` table | `hub:WorkItem` | Already correct; no rename. |
| `activity_logs` rows tagged with `fulfills_entitlement_id` | `hub:FulfillmentActivity` (and `hub:EconomicEvent` for the resource-flow ones) | T-Box subclass; column stays. |
| `outcomes` table | `hub:Outcome` | Already correct. |
| (missing) | `hub:OutcomeEvidence` | New table; ships in v1. |
| (missing) | `hub:FulfillmentCommitment` | Implicit today inside `entitlements.terms` payload. v1 promotes to its own table when an agreement has multiple primary + reciprocal commitments. |

The key principle: **DB schema stays for v0; the T-Box is the layer that gets rewritten and aligned.** The catalyst home, entitlement workspace, and PROV chain we just shipped continue to work — they're now formally a *projection* of the corrected model, not an alternative model.

---

## 3. UI / user-facing renames

| Today's user-facing label | Corrected user-facing label | Notes |
|---|---|---|
| "Entitlement" / "Entitlements" | **"Engagement"** / "Engagements" | Warmer than "Entitlement". Captures the relational nature of an active commitment. The technical word `ClaimRight` stays in the T-Box; users see "Engagement". |
| "Active fulfillments" (home strip) | "Active engagements" | Same change, propagated to the strip title. |
| "Entitlement workspace" (detail page) | "Engagement workspace" | Same. |
| `/h/catalyst/entitlements` | URL stays (no breaking change); page title and copy update. | Routes are infra; user only sees the heading. |
| "Mint Entitlement" (action) | "Open Engagement" (UI verb) | The action's function name (`mintEntitlement`) stays internal. |

The routes (`/entitlements`, `/entitlements/[id]`) **stay the same** so existing links don't break. Only the rendered words change.

---

## 4. What changes in the ontology (concretely)

### 4.1 Update `tbox/intents.ttl`

```turtle
# Remove this:
saint:Intent rdfs:subClassOf dul:Plan , prov:Plan .

# Replace with:
saint:Intent rdfs:subClassOf ufo:Intention ;
    skos:closeMatch vf:Intent ;
    skos:relatedMatch prov:Plan ;
    rdfs:comment "An agent's internal commitment to pursue a goal or to a desired economic flow. NOT the plan that fulfills it — that is hub:FulfillmentPlan." .
```

Add Desire, Goal as siblings (light wrappers, not always materialized):

```turtle
saint:Desire a owl:Class ; rdfs:subClassOf ufo:Desire .
saint:Goal   a owl:Class ; rdfs:subClassOf ufo:Goal .
```

Add the receive/give intent subtypes as proper `vf:Intent` subclasses:

```turtle
saint:RequirementIntent
    rdfs:subClassOf saint:Intent , vf:Intent ;
    rdfs:comment "Intent expressing that an agent seeks a resource, capability, or state. (direction = receive)" .

saint:ProvisionIntent
    rdfs:subClassOf saint:Intent , vf:Intent ;
    rdfs:comment "Intent expressing that an agent can provide a resource, capability, or state. (direction = give)" .
```

The `direction` field stays as the structural axis the matcher reads; the new subclasses give T-Box queries a clean URI to filter on.

### 4.2 New `tbox/marketplace-lifecycle.ttl`

The five ontology classes that today get smushed into `entitlements`:

```turtle
hub:ExchangeAgreement
    rdfs:subClassOf vf:Agreement ;
    skos:closeMatch ufo:SocialRelator ;
    rdfs:comment "Accepted reciprocal contract created from a matched RequirementIntent + ProvisionIntent pair." .

hub:FulfillmentCommitment
    rdfs:subClassOf vf:Commitment ;
    skos:closeMatch ufo:SocialCommitment ;
    rdfs:comment "Planned/promised future economic flow stipulated by an ExchangeAgreement." .

hub:ClaimRight
    rdfs:subClassOf vf:Claim ;
    skos:closeMatch ufo:SocialClaim ;
    rdfs:comment "Right held by a party against another, created by an ExchangeAgreement and settled by EconomicEvents. Replaces the old user-facing word 'Entitlement'." .

hub:UsageAuthorization
    rdfs:subClassOf odrl:Permission ;
    rdfs:comment "When the right is a permission policy over an asset rather than a delivery claim — e.g. authorization to use a venue, invoke an AI agent, access a credential." .

hub:FulfillmentCase
    rdfs:comment "Operational container for an active engagement — coordinates plans, work items, activities, evidence, outcomes." .

hub:FulfillmentPlan
    rdfs:subClassOf prov:Plan , vf:Plan ;
    rdfs:comment "Structured body of scheduled work used to realize an Agreement." .

hub:EconomicEvent
    rdfs:subClassOf hub:FulfillmentActivity , vf:EconomicEvent ;
    rdfs:comment "Observed economic flow — transfer, production, use, contribution. The subset of FulfillmentActivity that affects a resource." .

hub:OutcomeEvidence
    rdfs:subClassOf prov:Entity ;
    rdfs:comment "Receipts, logs, attestations, artifacts that support or measure outcome achievement." .
```

### 4.3 Update `tbox/entitlements.ttl`

Re-anchor the existing class with the corrected alignment:

```turtle
saent:Entitlement a owl:Class ;
    rdfs:subClassOf hub:ExchangeAgreement ;
    skos:closeMatch hub:FulfillmentCase ;
    rdfs:comment "v0 conflation: this single class projects an ExchangeAgreement, its primary ClaimRight, and its FulfillmentCase as one record. v1 will split. Treat new uses of 'Entitlement' as deprecated — prefer the corrected vocabulary." .
```

### 4.4 New properties (cross-layer)

```turtle
hub:satisfiesIntent     rdfs:subPropertyOf vf:satisfies .
                        # FulfillmentActivity / EconomicEvent → Intention

hub:fulfillsCommitment  rdfs:subPropertyOf vf:fulfills .
                        # EconomicEvent → FulfillmentCommitment

hub:settlesClaimRight   rdfs:subPropertyOf vf:settles .
                        # EconomicEvent → ClaimRight

hub:stipulatesCommitment   rdfs:subPropertyOf vf:stipulates .
                        # ExchangeAgreement → FulfillmentCommitment

hub:createsClaimRight  rdfs:domain hub:ExchangeAgreement ; rdfs:range hub:ClaimRight .
hub:governsCase        rdfs:domain hub:ExchangeAgreement ; rdfs:range hub:FulfillmentCase .
hub:authorizesActivity rdfs:domain hub:ClaimRight ; rdfs:range hub:FulfillmentActivity .
hub:hasPlan            rdfs:domain hub:FulfillmentCase ; rdfs:range hub:FulfillmentPlan .
hub:performedActivity  rdfs:domain hub:FulfillmentCase ; rdfs:range hub:FulfillmentActivity .
hub:producesOutcome    rdfs:domain hub:FulfillmentActivity ; rdfs:range hub:Outcome .
hub:evidencedBy        rdfs:domain hub:Outcome ; rdfs:range hub:OutcomeEvidence .
```

The two ValueFlows verbs that get the most use are `satisfies` (Activity → Intent), `fulfills` (Activity → Commitment), `settles` (Activity → ClaimRight). The PROV chain we already log via `activity_logs.fulfills_entitlement_id` becomes the *projection* of all three under the v0 conflation.

---

## 5. Phased migration

| Phase | Deliverable | Scope | Effort |
|---|---|---|---|
| **A1** | Write `tbox/marketplace-lifecycle.ttl` + update `intents.ttl` + update `entitlements.ttl` to reflect the corrected alignment | Ontology only — no code or DB change | 1 hr |
| **A2** | Update UI labels: "Entitlement" → "Engagement", "Active fulfillments" → "Active engagements" — across the home strip, the index page, the detail page | Pure copy change; routes stable | 30 min |
| **A3** | Add `OutcomeEvidence` table + columns: `activityLogs.evidenceUri`, `outcomes.evidenceIds` | New table; existing rows backward-compatible | 1 hr |
| **A4** | Promote `FulfillmentCommitment` to its own table — when one Agreement has > 1 commitment ("primary + reciprocal" in VF terms) | Splits the `entitlements.terms` payload into structured rows | 1 day |
| **A5** | Split `entitlements` table into `exchange_agreements` + `claim_rights` + `fulfillment_cases` — only when v0 conflation actually breaks something | Foreign-key chain; migration script; UI keeps the same workspace surface | 2 days |
| **A6** | Add `EconomicEvent` discriminator on `activityLogs` (`event_kind: transfer | production | use | work | settlement`) — the subset of activities that actually move a resource | Backward-compat column with sensible default | 0.5 day |
| **A7** | Add ODRL `UsageAuthorization` for asset-permission-style claims (e.g. "authorized to invoke this AI agent's endpoint") | Distinct from delivery-style ClaimRights | 1 day |

**A1 + A2 land today** (this conversation). A3–A7 ship as separate slices when the use-case demands them.

---

## 6. Why this matters now (the practical answer)

The user's correction lands two errors that would compound with every future feature:

1. **`Intent ⊂ prov:Plan` makes intent-without-plan meaningless.** Half of the catalyst persona examples (`I want to contribute`, `I need to know X`, `I'm called somewhere — place me`) don't have a plan. They have an intention waiting for matching. Subclassing intent under PROV-Plan forces a fictitious plan into every record. UFO-C `Intention` is the correct anchor; `vf:Intent` is the correct domain match.

2. **`Entitlement` as one class merged three with different lifecycles.** When the next agent-team review asks *"can a single Agreement create multiple ClaimRights for different parties?"* (yes — every ECFA-style accountability arrangement does), or *"can a Case run with multiple Plans tried in sequence?"* (yes — when the first plan stalls), the v0 conflation breaks. Documenting the projection now lets us split later without invalidating any existing rows.

The ValueFlows alignment is especially load-bearing because VF *already* models the marketplace path from intent → commitment → agreement → event → claim. Anchoring on VF means we get its `satisfies` / `fulfills` / `settles` verbs for free, which collapses our home-grown `fulfills_entitlement_id` into a triple of well-defined VF properties.

UFO-C anchors the cognitive layer (Desire / Intention / Goal as agent mental states) and the social layer (SocialRelator / SocialCommitment / SocialClaim for the contractual record). Together with PROV (execution provenance) and ODRL (asset-permission policy when relevant), the four upper-ontology pieces cover the whole stack without overlap.

---

## 6.5 Concepts folded in

Per the second alignment pass, several concepts are *useful enterprise framings* that don't have direct equivalents in vf / ufo / prov / odrl. These are absorbed natively into `hub:` — no `gist:` prefix is imported, no external URIs referenced. The concepts simply appear as Smart Agent classes with the rdfs:comment noting the inspiration.

| Folded-in concept | Where it lands in our ontology | Why it's worth absorbing |
|---|---|---|
| Intention as the upper of intent | `hub:Intention` (already had `Intent ⊂ ufo:Intention`; the folded framing reinforces that intent is goal/desire/aspiration, not plan) | Final nail in the `Intent ⊂ prov:Plan` mistake |
| EconomicIntent layer | New `hub:EconomicIntent` between `Intention` and `RecipientIntent`/`ProviderIntent` | Distinguishes "marketplace-publishable intent" from "any internal commitment of the agent" |
| Role-neutral Recipient/Provider | New `hub:RecipientIntent` + `hub:ProviderIntent`; old `RequirementIntent`/`ProvisionIntent` kept as `owl:equivalentClass` aliases | Works uniformly for services / access rights / capabilities / goods / data / money / labor / promises — better than need-shaped/resource-shaped framing |
| ExchangeOffer as reciprocal subclass | New `hub:ExchangeOffer ⊂ hub:OfferProposal` | Distinguishes "I'm telling the marketplace I can provide X" from "I'm telling the marketplace I can provide X *in exchange for Y*" — the latter has acceptance fast-path |
| ExchangeContract for legal teeth | New `hub:ExchangeContract ⊂ hub:ExchangeAgreement` | Most catalyst engagements are agreements not contracts; reserves the contract framing for funding disbursements, formal partnerships, attestable credentials |
| UsagePermission rename | `hub:UsagePermission ⊂ odrl:Permission` (was `UsageAuthorization`); old name kept as alias | The right is split cleanly: ClaimRight = "someone owes me X"; UsagePermission = "I'm allowed to do X". Same Agreement may create both. |
| FulfillmentTask vs WorkItem | New `hub:FulfillmentTask ⊂ prov:Activity` distinct from `hub:WorkItem` | Earlier draft conflated the queue-record with the work itself; now WorkItem = ticket, FulfillmentTask = the work, TaskPattern = the reusable template |
| TaskPattern | New `hub:TaskPattern` | Reusable work pattern; lets a "first coaching session" template flow across many engagements |
| Specification + Determination + Evidence | New `hub:OutcomeSpecification`, `hub:DeliverableSpecification`, `hub:ServiceOutcomeSpecification`, `hub:OutcomeDetermination`, `hub:OutcomeAcceptance`, `hub:OutcomeEvidence` | Gives outcome conformance a proper structure: criteria (Specification) → judging act (Determination) → supporting artifacts (Evidence). Powers ECFA audit, peer review, baptism witness, credential verification flows. |
| Role properties (provider / recipient / agreementParty) | New `hub:provider`, `hub:recipient`, `hub:agreementParty` | Generic role properties that flow across Intent / Proposal / Agreement / Commitment / Activity / Event |
| `hasGoal`, `triggeredBy`, `conformsToSpecification` | New cross-cutting properties | `hasGoal` (Intention → Goal); `triggeredBy` (contingent commitments / claim-rights / work items); `conformsToSpecification` (the validation relation) |

What was **not** folded in (deliberately):
- **`gist:Requirement` for pre-agreement need** — gist's Requirement is *an obligation*, not a desire. Modelling RecipientIntent under Requirement would imply pre-agreement need is already obligatory. We use Requirement only inside an agreement's terms.
- **`gist:` namespace import** — concepts only, not URIs. Keeps the ontology self-contained; vf / ufo / prov / odrl remain the only declared external alignments.

## 7. The corrected one-paragraph summary

> An Agent has a Desire, which matures into an **Intention** (formerly "Intent") with an associated Goal. The Intention is published as a **MarketplaceProposal** (formerly the "express intent" surface). Discovery pairs RequirementIntent + ProvisionIntent into an **IntentMatch**. Acceptance creates an **ExchangeAgreement** (formerly "match accepted") which **stipulates one or more FulfillmentCommitments** and **creates one or more ClaimRights** (formerly "Entitlement"). The ExchangeAgreement governs a **FulfillmentCase** (formerly the "Entitlement workspace") that holds a **FulfillmentPlan**, generates **WorkItems**, and records **FulfillmentActivities** — some of which are **EconomicEvents** that satisfy intents, fulfill commitments, settle claim-rights, and produce **Outcomes** with **OutcomeEvidence**.

That's the cleaned-up model. A1 + A2 ship now.
