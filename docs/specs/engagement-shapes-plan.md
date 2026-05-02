# Engagement Shapes — Per-Type Workspace Plan (R9 onward)

> **Status**: design — three-agent synthesis (UI Designer + Test User + PM) ready for direction confirmation.
> **Companion to**: `round-trip-trust-deposit-plan.md` (R1–R8, just shipped).
>
> **Premise**: R1–R8 closed the round trip — bilateral outcomes, evidence pinning, dual sign-off, trust deposit, match-scoring lift. Shipped a workspace where every engagement renders the same nine sections in the same order. **The workspace treats engagement as the noun and resource type as a tag; it should be the other way around.** A weekly coaching arrangement and a tranched grant aren't variants of one screen — they're different jobs that happen to share an audit chain.

> **The four-shape model — same data, four UIs:**
>
> ```
>                   resolveShape(terms.object, offering.cadence)
>                                       │
>           ┌───────────┬───────────────┼───────────┬───────────┐
>           ▼           ▼               ▼           ▼
>      Cadence       Tranche        One-Shot     Governance
>      ────────      ─────────      ─────────    ────────────
>      Sessions      Tranches       Delivery     Policy
>      timeline      schedule       moment       panel
>      Worker        Money          Connector    Credential
>      Skill         (always)       Data         Organization
>      Prayer                       Scripture    Church
>      Curriculum                   Venue (1×)
>      Venue (×)                    Credential
>                                   (light)
> ```
>
> R1–R8 round-trip primitives (PhaseRibbon, EvidencePin, Determination, CommitmentThread) **survive — but get demoted under disclosures or rebuilt as the primary surface** depending on the shape. Nothing is deleted; everything moves.

---

## 1. Diagnosis

We built the engagement workspace as a generic CRM screen optimized for the *bookkeeping* (capture both outcomes, pin evidence, dual-confirm, deposit trust) instead of the *fulfillment work* the two parties actually do day-to-day. **Resource type is the dominant variable** — it determines the cadence of contact, what "doing the work" looks like, what evidence even *means*, and which stops on the round-trip carry weight.

The Test User pass made this concrete. Scores out of 10 on the current page:

| Persona | Score | Why |
|---------|------:|-----|
| **Maria** (provider, regional coach — Worker)        | **4** | The 8-stop ribbon and red Stage-7 / orange Stage-6 panels feel like overdue tasks in week zero. AgreementCard split-pane is unreadable on mobile. |
| **Sarah** (holder, church planter — Money grant)     | **3** | "hrs/wk" capacity meter is nonsense for a grant; she can't find the tranche schedule she came here for. |
| **Carlos** (provider, volunteer — Connector intro)   | **2** | An 8-stop ribbon for sending one email reads as comical. Capacity meter is meaningless. |
| **Rosa** (provider, counselor — sensitive Worker)    | **1** | The public-feeling thread + evidence pinning + witness picker violate trauma-informed pastoral norms. She closes the tab. |

The fix is not to tidy up the page. The fix is to let engagement *kind* pick the layout.

---

## 2. Shape taxonomy — 8+ resource types collapse to 4 shapes

| Shape | Resource types | Primary work | Demo persona |
|-------|----------------|--------------|--------------|
| **Cadence**    | Worker, Skill, Prayer, Curriculum, recurring Venue, Church-as-pastoral | Repeated sessions over time on a schedule | **Sofia ↔ Maria** (coaching, weekly × 6mo); **Rosa ↔ Familia** (trauma care, quiet mode) |
| **Tranche**    | Money | Scheduled disbursements gated on reports | **Sarah ↔ NCF** ($25k restricted grant, 4 tranches, 12mo) |
| **One-Shot**   | Connector, Data, Scripture / Information, one-time Venue, lightweight Credential | A single delivery moment | **Carlos ↔ Wellington** (warm intro to sister network) |
| **Governance** | Organization, Church-as-org, heavyweight Credential issuance | Policy, approvals, multi-party sign-off | **Familia ↔ GMCN** (credential renewal) |

### Edge-case rules — pre-decided, not deferred

- **Venue cadence is determined by the offering, not the resource type.** Weekly small-group room → Cadence. One-time wedding venue → One-Shot. Resolver reads `offering.cadence`.
- **Curriculum is Cadence even though it terminates.** A 12-week course is a finite Cadence with auto-suggest close-out on the last session, not a One-Shot.
- **Prayer is Cadence in quiet mode.** Same shape, defaults flipped: thread composer hidden, evidence pinning hidden, deposit a thinner trust artifact.
- **Connector is One-Shot even if there's a follow-up.** The follow-up is a *new* engagement, not stage 5 of the old one.
- **Money is always Tranche, even one-time gifts.** A single-tranche schedule is still a tranche schedule with `n=1`.
- **Sensitive Worker (e.g. Rosa's trauma counseling) is Cadence + quiet mode** — same as Prayer. Detection: an opt-in flag on the offering, or a heuristic on `terms.skill`.

---

## 3. Per-shape primary surface

| Shape | Primary surface | What dominates the screen |
|-------|----------------|---------------------------|
| **Cadence**    | `SessionTimeline` — past sessions, "Next session" hero with **Schedule** / **Log** buttons, capacity ticker as inline chip | "Your coaching with Sofia — week 0 of 26" |
| **Tranche**    | `TrancheSchedule` — vertical list of tranches with state (`scheduled` / `report-due` / `released` / `held`), each with its own report row | "$25,000 NCF restricted grant — Tranche 1 of 4 pending disbursement" |
| **One-Shot**   | `DeliveryCard` — one big "did this happen, attach the artifact, both confirm" card. Two states: *sent* / *landed*. | "Carlos ⇄ Wellington — warm intro to sister network, open" |
| **Governance** | `PolicyPanel` — current state, signers required, pending approvals, attached policy doc | "Familia / GMCN credential renewal — 2 of 3 signers" |

The round-trip primitives don't disappear. They go *under* a `Records` / `Journey` disclosure tab — or get re-rendered as the primary surface (Determination *becomes* the page for One-Shot at delivery moment).

---

## 4. The build spec — 9 sections × 4 shapes table

This is the artifact engineering builds to. Read the column for the shape; that's the spec.

| Section (R1–R8 component) | Cadence | Tranche | One-Shot | Governance |
|---------------------------|---------|---------|----------|------------|
| **AgreementCard** (split-pane) | collapse to one-line header | one-line header w/ $ disbursed | one-line header | **stays as-is** alongside PolicyPanel |
| **PhaseRibbon** (8 stops) | demoted to "Journey" disclosure | replaced by tranche-state row at top | collapse to **3 stops** (Agreed → Confirmed → Closed) | **stays as-is** (governance needs full audit) |
| **NextStepCard** | replaced by "Next session" row inside SessionTimeline | replaced by "Next tranche / next report" row | replaced by "Confirm delivery" CTA on DeliveryCard | stays as-is |
| **CommitmentThread** (typed) | demoted to right rail, collapsed by default | demoted; per-tranche report threads inline instead | gone entirely; replaced by single artifact + ≤2 messages | **stays as primary tab** |
| **ThreadMessageComposer** | sidebar, one-line composer | per-tranche only | bottom of DeliveryCard, single field | primary |
| **EvidencePinPanel** | hidden until term-close; auto-suggests sessions to pin | per-tranche evidence (the report *is* the evidence) | replaced by single artifact upload on DeliveryCard | stays, mandatory at policy events |
| **DeterminationPanel** | hidden until term-close, then full-screen modal | per-tranche mini-determination + final determination | **becomes the page** at delivery moment | stays, **multi-signer variant** |
| **TrustResidueCard** (profile) | shown post-determination | shown post-final-tranche | shown post-determination | shown post-determination |
| **Capacity ticker** | top of timeline (sessions remaining) | top of schedule ($ remaining) | **gone** (no capacity in one-shot) | **gone** (no capacity in governance) |

Read top-to-bottom for the shape you're building. That's the entire UI spec.

---

## 5. Persona walkthroughs — before / after

### Maria — Cadence / Worker
- **Today (4/10)**: opens page, sees orange Stage-7 banner that looks like an overdue task in week zero. Bilateral split-pane and capacity meter showing "10/15" before she's done anything.
- **After**: opens to **"Your coaching with Sofia — week 0 of 26."** One button: **Schedule first session**. Past-sessions list is empty with a one-line placeholder. Sofia's contact card visible. The PhaseRibbon, evidence pinning, and witness picker live under a "Closing out" disclosure that only surfaces when she's ≥ 80% through capacity OR within 30 days of `validUntil`.

### Sarah — Tranche / Money
- **Today (3/10)**: "hrs/wk" label nonsense for a grant; orange Stage-6 reads like a compliance warning the day after acceptance; no tranche schedule visible.
- **After**: opens to **"$25,000 NCF restricted grant — Tranche 1 of 4 pending disbursement."** Vertical timeline: 4 tranche rows, $6,250 each, each with its own report-due chip. Hero: **"Submit your Q1 narrative to release the next $12,500."** Reports *are* the activities — no generic activity feed. NCF officer's contact pinned at top.

### Carlos — One-Shot / Connector
- **Today (2/10)**: sees a 6-month coaching workspace for sending one email. Capacity card says "0 hrs/wk."
- **After**: opens to **"Carlos ⇄ Wellington — warm intro to sister network, open."** A single `DeliveryCard` with two big states: **Intro sent** and **Intro landed**. 3-month window indicator: "expires July 30, 61 days remaining." When he taps "Intro landed," the engagement closes; pin + witness happen silently in the background.

### Rosa — Cadence / Worker, quiet mode
- **Today (1/10)**: closes the tab; would rather track in a paper notebook than risk client exposure on a thread + evidence + witness UI.
- **After**: opens to **"Rosa's counseling — quiet mode, sessions on cadence."** Discretion banner at top: *"Quiet mode — content is not stored. Only session counts and dates persist."* One-tap **"Session occurred"** button (date + duration only, no notes field). Aggregate view: "11 sessions logged, on cadence." Close-out flow does not require evidence pinning or witness signature — only Rosa's attestation.

---

## 6. R-phased build (R9–R15)

| R | Slice | Round-trip stages touched | Days | Demoable? |
|---|-------|--------------------------|------|-----------|
| **R9**  | **Shape resolver + dispatch.** `lib/engagements/resolveShape.ts` reads `terms.object` + offering cadence, returns one of `cadence` / `tranche` / `oneshot` / `governance`. `entitlements/[id]/page.tsx` becomes a thin router. `<GenericWorkspace>` fallback wraps today's UI. | all | 1.5 | yes (data only — resolver picks shape, today's UI still renders) |
| **R10** | **CadenceWorkspace + SessionTimeline.** Schema: `engagement_sessions` table. New component: SessionTimeline with past/next/log + capacity ticker as inline chip. R1–R8 primitives demoted to "Journey" + "Closing out" disclosures. Migrate Sofia/Maria seed. | 4, 5, 6, 7, 8 | 2.5 | yes — Sofia/Maria coaching becomes session-shaped |
| **R11** | **OneShotWorkspace + DeliveryCard.** Single moment, single artifact, dual-confirm. Reuses EvidencePinPanel underneath but wraps in DeliveryCard. Ribbon collapses to 3 stops. | 5, 6, 7, 8 | 1.5 | yes — Carlos/Wellington intro |
| **R12** | **TrancheWorkspace + TrancheSchedule.** Schema: `engagement_tranches` table. Per-tranche row with state + inline report. Mini-determination per tranche; final determination on last tranche release. Migrate Sarah/NCF seed. | 4, 5, 6, 7, 8 | 3.0 | yes — Sarah/NCF grant becomes tranche-shaped |
| **R13** | **GovernanceWorkspace + PolicyPanel.** Schema: `engagement_policies` + `policy_signers`. Multi-signer determination variant. Approval log on the thread (which stays primary in this shape). | 4, 5, 6, 7, 8 | 3.0 | yes — Familia/GMCN credential renewal |
| **R14** | **Quiet mode + shape-subtype defaults.** Prayer (Cadence + `quiet=true`) and sensitive Worker (Rosa's trauma care) hide thread / evidence / witness by default; deposit thinner trust artifact. Curriculum auto-suggests close-out on last-session-log. Venue cadence inference (read `offering.cadence`). | varies | 1.5 | yes — prayer / sensitive engagements feel calm |
| **R15** | **Cleanup.** Remove `<GenericWorkspace>` fallback. Tighten resolver to throw on unknown shape. Update tests + screenshots. | — | 0.5 | no (refactor) |

**Total ≈ 13.5 days.**

### New files

```
lib/engagements/resolveShape.ts                    R9
app/h/[hubId]/(hub)/entitlements/[id]/page.tsx     R9 (becomes router)
components/engagements/shapes/
  GenericWorkspace.tsx                             R9 (temporary)
  CadenceWorkspace.tsx                             R10
  SessionTimeline.tsx                              R10
  OneShotWorkspace.tsx                             R11
  DeliveryCard.tsx                                 R11
  TrancheWorkspace.tsx                             R12
  TrancheSchedule.tsx                              R12
  GovernanceWorkspace.tsx                          R13
  PolicyPanel.tsx                                  R13
  MultiSignerDetermination.tsx                     R13
lib/actions/engagements/
  sessions.action.ts                               R10
  tranches.action.ts                               R12
  policy.action.ts                                 R13
```

### Schema additions (no backcompat — `fresh-start.sh` reseeds)

```
engagement_sessions   (R10) id, engagementId, scheduledFor, occurredAt, notes, loggedBy, createdAt
engagement_tranches   (R12) id, engagementId, index, amountCents, scheduledFor,
                            releasedAt, reportRequired, reportThreadEntryId, state
engagement_policies   (R13) id, engagementId, policyDocUri, currentState, requiredSigners
policy_signers        (R13) id, policyId, agentId, signedAt, role
```

### Smallest demoable slice — 1.5 days

> Compress R9 + a stub `CadenceWorkspace` reusing existing components rearranged. Resolver returns `'cadence'` for Sofia/Maria. CadenceWorkspace mounts `AgreementCard` (compact header) → fake `SessionTimeline` rendered from existing thread `kind='activity'` entries → "Journey" disclosure containing the unchanged `PhaseRibbon` + `CommitmentThread` + `EvidencePinPanel` + `DeterminationPanel`. **No new schema, no new server actions.** The session timeline is a *view* over existing thread entries.
>
> What it proves: dispatching by shape changes how Sofia/Maria experience the page — sessions dominate, audit machinery is one click away — without touching the round-trip plumbing R1–R8 just shipped. If it doesn't feel right, we learn that for 1.5 days before building three more workspaces.

---

## 7. Open product questions (need direction before R9 starts)

1. **Should the holder be able to override the inferred shape?** ("Treat this Venue as Cadence not One-Shot.") **PM recommends: no for v0** — resolver is deterministic; if it's wrong, fix the offering's cadence field. Override UI is layout-designer creep.
2. **Tranche release initiator.** Does the holder (Sarah) get a "request next tranche" affordance, or is release always provider-initiated (NCF)? **PM recommends: provider-initiated**, but holder can mark "report ready" which surfaces a release CTA on the provider side. Mirrors how restricted grants actually work.
3. **Prayer = quiet mode by default?** **PM recommends: yes**, with a one-click "make active" for prayer engagements that grow into mentoring or pastoral care. Quiet means no thread composer, no evidence prompt, thinner trust deposit.
4. **Sensitive-Worker detection.** Rosa's trauma counseling needs quiet mode but it's a Worker engagement. Detect via opt-in flag on the offering, or via skill-tag heuristic? **PM recommends: explicit flag** (`offering.quietMode = true`); too risky to infer from skill labels.
5. **Curriculum termination.** When the last session is logged, does close-out auto-fire, or does the provider have to click "wrap up"? **PM recommends: auto-suggest** (banner at top of CadenceWorkspace), manual confirm. Auto-firing the determination cascade on last-session-log is too magic.
6. **One-Shot retroactive evidence.** If the delivery happened off-platform (Carlos made the intro by text), can the user satisfy One-Shot by uploading a screenshot? **PM recommends: yes** — DeliveryCard accepts retro evidence; lands as `evidence_pin` like any other.
7. **Multi-resource engagements.** A coaching arrangement that includes a small stipend (Worker + Money). **PM recommends: explicitly out of scope** (see §9). One engagement, one shape. If both are needed, mint two engagements linked by `parentEngagementId` (future work).

---

## 8. Risks

- **R1 — shape-creep.** Three weeks after R15 ships, someone says "Education is different from Coaching, we need a Curriculum shape." Mitigation: the resolver is the single source of truth; adding a fifth shape requires written justification in the resolver file's docblock. Subtype defaults (R14) are the pressure-relief valve, not new shapes.
- **R2 — infrastructure leak.** Round-trip primitives shipped in R1–R8 must still fire under every shape — Prayer hides evidence pinning in the UI, but the trust deposit at close still needs *some* anchor or the cascade silently degrades. Mitigation: each shape implements a `canDeposit()` check that proves the cascade can run; quiet-mode shapes deposit a thin assertion + review record but **must still produce one** or it isn't the same product.
- **R3 — tranche-as-Cadence drift.** Engineering will be tempted to extend `SessionTimeline` to do tranches because they look list-shaped. They aren't: sessions are completed events; tranches are gated promises. Mitigation: separate components, separate tables, no shared base class. Duplication is cheaper than a bad abstraction here.

---

## 9. Three feelings the redesigned page should leave each persona with at fulfillment

| Persona | Three feelings at successful close |
|---------|--------------------------------------|
| **Maria** (Worker) | *Seen* (Sofia recognized her hours), *Capable* (the rhythm sustained itself), *Re-bookable* (next coaching pairing one tap away). |
| **Sarah** (Money) | *Trusted* (NCF closed clean without compliance friction), *Funded forward* (the relationship can go to round two), *Documented* (her reports are intact and retrievable). |
| **Carlos** (Connector) | *Useful* (the intro landed and someone said so), *Light* (he didn't have to do project management for an email), *Asked again* (Wellington signals "more like this"). |
| **Rosa** (sensitive Worker) | *Discreet* (nothing leaked, ever), *Counted* (her aggregate care is recognized without per-session exposure), *Held* (the system protected her client as carefully as she did). |

These four trios are the success criteria for the redesign. If a R-phase ships and any persona's three feelings aren't reachable, the phase isn't done.

---

## 10. Explicitly NOT doing this round

- No layout designer / no admin UI for editing shape rules.
- No user-facing shape override.
- No multi-resource-type engagements (Worker + Money in one record). Mint two.
- No retroactive shape migration of already-fulfilled engagements from R1–R8 — they stay on `<GenericWorkspace>` until R15 deletes it, at which point they read-only render via the closest shape.
- No new round-trip stages. The 8 stops stay; only their *prominence* changes per shape.
- No mobile-specific layouts (each workspace must be responsive, but no separate mobile flow).
- No editor for the cadence field on offerings (relies on existing offering schema).

---

## 11. Direction needed

Before R9 starts, please confirm:

1. **The four-shape taxonomy in §2** — particularly the Venue (resolver reads `offering.cadence`) and Curriculum (Cadence with auto-close) edge cases.
2. **The seven defaults in §7**, or call out which ones you want to think on (especially Q1 shape override, Q2 tranche initiator, Q4 sensitive-Worker detection).
3. **Smallest slice first or straight-through** — ship the 1.5-day stub `CadenceWorkspace` that views existing thread entries as a session timeline (zero schema), pressure-test on Sofia/Maria, *then* go through R10–R15? Or commit to the full 13.5-day arc?

Once you say go on (1) and (3), R9 starts.
