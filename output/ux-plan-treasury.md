# UX Plan — On-Chain Treasury (Phases 2.7, 3, 3-Cleanup, 4)

**Date:** 2026-05-06
**Author:** UX Designer
**Source:** `output/onchain-treasury-plan.md`, `output/ux-audit-intent-marketplace.md`, `docs/specs/intent-marketplace-capabilities.md`
**Palette:** Light corporate — white `#ffffff`, text `#5c4a3a`, muted `#9a8c7e`, accent `#8b5e3c`, border `#ece6db`. No dark mode.

---

## Phase 2.7 — Discretionary Pool→Need Disbursement

### Goal and Users

A steward discovers a posted Need intent that falls within their pool's mandate and allocates from available capacity without convening a formal round. Three actors need simultaneous coverage: the steward making the allocation decision, the donor whose pledged capacity is being drawn, and the beneficiary whose need is being addressed.

---

### New Pages and Routes

| Route | Purpose | Who sees it |
|---|---|---|
| `/h/[hubId]/pools/[poolId]/allocate` | Steward allocation composer — need picker + amount | Pool stewards only |
| `/h/[hubId]/pools/[poolId]/allocations` | Pool's allocation history — per-donor capacity consumed | Stewards + donors with attribution-on pledge |
| `/h/[hubId]/pledges/[pledgeId]` (modify existing) | Add disbursement history section | Donor (self) |
| `/h/[hubId]/intents/[id]` (modify existing) | Add "Allocated toward this need" banner | Beneficiary |

---

### Flow: Steward Allocates from Pool

```
Steward is on pool detail (/pools/[poolId])
  └─ Sees "Allocate to a need" CTA in the steward-actions section
       └─ /pools/[poolId]/allocate
            Step 1: Pick a need
              ├─ Search intents by mandate kind (pre-filtered to pool's acceptedKinds)
              ├─ Sort: match-score (composite rank), recency
              ├─ Each row: intent title, beneficiary label, mandate kind chip, priority badge
              └─ "Select" →

            Step 2: Set allocation
              ├─ Amount field (unit = pool's unit; max = pool.availableCapacity)
              ├─ Restriction check: does any active pledge restrict kind/geo?
              │     If yes → show "N donor(s) restrict this kind — only unrestricted
              │     capacity is available for this allocation" with exact capacity figure
              ├─ Description field (steward note; stored in org-mcp, not on-chain)
              └─ "Review allocation" →

            Step 3: Review + confirm
              ├─ Summary card: need title, beneficiary, amount, unit, pool name
              ├─ Disclosure: "This allocation draws from unrestricted pool capacity. It
              │   does not require a formal round. Donors will see capacity consumed
              │   in their pledge summary, but not the recipient's identity unless the
              │   need is public-tier."
              ├─ "Confirm allocation" → fires emitPledgedTotalAssertion + DisbursementAssertion
              │   (Phase 3: also fires USDC.transfer)
              └─ Success state: "Allocation recorded. The beneficiary has been notified."
                   CTAs: "Allocate another →" | "Back to pool →"
```

**Empty state on need picker:** "No open needs match this pool's mandate kinds. Check the Discover tab for all posted needs, or expand the pool's mandate."

**Error states:**
- Insufficient capacity: "This pool has $X available after accounting for restricted pledges. Reduce the allocation amount."
- Need already addressed (liveAcknowledgementCount >= threshold): "This intent has already been matched. It is no longer accepting allocations."
- Steward not eligible (StewardEligibilityRegistry returns false): "Your steward access to this pool has been updated. Reload the page to continue."

**Loading state:** Skeleton matching PoolCard layout while need-list fetches. The amount field stays disabled until pool.availableCapacity has resolved.

---

### Donor Visibility: Capacity Consumption

Modify `/h/[hubId]/pledges/[pledgeId]` (file: `apps/web/src/app/h/[hubId]/(hub)/pledges/[pledgeId]/page.tsx`):

Add a "How your capacity has been used" section below the current pledge detail.

**Component: `<PledgeAllocationHistory pledgeId unit />`** (new server component)

Renders a list of allocations drawn against this donor's capacity, sorted newest-first:

```
[date]  [mandate kind chip]  [amount + unit]  [story text if storyPermissions = 'public']
                                               "Anonymous need met" if storyPermissions = 'anonymous'
```

Copy for anonymous row: "A need in [mandate kind] was met using part of your capacity. The recipient chose not to share their story." — honest, no false detail.

If the donor set `storyPermissions = 'public'` at pledge time, the allocation row links to the beneficiary's intent detail. If anonymous, no link.

**Empty state:** "No capacity has been drawn from this pledge yet." Do not show zero-state with placeholders — avoid suggesting disbursements happened when they have not.

---

### Beneficiary Visibility: Allocation Received

Modify `/h/[hubId]/intents/[id]` (file: `apps/web/src/app/h/[hubId]/(hub)/intents/[id]/page.tsx`):

When `sa:DisbursementAssertion` exists referencing this intent's IRI, render an `<AllocationReceivedBanner />` directly below the intent header, above the candidate list.

**Component: `<AllocationReceivedBanner amount unit poolLabel disbursedAt />`**

Visual: teal left-border card (success-adjacent tone; do not use accent brown — this is informational not action-requiring).

Copy: "A pool has allocated [amount] [unit] toward this need. [poolLabel] disbursed this on [date]. If you have questions, contact the pool's steward."

If Phase 3 is live (real USDC): append "Funds were transferred to your receiving address."

**Empty + loading:** no banner renders until the assertion resolves. Wrap in Suspense.

---

### Information Architecture

- Allocation body (steward note, recipient identity, exact donor breakdown) stays in org-mcp. Never anchored on-chain unless the need intent is public-tier.
- The `sa:DisbursementAssertion` carries `poolAgentId`, `amount`, `unit`, `recipientAgentIRI`, `sourceProposalIRI` (or `sourceIntentIRI` for direct allocation). Beneficiary IRI is the only recipient identifier on-chain; no name.
- Donor sees capacity consumed but not recipient identity unless both parties opted into public attribution.

### Open Questions (Phase 2.7)

- **PM:** Does discretionary allocation bypass the 72h dispute window, or does it still apply? The tech plan applies TimestampEnforcer to SESSION_DELEGATION, but discretionary allocations may not need a formal round close to trigger it.
- **Security:** If a steward can allocate without a round, is the StewardEligibilityEnforcer check sufficient, or should there be an additional on-chain guard (e.g., AllocationLimitEnforcer per calendar month)?
- **PM:** What is the max allocation a steward can make in a single discretionary action? A per-action cap (e.g., 20% of pool capacity) feels right to prevent one steward from draining a pool unilaterally.
- **IA:** Where does the allocation body (steward note) live? Org-mcp seems right, but which table?

---

## Phase 3 — Real USDC Custody

### Goal and Users

Pledge and disbursement flows move real USDC. Three signing surfaces appear: donor signs a userOp to transfer USDC to the pool; stewards sign N-of-M EIP-712 over AllocationDecided; lead steward triggers tranche disbursement after the dispute window. Recipients receive funds and need to be told they arrived.

---

### 3.1 Donor USDC Pledge — Signing Flow

**Modify:** `/h/[hubId]/pools/[poolId]/pledge` (existing `PledgeComposer.tsx`)

After the donor confirms pledge details (amount, cadence, restrictions), the confirmation step gains a signing sub-step.

**New confirmation step layout:**

```
Pledge summary (existing) — amount, cadence, mandate, attribution

┌─────────────────────────────────────────────────────────────┐
│ Sign to transfer funds                                      │
│                                                             │
│ To complete your pledge, you will sign one transaction:     │
│                                                             │
│  • Transfer [amount] USDC to the [pool name] treasury       │
│    (address: 0x…)                                           │
│                                                             │
│ Gas for this transaction is sponsored — you pay no ETH fee. │
│                                                             │
│ [Sign pledge]                                               │
│                                                             │
│ This uses your Smart Agent wallet. Your pledge amount stays │
│ in the pool treasury until the stewards disburse it.        │
└─────────────────────────────────────────────────────────────┘
```

**States:**

- **Waiting for signature:** "Waiting for your signature… Your wallet may have opened. If not, tap the prompt again."
- **Bundler submitting:** spinner + "Sending to network…"
- **Confirmed:** check icon + "Your pledge is live. [amount] USDC is now in the [pool name] treasury." CTAs: "View your pledges →" | "Back to pool →"
- **Rejected (user denied):** "Signature declined. Your pledge was not recorded. You can try again or close." Action: "Try again" button.
- **Network error:** "The transaction could not be submitted. This can happen if the network is busy. Your funds have not left your wallet." Action: "Retry" | "Cancel pledge".
- **Insufficient balance:** "Your wallet holds [X] USDC. The minimum pledge for this pool is [Y] USDC. Please top up your wallet first." — no "Retry"; must resolve externally.

**Copy constraints:** "Sign pledge" not "Sign transaction." "Treasury" not "smart contract." "Sponsored" not "gasless" — "gasless" is informal and raises more questions than it answers.

**Accessibility:** Focus moves to the "Sign pledge" button when the signing step mounts. The loading spinner has `aria-live="polite"` so screen readers hear status changes. The treasury address is in a `<code>` element but the button is 44px min-height.

**Security flags for Security agent:**
- Paymaster/bundler infra must be production-ready before this UI ships.
- The treasury address shown in the disclosure must be verified server-side (not passed from client state) to prevent address-substitution.
- Gas sponsorship policy: is there a per-user cap? What happens when the paymaster budget runs out mid-flow? Need a graceful degradation (fall back to user-pays-gas path with disclosure).

---

### 3.2 Steward N-of-M Signature Collection

This is an async multi-actor flow spanning hours to days. Two new surfaces are needed.

#### New Page: Steward Signature Hub

**Route:** `/h/[hubId]/rounds/[roundId]/award` (steward-only, behind role check)

**Purpose:** After the lead steward closes a round and `AllocationDecided` fires, each co-steward is prompted to sign here before the funds can disburse.

**Component: `<AwardSigningPanel roundId poolAgentId signers threshold signaturesCollected />`**

Layout (mirrors `CloseRoundForm.tsx` visual language — white card, border `#ece6db`, accent `#8b5e3c`):

```
STEWARD ACTION — COLLECT SIGNATURES             [badge: N/M signed]

Award [round name] — [total amount] [unit]
Signed off by [pool name] stewards

Stewards needed: ━━━━━━━━░░  N of M signed
                 ├─ [steward A] ✓ Signed  [timestamp]
                 ├─ [steward B] ✓ Signed  [timestamp]
                 └─ [steward C] ● Pending  [Remind →]

[Sign this round's allocation]     (shown if viewer is a steward and hasn't signed)
[Submit for disbursement]          (shown when threshold met; disabled until window passes)
```

"Sign this round's allocation" opens an EIP-712 prompt via the viewer's AgentAccount. After signing, the panel refreshes to show the steward's checkmark without a full page reload.

**"Remind" action:** sends an in-app notification (see cross-cutting section). Copy: "Reminder sent" toast. Does not re-send if already pending within 4h.

**Dispute window indicator** (same page, below signing panel):

```
Disbursement window
━━━━━━━━━━━━━━━━░  Opens in 48h 12m
Award decisions were confirmed on [date]. Funds will disburse no earlier than [date+time].
[Raise a concern →]  (links to dispute filing)
```

If window has passed: "Window closed [date]. Disbursement is now available."

**States:**
- **Loading:** skeleton matching panel layout, no spinner on the full page.
- **Threshold met + window open:** "Disbursement ready. N of M stewards have signed. The dispute window closed on [date]." → "Disburse tranche 1" button active.
- **Round canceled/revoked:** replaced by a `<RoundCanceledBanner />` (red-left-border card; copy: "This round's allocation was canceled on [date]. No funds will disburse."). The signing panel is hidden.

#### Modification: Round Detail Page

**File:** `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/page.tsx`

When the round is in `closed` / `allocated` status and the viewer is a steward, add a `<StewardSignatureCallout roundId signaturesCollected threshold />` component in the steward-actions zone (above the existing `CancelRoundButton`).

Copy: "N of M stewards have signed the award. [Review and sign →]" — links to `/rounds/[roundId]/award`.

If the viewer is not a steward, no callout renders.

---

### 3.3 Tranche Disbursement

**Route:** `/h/[hubId]/rounds/[roundId]/disburse` (steward-only; new page)

Triggered when: threshold met + dispute window elapsed + SESSION_DELEGATION valid.

**Page: `<DisbursementPage />`** (Server Component shell, `'use client'` form inside)

Layout:

```
Ready to disburse                                    [pool name]
Round: [round name]

Awards
  [recipient A]  Tranche 1 of 2  [amount] USDC  [Disburse →]
  [recipient B]  Tranche 1 of 1  [amount] USDC  [Disburse →]
  [recipient C]  Tranche 2 of 2  [amount] USDC  [Waiting: milestone required]

Pool balance after disbursement: [current] → [projected]
```

"Disburse" button triggers `treasuryDisburse.action.ts`. On success, the row flips to a success state: "Sent [date] · tx 0x…" with a block-explorer link. On failure, the row shows an error inline with "Retry" — does not lose the rest of the table state.

**Waiting rows:** when a tranche requires a milestone attestation before it can release, the row shows "Waiting: milestone required" in muted text. No "Disburse" button is rendered. This communicates the constraint without a cryptic disabled-button.

**Pool balance widget** — real balance, not a counter. Source: `sa:PoolPledgedTotalAssertion`. Rendered as:

```
Pool treasury
  Total pledged:   $24,000
  Allocated:        $6,500
  Available:       $17,500   ← displayed in larger weight
```

Stale-data caveat: during GraphDB sync windows, the balance may lag by up to 60 seconds (see Phase 3-Cleanup section). A `<SyncAgeIndicator lastSyncAt />` component renders "Balance as of [X min] ago" when lag > 30s.

---

### 3.4 Recipient Onboarding

When `sa:DisbursementAssertion` fires for a recipient, two surfaces update:

1. **Beneficiary's intent detail** — `<AllocationReceivedBanner />` as specified in Phase 2.7.
2. **In-app notification** — a new notification type `disbursement_received` in the notification inbox (see cross-cutting section). Copy: "[Pool name] has transferred [amount] [unit] toward your [intent title]. View details →"

**Claim flow for external recipients** (recipients without an existing Smart Agent account):

The `sa:DisbursementAssertion` carries `recipientAddr`. If that address has no associated Privy user, the lead steward can share an invite link: `/claim/[disbursementId]`.

**Route:** `/claim/[disbursementId]` (public, no auth required to view)

This page shows:
- "A grant has been sent to your wallet address [0x…]"
- "If you control this address, connect your wallet to claim access to your Smart Agent profile."
- Privy "Connect wallet" button.
- After connecting: redirect to `/h/[hubId]/intents/[id]` with the AllocationReceivedBanner visible.

**Empty/error states:**
- Invalid disbursementId: "This link is not valid or has expired." No further detail (no information leakage about private proposals).
- Already claimed: "This disbursement was already claimed by the account connected to this wallet."

---

### Open Questions (Phase 3)

- **Security:** What happens if the bundler fails mid-multiSend (USDC.transfer succeeds but ClassAssertion.emit fails)? The MultiSendCallOnly is supposed to be atomic — but the team needs a test that explicitly checks the atomicity guarantee across a real anvil node.
- **Security:** Treasury address disclosure in the pledge signing step must be generated server-side and passed as a signed token, not a client prop, to prevent address-substitution attacks.
- **PM:** Is there a per-tranche minimum for USDC transfers? Below a threshold (e.g., $10), gas cost may exceed disbursement value even on Base. Define the floor and surface it in the round-close form as a validation.
- **PM:** Who pays gas for the disbursement userOp — the pool's AgentAccount, a shared paymaster, or the lead steward? This determines whether the "Gas sponsored" disclosure applies here too.
- **Security:** The `/claim/[disbursementId]` route is public. What prevents someone from brute-forcing disbursementIds? The ID should be an opaque 256-bit token, not a sequential integer or a short IRI.
- **PM:** Can a donor revoke a USDC pledge after the funds have been transferred to the pool treasury? "Stop pledge" currently halts future cadence payments; it cannot claw back transferred funds. This needs explicit user-facing copy and a help link.

---

## Phase 3 Cleanup — Chunked SPARQL UPDATE

### UX Side: Stale-Data Communication

The chunked SPARQL UPDATE work is mostly invisible to users (faster renders). One narrow case surfaces: immediately after a steward action (close round, disburse tranche), the GraphDB mirror may lag by up to 60 seconds before the new state appears on read pages.

**Pattern: `<ActionLandedBanner />`** (new shared component)

Render this on the page the user lands on after a write action, when the action was a write-heavy operation (round close, disbursement, pledge). It uses URL search params to signal "just wrote" without state.

Route convention: after a successful write, redirect to `…?updated=1`.

When `updated=1` is present in search params, `<ActionLandedBanner />` renders for 10 seconds then fades out:

```
Your changes are being recorded. It may take up to a minute for
counts and summaries to reflect this update.           [×]
```

Dismiss button clears `updated` from the URL. The banner does not re-render on the next navigation.

**Where to add it:**
- Round detail page (`/rounds/[roundId]`): after `CloseRoundForm` success redirect.
- Pool detail page (`/pools/[poolId]`): after pledge submit success.
- Disbursement page (`/rounds/[roundId]/disburse`): after each tranche disburse.

**What not to do:** do not show a countdown timer ("refreshes in 52s"). It creates anxiety and suggests the UI is broken. The soft "up to a minute" framing is accurate and calm.

**Pool capacity widget stale indicator:** when `sa:PoolPledgedTotalAssertion.emittedAt` is more than 90 seconds old relative to the page load time, the `<SyncAgeIndicator />` component shows "Balance updated [N] min ago" in muted text beneath the capacity figures. This is informational, not alarming.

---

## Phase 4 — Outcomes, Rescission, Validators, Reputation

### 4.1 Outcome Attestation

**New Route:** `/h/[hubId]/disbursements/[disbursementId]/attest` (validator-only)

Validators reach this page from: (a) in-app notification "You have been invited to validate outcome for [round name]", or (b) the validator assignment panel on the round detail page.

**Component: `<OutcomeAttestationForm disbursementId proposalTitle recipientLabel />`**

```
Validate outcome                              [round name] / [recipient]

What was the outcome?
  ○ Delivered          — The funded goal was fully achieved
  ○ Partial delivery   — Significant progress; goal partially met
  ○ Not delivered      — Funded goal was not achieved
  ○ Disputed           — I have concerns that need review

Quality (optional)  ★ ★ ★ ★ ☆   (1–5 stars)

Evidence (optional)
  [Upload document or paste URL]
  Max 5 files. PDFs, images accepted.

Note (optional)
  [Text area, 600 char max]

[Submit attestation]
```

"Disputed" selection expands a mandatory note field: "Describe the concern. This will be visible to the pool stewards and may initiate a rescission review."

**Copy for outcome labels:** "Delivered," "Partial delivery," "Not delivered," "Disputed" — not "Successful," "Failed." The former are factual; the latter carry unnecessary moral weight.

**States:**
- **Already attested:** "You submitted an attestation on [date]. View it →" — no re-submit available (v1).
- **Not a validator:** 403 surface — "You have not been invited to validate this disbursement. If you believe this is an error, contact the pool stewards."
- **Disbursement not yet finalized:** "Attestation is available once disbursement is confirmed on-chain. Come back after [date]."

**Accessibility:** star rating uses `<fieldset>` + `<legend>` + radio inputs, not a custom click handler. Each radio has a visible label. Keyboard navigable.

---

### 4.2 Proposer Track Record

**Modify: Proposer profile page** (wherever individual agent profiles render — likely `/profile/[agentId]` or within hub context at `/h/[hubId]/people/[agentId]`).

Add a `<ProposerTrackRecord agentId />` section (server component, reads GraphDB `sa:ProposerTrackRecord` projection from outcome attestations).

```
Grant track record
  Fulfilled:         4 grants
  Partial delivery:  1 grant
  Not delivered:     0 grants
  Disputed:          0 grants

  Match rank signal: strong  (explained tooltip)
```

Tooltip copy for "Match rank signal": "Your past delivery record influences how stewards rank your proposals. More fulfilled grants improve your ranking in future rounds. This is calculated from validator attestations, not from self-reported outcomes."

**Modify: Proposal review list** — `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/(steward)/proposals/page.tsx`

For each proposal row, add a small track-record badge next to the proposer name:
- 3+ fulfilled, 0 disputed: green "Proven track record"
- 1–2 fulfilled: amber "Some history"
- No history: grey "First proposal"
- Any disputed: amber badge with warning icon "Dispute on record — review"

Badge copy is terse (≤ 3 words) because this is a data-dense steward list. Full detail links to the proposer's profile.

---

### 4.3 Rescission Flow

**Trigger:** steward sees a "Disputed" attestation, or steward decides unilaterally to rescind an award before tranche 2+ disburses.

**Route:** `/h/[hubId]/rounds/[roundId]/awards/[proposalId]/rescind` (steward-only)

**Component: `<RescissionForm proposalId totalDisbursed tranches />`**

```
Rescind award                                  [proposal title] / [recipient]

Disbursed so far:  [amount] [unit]   (cannot be clawed back in v1)
Remaining tranches: [list of undisbursed tranches]

Reason for rescission
  ○ Outcome not delivered — validator attestation supports this
  ○ Fraud or misrepresentation
  ○ Recipient request
  ○ Other

Reason detail (required)
  [Text area]

This action will:
  • Cancel the remaining [N] tranches — no further funds will disburse
  • Emit a public record that this award was rescinded
  • Open a dispute record that will appear on the recipient's track record

[Confirm rescission]   [Cancel]
```

**Disclosure copy** is non-negotiable — the user must see what a rescission does before confirming. No collapsed/accordion here.

**Dispute window indicator** on rescission form: "Awards can only be rescinded within the dispute window OR after a confirmed outcome dispute. This award's dispute window [opened/closed] on [date]." If outside window and no validator dispute: disable the form with explanatory copy rather than silently failing.

**States:**
- **Within dispute window:** form fully active.
- **Outside window, no dispute:** form disabled. "The dispute window for this award closed on [date]. Rescission is only available when a validator has filed a dispute record. Contact the pool admin if you believe this is an error."
- **Rescission already filed:** "A rescission record was filed on [date]. No further action is needed."

**After submission:** redirect to the round's award list with a `<RoundCanceledBanner />` variant for the specific proposal row: "Award rescinded — [date]. Remaining tranches will not disburse."

---

### 4.4 Reputation Feedback Visibility for Proposers

When a proposer views their own proposal detail (`/h/[hubId]/proposals/[proposalId]`), and an outcome attestation exists, add an `<OutcomeAttestationSummary />` section at the bottom.

```
Outcome record
  Validator: [validator label or "Anonymous validator"]
  Result: Partial delivery
  Quality: ★★★☆☆
  Attested: [date]

  This outcome influences your match rank in future rounds.
  [Learn how ranking works →]
```

"Learn how ranking works" opens a modal or help article (PM to confirm). The formula (`0.6 * 1/(1+hops) + 0.4 * (fulfilled+1)/(fulfilled+abandoned+2)`) does not appear verbatim in the UI — it is described as "proximity to the pool's network" and "your delivery history."

---

## Cross-Cutting UX Patterns

### Notification Inbox and Badge Counts

All multi-day async flows (sig collection, dispute window, attestation invite) require an in-app inbox. This does not exist yet.

**Proposed surface:** a bell icon in the hub nav header with a badge count. Clicking opens an `<InboxPanel />` slide-out.

**Notification types and copy:**

| Type | Copy | Action |
|---|---|---|
| `sig_requested` | "Your signature is needed on [round name] allocation" | → `/rounds/[roundId]/award` |
| `sig_reminder` | "[Steward B] reminded you to sign [round name]" | → `/rounds/[roundId]/award` |
| `threshold_met` | "[Round name]: all stewards have signed. Disbursement ready." | → `/rounds/[roundId]/disburse` |
| `dispute_window_closed` | "Dispute window closed for [round name]. You may now disburse." | → `/rounds/[roundId]/disburse` |
| `disbursement_received` | "[Pool name] sent [amount] toward your [intent title]" | → `/intents/[id]` |
| `validation_invite` | "You've been asked to validate [round name] / [recipient label]" | → `/disbursements/[id]/attest` |
| `rescission_notice` | "An award in [round name] was rescinded" | → `/rounds/[roundId]` |

Badge count: total unread notifications, capped at display of "9+" to avoid layout breakage.

**Open question for PM:** is email notification required at launch, or is in-app inbox sufficient for Phase 3? The sig-collection flow especially benefits from email because stewards may not check the app daily.

---

### Trust Signals: Where and When

**Pool browse** (`/h/[hubId]/pools`): add a `stewardDeliveryRate` badge on each `PoolCard` when the pool has at least one prior cycle with outcome data. Format: "92% delivered · 3 prior cycles". Source: GraphDB `sa:ProposerTrackRecord` aggregated per pool's award history.

**Pool detail** (`/h/[hubId]/pools/[poolId]`): expand to a `<PoolTrustBlock />` section:

```
Steward track record
  Prior cycles:     3
  Awards given:    12
  Delivery rate:   92%   (11 of 12 delivered or partial)
```

Empty state: "This pool is new — no prior awards to report." Do not show 0% when there is no data.

**Proposal review list** (steward view): proposer track record badge as specified in 4.2.

**Round apply page** (`/apply`): existing header already shows round name, description, kind chips. Add "Pool steward delivery rate" as one of the metadata chips. Proposers deserve to know who will be judging their application.

---

### Dispute Filing — External Path

Currently there is no UI for a third party to challenge an award. "Cancel Round" button exists for stewards; that is internal. An external dispute filer (any hub member, or any validator) needs a path.

**Proposed surface:** a "Raise a concern" link on the `<DisputeWindowBanner />` that appears on round detail after `AllocationDecided`. It links to:

**Route:** `/h/[hubId]/rounds/[roundId]/disputes/new`

Simple form:
- Who is filing (read-only: viewer's agent label)
- Concern type: "Process concern" / "Eligibility concern" / "Outcome concern" / "Fraud concern"
- Detail (required, 100–2000 chars)
- Supporting evidence URL (optional)
- "Submit concern"

On submit: creates a `AgentDisputeRecord` (existing contract). The dispute record appears on the round detail page under a "Filed concerns" section visible to stewards only (not the proposer, to protect the filing process).

**Validator discovery:** validators are invited by stewards through the round detail page. Add an "Invite validator" button on the steward view of the award list that sends a `validation_invite` notification to a selected hub member. The invited member appears in the "Validators" section of the disbursement detail with a "Pending" badge until they attest.

---

### Currency and Unit Display

Mixed-unit pools (USDC + coaching-hours + prayer-minutes) must display cleanly without confusion.

**Convention:**

- USDC: always "$N,NNN" format. Never "N USDC" in body text (reads oddly). Use "USDC" only in technical disclosure contexts (e.g., "Transfer [N] USDC to the treasury").
- Coaching-hours: "N coaching hrs"
- Prayer-minutes: "N min of prayer"
- Generic non-monetary: "[N] [unit label]" — unit label comes from the pool's `acceptedUnits` field, displayed as-is.

**Capacity widget convention** (for Phase 3 real balance):

```
Pool treasury
  Pledged:    $24,000         12 coaching hrs
  Allocated:   $6,500              0 coaching hrs
  Available:  $17,500         12 coaching hrs
```

Each unit type gets its own row. Do not sum unlike units into one figure. Do not show a "Total" line that would require cross-unit equivalence.

**Zero state:** if available = 0 for a unit type, show the row in muted text. Donors and proposers need to know a pool is full; hide nothing.

---

## Developer Handoff Notes

- **Phase 2.7 need picker** is a server component that calls `listIntents({ mandateKinds: pool.acceptedKinds, status: 'expressed' | 'acknowledged' })`. No new action is needed if `listIntents` already supports `mandateKinds` filtering; confirm with developer.
- **AwardSigningPanel** must be `'use client'` — it polls for signature count changes. Polling interval: 15s, using `useEffect` + a lightweight `fetch('/api/treasury-proposals/[roundId]/status')` endpoint. Do not use WebSocket for v1.
- **ActionLandedBanner** reads `searchParams.updated` — since it is a Server Component context, it reads `params.searchParams.updated` directly and passes it down as a prop to a `'use client'` fade-out wrapper. The fade-out is CSS `@keyframes` opacity 1→0 over 400ms after a 9600ms delay (10s total visible).
- **Notification inbox** is the largest new surface. Recommend building it as an independent Server Action that returns a flat list, with a `'use client'` badge counter in the nav. Badge count can be a lightweight GET to `/api/notifications/count` on each page load (SSR), not a real-time subscription — acceptable for Phase 3.
- **Claim route** (`/claim/[disbursementId]`) must be added to the root `app/` directory, not inside `h/[hubId]` — it is pre-auth.
- **ProposerTrackRecord** reads from GraphDB via `DiscoveryService`; this is a Server Component. Do not fetch it client-side.
- **Dispute filing form** at `/rounds/[roundId]/disputes/new` can share the same visual shell as `CloseRoundForm.tsx` — white card, border `#ece6db`, accent heading, error state pattern.
- **BlockExplorer links** for disbursement transactions: use the chain's block explorer URL configured in env (`NEXT_PUBLIC_EXPLORER_URL`), not hardcoded Etherscan. Base's explorer is `basescan.org`.
- **Pool capacity widget** switches from the existing aggregate-counter read to `sa:PoolPledgedTotalAssertion` event data in Phase 3. Build the Phase 2.7 widget to accept either source behind a feature flag so Phase 3 can flip it without a layout change.
