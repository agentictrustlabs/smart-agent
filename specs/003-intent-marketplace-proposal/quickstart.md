# Quickstart — Intent Marketplace (Proposal Lane)

End-to-end walkthroughs exercising User Stories 1–5 against the seeded demo hub. Two flows: proposer (Stories 1–3, 5) and steward (Story 4, steward-side).

## Setup

```bash
./scripts/fresh-start.sh
pnpm dev
```

Seed expects:
- The **NoCo Trauma-Care Fund** (typed `sa:Fund subClassOf sa:Pool` with `sa:governanceModel "fund"`) carrying `sa:acceptsOpenCalls "true"`.
- An **open round** "NoCo Q2 Trauma-Care Cycle 2026" operated by the fund (`sa:operatedByFund <noco-trauma-care>`), deadline 14 days out, mandate `{ acceptedKinds: ['trauma-care'], acceptedGeo: ['us/colorado'], budgetCeiling: 250000, expectedAwards: 6 }`. Anchored on chain at seeding via `sa:RoundOpenedAssertion`.
- **Maria** signed in with an existing `NeedIntent { kind: 'trauma-care', geo: 'us/colorado', amount: 50000 }` — i.e., Maria's org has expressed this intent (so the GrantProposal lives in Maria's org-mcp).

## Flow A — Proposer

### A1. Browse open rounds

`http://localhost:3000/h/catalyst-noco/rounds`

Expected:
- Index reads from the GraphDB public mirror (`sa:RoundOpenedAssertion` triples) via `@smart-agent/discovery`.
- The Q2 round appears with a `✓ matches your trauma-care intent` badge (per FR-001 / R2).
- Filter chips: domain, deadline horizon, budget range, free-text, "include closed rounds".

Apply `deadline = closing this month`. The Q2 round still appears.

### A2. Round detail

Click the round.

Expected:
- Mandate, eligibility (geo, requiredCredentials inline against Maria's credential set), budget envelope, milestone template, validator requirements, reporting cadence (`sac:ReportingCadenceQuarterly`), deadline + decision date, prior stats (`first cycle — no prior data` if seed is new, otherwise the actual `awarded/received · median $`).
- For private rounds, the addressed-applicants list comes from the fund's org-mcp via `round:read_addressed_list` cross-delegation (per IA § 2.4).

### A3. Draft & submit — write path

Click **Submit a proposal**.

Compose:
- Budget: 4 line items totalling $50,000.
- Plan: narrative.
- Milestones: 3 items (kickoff $15k / mid $20k / completion $15k) per the round's milestoneTemplate hints.
- Desired outcomes: 3 items with measurables and validator agentIds.
- Reporting obligations: `quarterly · written+financial`.
- Organisational background: 2-paragraph narrative.

Submit.

Expected sequence (per IA § 2.3):

1. **MCP write** — POST to `/h/catalyst-noco/rounds/<id>/apply` routes to Maria's org-mcp `grant_proposal:submit` tool, which writes a row to the `proposal_submissions` table on Maria's org-mcp (Maria's org is the proposer → her org-mcp is the body owner; `principal = mariaOrgAgentId`). The row's `version: 0`, `status: 'submitted'`.
2. **NO on-chain anchor** — the row carries no `onChainAssertionId` and never will in v1. SHACL `sa:GrantProposalAlwaysPrivateShape` would fire on any sync attempt.
3. **NO GraphDB mirror** — the proposal IRI never appears in GraphDB.
4. **Counter increment** — Maria's org-mcp issues `round:increment_proposals_received` system-delegation to the fund's org-mcp; the fund's tenant bumps `sa:proposalsReceived` by 1.
5. **Ack-count primitive** (IA § 3.10) — Maria's org-mcp issues `intent:bump_ack_count` (delta +1) system-delegation to the intent's owning MCP (Maria's org-mcp again, in this case — same tenant). The intent transitions `expressed → acknowledged` on the 0→1 edge.
6. **Steward read access** — Maria's org-mcp issues `proposal:read_for_review` cross-delegation to the round's stewards (= the fund's pool-agent's org-mcp tenant), scoped to this single round, time-bound until terminal state.
7. **Confirmation** — page shows the steward `decisionDate`.

### A4. Edit pre-deadline

Open the proposal in `/h/catalyst-noco/proposals/<id>`.

Edit a milestone description.

Expected:
- Maria's org-mcp `grant_proposal:edit_pre_deadline` validates `now <= round.deadline` against the round body in the fund's org-mcp.
- Row's `sa:version` becomes 1, `sa:lastEditedAt` updated.
- Steward's view (`grant_proposal:list_for_round` federated through `proposal:read_for_review`) reflects the latest version on next read.

### A5. Withdraw

Click **Withdraw**.

Expected:
- Row's `sa:proposalStatus sac:GrantProposalStatusWithdrawn`, `sa:withdrawnAt` set.
- `Round.proposalsReceived` decrements via the corresponding system-delegation to the fund's org-mcp.
- **`liveAcknowledgementCount` decrement** — Maria's org-mcp issues `intent:bump_ack_count` (delta -1) to the intent owner's MCP (per IA § 3.10).
- Per FR-023: the intent's MCP transitions `acknowledged → expressed` only when the count hits 0 — meaning if a still-pending spec 001 `MatchInitiation` exists on the same intent, the intent stays `acknowledged`.
- Result: `WithdrawGrantProposalResult.intentRevertedToExpressed: true | false` reflects the count-hit-zero check.

### A6. Clone into a different round

In "Your proposals", click **Clone**.

Expected:
- A new draft GrantProposal row is created in Maria's org-mcp with `clonedFromProposalId` set; `submittedAt` unset; `status: 'draft'`.
- All non-state fields copied; outcomes / awards / review state are NOT carried.
- The proposer can re-target a different round, edit, and submit.

### A7. Open-call submission (Q5)

For a fund with `sa:acceptsOpenCalls "true"`, submit a proposal directly to the fund (without a round).

Expected:
- `roundId: null`, `fundMandateId: <fund>` (the predicate `sa:fundMandate` resolves directly to a `sa:Fund` — no separate Mandate entity).
- Eligibility checked against `fund.mandate` directly.
- For a fund with `sa:acceptsOpenCalls "false"`: submission rejected with the `'open-call-not-accepted'` error.

## Flow B — Steward

Sign in as a fund steward.

`http://localhost:3000/h/catalyst-noco/rounds/<round-id>/proposals`

Expected:
- The fund's org-mcp federates queries across each submitting proposer's MCP using each proposer's `proposal:read_for_review` cross-delegation. **No GraphDB read** — proposals are not in GraphDB. Aggregation happens in the action layer per IA P5.
- Proposals on the round appear ranked by `stewardSideSignals` per Q2: closer + better-prior-record proposers first.
- Each row shows the rank cue: `1 hop · 9 fulfilled / 1 abandoned`.
- Rank ties break on `submittedAt` desc.

This view is read-only here; review/decision/award flow is the downstream spec.

## What this exercise covers

| Spec element | Step |
|--------------|------|
| Story 1 (browse rounds + match badge) — public mirror via discovery | A1 |
| Story 2 (round detail + credentials inline) | A2 |
| Story 3 (draft & submit; private write to proposer's MCP; no on-chain; no GraphDB; cross-delegation issuance) | A3 |
| Story 4 (steward-side rank — federated read across proposer MCPs) | B |
| Story 5 (manage: edit / withdraw / clone) | A4–A6 |
| Q3 (one-Round constraint, clone path) | A6 |
| Q4 (pre-deadline editing) | A4 |
| Q5 (open-call eligibility) | A7 |
| FR-023 (withdrawal reverts intent only when no other live acknowledgements — `liveAcknowledgementCount` primitive shared with spec 001) | A5 |
| Class rename `ProposalSubmission` → `GrantProposal` (Audit § 2 O1) | throughout |
