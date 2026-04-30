# Round-Trip & Trust-Deposit Plan — Marketplace → Fulfillment → Validation → Trust

> **Status**: design — three-agent synthesis (UI Designer + Test User + PM) ready for direction confirmation.
> **Companion to**: `marketplace-lifecycle-alignment.md` (UFO-C/VF/PROV/ODRL ontology spine), `entitlement-fulfillment-plan.md` (Entitlement layer E1-E12), `intent-bdi-plan.md` (Intent + Match), `validation-feedback-plan.md` (review records), `trust-graph.md` (enduring agent trust).
>
> **Premise**: today the catalyst hub builds a credible *marketplace of intents* — two agents discover alignment and accept a contract. The chain ends there. Activities get logged unilaterally; closure is a silent status flip; the engagement leaves no enduring residue on either agent's trust profile. We need to close the loop: bilateral commitment → joint execution → mutual outcome determination → on-chain trust deposit that compounds.

> **The full round trip — eight stages around one persistent thread:**
>
> ```
>            ┌─────────────────────── Commitment Thread ───────────────────────┐
>            │  the persistent record that links every stage below              │
>            │  intent · contract · activities · evidence · outcomes ·          │
>            │  feedback · validation · trust update                            │
>            └──────────────────────────────────────────────────────────────────┘
>                                          ▲
>           ┌──────────────────────────────┼──────────────────────────────┐
>           │                              │                              │
>   1. Intent Marketplace ──▶ 2. Alignment Match ──▶ 3. Contract/Commitment
>           ▲                                                              │
>           │                                                              ▼
>   8. Trust Graph Update                                       4. Fulfillment Workflow
>           ▲                                                              │
>           │                                                              ▼
>   7. Feedback/Validation ◀── 6. Provenance Capture ◀── 5. Activities/Execution
> ```
>
> **Stage 6 — Provenance Capture — is its own moment.** Evidence is hashed, witness-attached, and frozen *before* the validation conversation in stage 7. Activities (5) are the *doing*; provenance (6) is the *fixing of the record* that makes validation auditable. The two are easy to conflate — they aren't the same thing.

---

## 1. Why this work, why now

The marketplace half is solid — agents express Intents, discovery surfaces matches, acceptance mints an Engagement. But the user-test verdict on the post-acceptance experience is **4/10**:

- The Engagement workspace shows the **holder's** outcome only; the **provider's** outcome is invisible. The artifact is bilateral but the UI is single-perspective.
- There is **no two-way conversation** anchored to the engagement — coordination leaks out into ad-hoc channels.
- Activities are unilateral. Only the provider logs; the holder is a spectator. The PROV chain is half-empty.
- Closure is **silent**: a status flip with no ceremony, no mutual sign-off, no witness, no acknowledgment.
- Completed engagements produce **no visible residue**. The agents' trust profiles do not change. Future Discover does not reflect the work that just happened.

We have the on-chain machinery already: `AgentReviewRecord`, `AgentSkillRegistry`, `AgentAssertion`, `AgentValidationProfile`. The marketplace path produces no inputs to it. **This plan wires acceptance to deposit.**

---

## 2. Six gap-blocks (PM diagnosis)

| # | Gap | What's missing |
|---|-----|----------------|
| G1 | Intention → Match | Both parties have private outcomes attached to their Intent, but at match time the holder's outcome is the only one in the room. Provider's outcome (often the *learning, recognition, capacity-build* side of the trade) is not captured. |
| G2 | Match → Agreement | "Accept" mints an Engagement but never asks the parties to **co-author** the agreement: shared cadence, kickoff date, definition of done, witness opt-in. The artifact reads like an entitlement granted *to* one side, not a contract *between* both. |
| G3 | Engagement workspace | Single-perspective hero, holder's outcome card, provider-only activity log. Should be a split-pane `AgreementCard` with parallel outcome cards (one per party) and a 5-stop `PhaseRibbon`. |
| G4 | Activities → EconomicEvents | Activities log fine, but they don't surface as **EconomicEvents** in either agent's wider profile. The fulfillment ledger is invisible outside the engagement. |
| G5 | Outcome determination | Today: provider clicks "Mark fulfilled," cascade fires, done. Should require **mutual sign-off** (both holderConfirmedAt + providerConfirmedAt) plus optional witnessAgent. This is the validation step that earns trust. |
| G6 | Trust deposit | Fulfilled engagements should mint: `AgentReviewRecord` (each party reviews the other), `AgentSkillRegistry` claim (provider's demonstrated skill, attested by holder), `AgentAssertion` (the engagement itself as a verifiable claim), optional `AgentValidationProfile` update. Today none of this fires. |

---

## 3. The bilateral artifact — UI Designer's reframe

Engagement is **bilateral, time-shaped, validated**. The current workspace flattens it into single-perspective status. The redesign replaces the hero with three primitives:

### 3.1 `AgreementCard` (split-pane)

```
┌─────────────────────────────────────────────────────────────────┐
│  Sofia (Berthoud Circle) ⇄ Maria (Regional Coach)               │
│  Granted 2026-04-12 · 6-month term · weekly cadence              │
├──────────────────────────┬──────────────────────────────────────┤
│ Holder (Sofia)            │ Provider (Maria)                     │
│  Receiving: coaching      │  Giving: 15 hrs/wk capacity          │
│  Her outcome:             │  Her outcome:                        │
│   "G2 plant identified    │   "Coach-of-coaches certification    │
│    in Berthoud by Q3"     │    progress: 1 of 3 case studies"    │
│  Status: in cadence       │  Status: in cadence                  │
│  Confirmed: —             │  Confirmed: —                        │
└──────────────────────────┴──────────────────────────────────────┘
```

Two outcome columns. Two confirmation states. One agreement. The PROV chain becomes legible from either seat.

### 3.2 `PhaseRibbon` (8 stops — full round trip)

```
1. Marketplace ▸ 2. Match ▸ 3. Contract ▸ 4. Workflow ▸ 5. Activities ▸ 6. Provenance ▸ 7. Validation ▸ 8. Trust Update
       ●            ●           ●            ◐              ○                ○                  ○                ○
```

A linear stepper that gives the engagement a **shape over time** matching the eight-stage round trip. The ribbon lives at the top of the workspace and is the user's wayfinder. Each stop has entry criteria and an action surface:

| # | Stop | Entry criteria | Action surface |
|---|------|----------------|----------------|
| 1 | Marketplace | Intent expressed | (pre-engagement; visible only as the origin tag on the AgreementCard) |
| 2 | Match | Match scored | (pre-engagement; shows match score + satisfies/misses) |
| 3 | Contract | Match accepted, both outcomes captured | Co-author cadence, kickoff date, definition of done, witness opt-in |
| 4 | Workflow | Engagement granted | Auto-generated work items + manual additions |
| 5 | Activities | First work item resolved | Activity feed, two-way thread, capacity ticker |
| 6 | Provenance Capture | Activities accumulating | **Evidence pinning** — attach artifacts, hash + anchor, witness sign |
| 7 | Validation | Evidence frozen | `DeterminationPanel` — mutual sign-off, optional witness review |
| 8 | Trust Update | Both confirmed | Cascade fires: review records, skill claims, assertion, validation profile delta |

The first two stops show as "completed" on day one (the Engagement only exists because Marketplace + Match already happened). The user's active focus is always between Contract and Trust Update.

### 3.3 `DeterminationPanel` (mutual sign-off)

```
┌─────────────────────────────────────────────────────────────────┐
│  Determine outcome                                                │
│                                                                   │
│  [✓] Sofia confirms her outcome was achieved   (2026-04-25)      │
│  [ ] Maria confirms her outcome was achieved                      │
│  [+] Add witness (optional) — e.g., NCF, Pastor Tom               │
│                                                                   │
│  On both confirmations → trust deposit fires.                     │
└─────────────────────────────────────────────────────────────────┘
```

No party-of-one closure. Both must sign. Witness is optional but increases the weight of the resulting `AgentReviewRecord`.

---

## 4. Trust deposit — what gets written on closure

When `holderConfirmedAt` and `providerConfirmedAt` are both set, `cascadeFulfillment` extends to:

| Artifact | Fields | Both sides? |
|----------|--------|------------|
| `AgentReviewRecord` × 2 | reviewer, subject, engagementId, score, attestation hash | yes — each party reviews the other |
| `AgentSkillRegistry` claim | subject (provider), skill (from intent topic), attestor (holder), evidenceUri (engagement) | provider only |
| `AgentSkillRegistry` claim (recipient growth) | subject (holder), skill (e.g., "received coaching" / "managed grant") | holder only — captures their growth, not just provider's delivery |
| `AgentAssertion` | engagement-as-claim, both party signatures, optional witness sig | shared |
| `AgentValidationProfile` (delta) | counts updated, recency bumped | both |

These are the **enduring residue**. Future `DiscoveryService.listAgents()` and match-scoring read from them; the next time Maria appears in a match, her coach-of-coaches skill claim is real, attested, and dated.

---

## 5. Schema additions

> **No backcompat needed.** No operational data to preserve. Demo state is reconstructable via `scripts/fresh-start.sh`. Migrations may drop/rename freely; columns can be NOT NULL where appropriate.

`entitlements` table additions:

```ts
providerIntentOutcomeId   text       // FK → outcomes (the provider's outcome — G1 fix)
holderConfirmedAt          integer    // unix seconds
providerConfirmedAt        integer
witnessAgent               text       // FK → agents (nullable)
reviewIds                  text       // JSON array of AgentReviewRecord ids
assertionId                text       // AgentAssertion id
phase                      text       // 'granted' | 'kickoff' | 'in_cadence' | 'witnessed' | 'determined'
```

A new `commitment_thread_entries` table — the persistent backbone of the round trip. **This is not just a chat log.** Every stage emits typed entries onto the thread: the original Intent reference, the Match acceptance, contract terms, work items, activity log entries, evidence pins, witness signatures, validation confirmations, the trust deposit hashes. Reading the thread top-to-bottom is the audit story of the engagement.

```ts
id
engagementId
kind          // 'intent_ref' | 'match_accept' | 'contract_term' | 'work_item' |
              // 'activity' | 'message' | 'evidence_pin' | 'witness_sig' |
              // 'confirmation' | 'trust_deposit'
fromAgent     // nullable for system entries
body          // typed payload (JSON, schema by kind)
attachmentUri // nullable
hashAnchor    // nullable; set for evidence_pin and trust_deposit
createdAt
```

The two-way human conversation is just one `kind`; the thread also captures the structured provenance entries that auditors and the trust deposit step read. One persistent record per engagement.

### 5.1 Provenance Capture as a discrete stage

Stage 6 introduces an `evidence_pin` action: the parties select activities + artifacts already in the thread, optionally attach external evidence (file uploads, urls), and **freeze the bundle** with a content hash. The bundle is what the witness signs and what the validation confirmations reference. After pinning, activities can still be logged — but only the pinned bundle counts toward the trust deposit.

This separates *doing* from *fixing the record* — and is the moment the engagement stops accumulating and starts asserting.

No new tables for the trust artifacts — they already exist as on-chain contracts; we record their tx hashes / record ids in the columns above.

---

## 6. Component changes (UI Designer's 11-file table)

| File | Change |
|------|--------|
| `app/h/[hubId]/(hub)/entitlements/[id]/page.tsx` | Replace hero with `AgreementCard`; mount `PhaseRibbon` above; thread `DeterminationPanel` and `EvidencePinPanel` into stops 6 and 7. |
| `components/engagements/AgreementCard.tsx` | **new** — split-pane bilateral card. |
| `components/engagements/PhaseRibbon.tsx` | **new** — **8-stop** stepper covering the full round trip, derived from entitlement.phase + thread state + confirmation timestamps. |
| `components/engagements/DeterminationPanel.tsx` | **new** — mutual sign-off + witness picker (stage 7). |
| `components/engagements/EvidencePinPanel.tsx` | **new** — Provenance Capture (stage 6): pick activities + artifacts, hash, witness-sign. |
| `components/engagements/CommitmentThread.tsx` | **new** — typed thread view; renders all entry `kind`s with stage badges (not just messages). |
| `app/h/[hubId]/(hub)/entitlements/[id]/EntitlementStatusActions.tsx` | Hide "Mark fulfilled" once phase ≥ in_cadence; defer to `DeterminationPanel`. |
| `lib/actions/entitlements.action.ts` | Add `confirmOutcome(side: 'holder' \| 'provider')`, `attachWitness`, extend `cascadeFulfillment` to mint trust artifacts. |
| `lib/actions/engagements/thread.action.ts` | **new** — append + list typed entries on the Commitment Thread; helpers per `kind`. |
| `lib/actions/engagements/evidence.action.ts` | **new** — pin evidence bundle, compute content hash, request witness sig. |
| `lib/actions/engagements/trust-deposit.action.ts` | **new** — wraps `AgentReviewRecord` + `AgentSkillRegistry` + `AgentAssertion` writes; reads the pinned bundle, not loose activities. |
| `lib/discover/match-scoring.ts` | Read `AgentSkillRegistry` + `AgentValidationProfile` so prior fulfilled engagements lift future match scores. |
| `components/profile/TrustResidueCard.tsx` | **new** — show on agent profile: recent reviews, attested skills, validation deltas. |

---

## 7. R-phased build (PM)

| R | Slice | Round-trip stages touched | Days | Demoable? |
|---|-------|--------------------------|------|-----------|
| R1 | Schema migration (entitlements columns + `commitment_thread_entries` table) + provider outcome capture on Intent + at match-accept | 1, 2, 3 | 1.5 | yes (data only) |
| R2 | `AgreementCard` split-pane (read-only, both outcomes visible) + 8-stop `PhaseRibbon` shell | 3 | 2.0 | yes — Sofia/Maria see each other and the shape of the journey |
| R3 | `CommitmentThread` typed view; backfill existing activities + work items as thread entries | 4, 5 | 1.5 | yes — one persistent record |
| R4 | Two-way human messages on the thread (one `kind` among many) | 5 | 0.5 | yes — coordination on-artifact |
| R5 | `EvidencePinPanel` — pin bundle, hash, optional witness sign | 6 | 2.0 | yes — Provenance Capture as a discrete moment |
| R6 | `DeterminationPanel` + dual-confirm gating + cascade reshape (gates on pinned bundle) | 7 | 2.0 | yes — mutual sign-off ceremony |
| R7 | Trust deposit (AgentReviewRecord + AgentAssertion + skill claims for both parties) + `TrustResidueCard` on profile | 8 | 3.0 | yes — closure leaves visible residue |
| R8 | Match-scoring lift from prior trust artifacts; AgentValidationProfile delta read in Discover | 1, 2 (next round) | 2.0 | yes — round trip closes; next Discover reflects it |

**Total ≈ 14.5 days.** (+2 over the 5-stop plan, mostly to give Provenance Capture its own slice.)

### Smallest demoable slice — Maria's information round-trip (2 days)

> Compress R1 + R2 + a simplified R6 into a vertical demo: Sofia accepts Maria's coaching match → both outcomes captured → `AgreementCard` shows both seats with the 8-stop ribbon at the top → both click confirm at stage 7 → a single `AgentReviewRecord` is written at stage 8 → it appears on Maria's profile. No Provenance Capture, no witness, no skill registry, no scoring lift yet. **Proves the round trip end-to-end at lowest cost.** Provenance Capture (R5) and the full trust deposit (R7) are the next two slices to layer on.

---

## 8. Mission-org-grounded persona narratives (PM)

| Persona pair | Engagement | What deposits at close |
|--------------|------------|----------------------|
| **Sofia (Berthoud Circle) ⇄ Maria (Regional Coach)** | 6-month coach-of-coaches | Maria gains "coach-of-coaches" skill claim; Sofia gains "G2-leader-development" claim; both update validation counts. |
| **Sarah (church planter) ⇄ NCF (restricted-grant officer)** | 12-month restricted grant + quarterly reporting | NCF earns "deployed restricted grant cleanly" claim from Sarah; Sarah earns "submitted quarterly reports on time" claim from NCF. |
| **Carlos (volunteer) ⇄ Wellington Indigitous chapter** | 3-month digital-evangelism volunteer | Wellington earns "onboarded volunteer effectively"; Carlos earns "completed 12-week digital outreach service." |
| **Rosa (counselor) ⇄ Familia (GMCN trauma-care center)** | 6-month case load | Rosa earns "trauma-informed counseling" skill; Familia earns "supervised counselor under GMCN protocol" — feeds future GMCN credential. |

These four cover the four mission-org families we've grounded the demo in: NewThing G3, NCF, Indigitous, GMCN.

---

## 9. Test User mutual-outcomes table

| Round-trip stage | Holder needs to feel | Provider needs to feel |
|------------------|---------------------|----------------------|
| Granted | "I've been heard." | "My capacity is being valued, not just consumed." |
| Kickoff | "We have a plan." | "We have a plan." |
| In Cadence | "Progress is happening on my behalf." | "My contribution is being captured." |
| Witnessed | "Someone other than me sees this worked." | "My work is being validated." |
| Determined | "This was real, and it counts." | "This was real, and it counts toward who I am." |

Three desired feelings at successful close: **acknowledgment, attribution, accumulation.**

---

## 10. Risks

- **R1 — trust-signal dilution.** If every engagement mints a 5-star review, the signal collapses. Mitigation: review records carry a confidence field weighted by witness presence + activity density + capacity consumed. Empty-but-confirmed engagements deposit a *thin* signal, not a full one.
- **R2 — validation gaming.** Two agents could collude to mint reviews. Mitigation: AgentValidationProfile reads weight reviews where `witnessAgent != null` higher; long-term, enforce that some fraction of an agent's claims come from witnessed or hub-rooted engagements.
- **R3 — provider/holder asymmetry.** The provider often has more institutional weight (NCF vs. a church planter). The split-pane visually equalizes them but the trust deposit must not over-reward the larger party. Mitigation: skill claims are scoped to the *role* in the engagement, not the org, so Sarah's "delivered grant report on time" claim accrues to *her*, not to NCF.

---

## 11. Open product questions (need direction before R1 starts)

1. **Provider outcome capture timing.** Capture provider outcome at *Intent expression* (so it surfaces at match), or at *match acceptance* (lighter friction)? PM recommends: capture optionally at Intent, fall back to a single-field prompt at acceptance.
2. **Mutual sign-off blocking.** Should one party's confirm time-out auto-close after N days, or stay pending forever? PM recommends: 30-day pending → "lapsed" status → thinner deposit.
3. **Witness scope.** Open list of any hub agent, or restricted to hub-rooted orgs (NCF, Wellington, GMCN, etc.)? PM recommends: open list, but witnesses from hub-rooted orgs carry higher weight in `AgentValidationProfile`.
4. **Skill taxonomy source.** Use intent topic verbatim as skill string, or normalize against an `AgentSkillRegistry` skill ontology? PM recommends: normalize, but allow free-text fallback.
5. **Holder-side skill claim.** Should the holder also accrue a skill claim ("received coaching", "managed grant"), or is the trust deposit asymmetric (provider only)? UI Designer + Test User both argue **yes** — holders grow too.
6. **Review visibility.** Reviews public-on-profile, hub-only, or visible only to the two parties + witnesses? PM recommends: public-on-profile by default, with private opt-in.
7. **Cascade ordering.** When both confirm, do we mint trust artifacts before or after `cascadeFulfillment` advances intent/match status? PM recommends: status cascade first (matches existing PROV chain), trust artifacts second (one DB transaction).

---

## 12. What we're explicitly *not* doing in this round

- No challenge / dispute UI yet (`AgentDisputeRecord` exists; we'll add it in a follow-up after R8 reveals real friction).
- No reputation scoring composite — trust artifacts deposit; the scoring algorithm that *reads* them lives in match-scoring (R8) and is intentionally simple in v0.
- No retroactive trust deposit for already-fulfilled engagements pre-migration. They stay as silent closures.

---

## 13. Team alignment (the four lanes from your sketch)

The reference image groups the work into four owner-lanes. Mapping those to our pipeline:

| Lane | Owns | First-round deliverables |
|------|------|------------------------|
| **Product (PM)** | Round-trip framing, persona narratives, open questions, risk register | §2, §8, §10, §11 of this doc; ongoing direction memos as R-slices land |
| **UX/UI** | `AgreementCard` split-pane, 8-stop `PhaseRibbon`, `DeterminationPanel`, `EvidencePinPanel`, `CommitmentThread`, `TrustResidueCard` | The 11 component changes in §6 |
| **Usability (Test User)** | Per-stage mutual-outcomes table, friction probes after each R-slice, the three closing feelings | §9 of this doc; usability run after R2, R5, R6, R7 |
| **Engineering** | Schema migration, server actions, on-chain trust deposit wiring, match-scoring lift | §5 schema, §6 action files, R1-R8 sequencing |

Pipeline gate: each R-slice ships only after Usability does a 30-min Test User pass.

---

## 14. Direction needed

Before we start R1, please confirm:

1. **Ship the 2-day smallest slice first** (Maria's information round-trip) so we can pressure-test the bilateral artifact before adding witness, skill registry, and scoring lift — *or* push straight through R1-R8 as a single ~12.5-day arc.
2. **Default answers** to the seven open questions in §11, or call out which ones you want to think on.
3. **Persona to lead the demo with** — Sofia/Maria (familiar from existing seed data, lowest setup cost) is the recommended starting point.

Once you say go on (1) and (3), R1 starts.
