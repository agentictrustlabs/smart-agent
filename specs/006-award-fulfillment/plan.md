# Spec 006 — Match Fulfillment (Commitment) — LOCKED Plan v1

> **The universal "match → resource transfer → outcome" artifact.** Any path
> that pairs a NeedIntent with resources — grant award (spec-003), direct
> intent match (spec-001 `MatchInitiation`), pool pledge acceptance
> (spec-002 `PoolPledge`), or any future lane — produces a `sa:Commitment`.
> The commitment carries fulfillment terms (milestones, tranche schedule),
> moves USDC from donor → recipient as terms are met, and records outcomes
> against the original NeedIntent.
>
> Spec-003 is the most structured entry (rounds, proposals, votes, milestones
> from the proposal body); spec-001 is the simplest (single-tranche
> "transfer on accept"); spec-005's pledge honor remains the donor→pool
> rail and stays orthogonal. Builds on spec-004 (anoncreds gating).

> **Cross-cuts**: follows `docs/architecture/principles.md`.
> - **P1** — own substrate. CommitmentRegistry is ours, not a Sablier/Disco fork.
> - **P2** — chain is source of truth for commitment + disbursement state.
> - **P4** — release path uses exact-call sub-delegation (executeBatch).
> - **IA P4** — commitment ledger is on chain; GraphDB mirrors via on-chain → KB sync; no MCP → GraphDB pipe.

---

## Goals + Invariants

- **Commitment is universal.** Every "match → resources move" pathway produces the same artifact (`sa:Commitment`), regardless of whether the upstream lane was a grant round, a direct intent match, or a pool pledge acceptance. The downstream rail (release, attestation, outcome, cascade) is identical.
- **Match commits, releases pay.** A commitment can exist without payout; payout happens tranche-by-tranche; both states reified on chain.
- **One commitment per (donor, source artifact).** The source subject (proposal / matchInitiation / poolPledge) plus the donor uniquely keys a commitment. Co-funding = multiple commitments sharing the same source.
- **Need-intent link survives every lane.** Whatever the upstream lane, `commitmentNeedIntent` is set; the trust graph can always say "intent X was fulfilled by commitment Y."
- **Intent is the front door.** Whoever expressed the original need reads the intent detail page; that page surfaces every downstream artifact (matched proposals / match initiations / pool pledges → commitment → tranche releases → outcomes) without forcing them to navigate sideways. The intent identity panel stays at the top; fulfillment is appended, not substituted.
- **Recipient is resolved, not assumed.** `sa:hasTreasury` (org) or `sa:hasPersonalTreasury` (person) is read first; self-fallback only if neither is set. No more "fall back to fundAgent."
- **Donor signs releases.** The commitment names a `donor` AgentAccount — whoever owns the donor signs releases. For grant-lane commitments donor = pool (pool steward signs). For direct-lane commitments donor = the offerer (offerer signs). One auth gate (`canManageAgent(donor, signer)`), three lanes.
- **Validator attestation is advisory.** Validator attestation is data; release is a donor-side signature. Same mental model as round-vote-then-close. Auto-quorum + optimistic-claim deferred to v2.
- **Rail A only in v1.** Donor's AgentAccount.executeBatch([USDC.transfer, CommitmentRegistry.recordRelease]) — atomic, single tx, mirrors spec-005.
- **Anonymous parties can't be paid in v1.** If either donor or recipient principal can't resolve to an AgentAccount (pure-nullifier match), the commitment is created with `status = ReleasesBlocked` and the missing party recorded as 0x0; closing requires resolving the missing party first.
- **Single-tranche is a first-class shape.** A direct intent match settling instantly ("you need $200, I send $200") is just a commitment with `milestones = [{ id: 'single', label: 'On accept', trancheBps: 10000 }]` released in one batch. No special-case code paths.

## Locked Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Where does commitment object live? | **New `CommitmentRegistry`** (AttributeStorage subclass; class = `sa:Commitment`). Mirrors PledgeRegistry pattern. Universal across all source lanes. |
| 2 | Who triggers a tranche release? | **Donor's owner signs after (optional) validator attestation.** Validators advise; humans recover. (Auto-quorum + optimistic-claim deferred to v2.) |
| 3 | How is recipient treasury declared? | **`sa:hasTreasury` predicate** on AgentAccount, with self-fallback. Symmetric with spec-005's `sa:hasPersonalTreasury`. |
| 4 | Where does the disbursement record live? | **On-chain in `CommitmentRegistry`**, mirrored to GraphDB by on-chain → KB sync. The off-chain `disbursements` table is **dropped** in v1; existing rows are not migrated (fresh-start re-seeds). |
| 5 | Need-intent link preservation | Every entry path stamps `commitmentNeedIntent`: grant lane copies it forward from proposal + `ProposalRegistry.announceAward` gains `needIntentId` param; direct lane reads it from `MatchInitiation.viewedIntent`; pool pledge reads it from the pledge body's targeted need (when present, otherwise the field is empty for "general-purpose pledge"). |
| 6 | Tranche schedule | **Stored as `commitmentMilestonesJson`** — JSON array of `{ id, label, trancheBps, status }`. Sum of `trancheBps` must equal 10000 (validated on commit). Released amount per milestone derived as `totalAmount * trancheBps / 10000`. Direct lane defaults to single-milestone `[{ id: 'single', label: 'On accept', trancheBps: 10000 }]`. |
| 7 | Validator attestation quorum | **v1: zero required.** Validators are advisory; donor decides when to release. Per-milestone `requiredAttestations` deferred. |
| 8 | Multi-pool / co-funding | **v1: one donor per commitment.** Co-funding = multiple commitments sharing the same source subject. Aggregation in the UI, not the contract. |
| 9 | Refund on cancel | **v1: undisbursed funds stay with the donor.** Pro-rata refund (e.g., back to pool pledgers) deferred. |
| 10 | Token | **MockUSDC (dev) / USDC (mainnet).** Multi-token deferred — use composite-subject pattern from spec-005 when needed. |
| 11 | Source kinds reified | **Enum on chain**: `MATCH_AWARD` (spec-003 grant), `MATCH_DIRECT` (spec-001 MatchInitiation accept), `MATCH_POOL_PLEDGE` (spec-002 pool pledge steward-accept). Each is a `bytes32` keccak("sa:CommitmentSourceAward") etc., stored at predicate `sa:commitmentSourceKind`; the originating artifact's subject is stored at `sa:commitmentSourceSubject`. Extension is adding a new keccak constant, not changing the contract. |
| 12 | Pool pledge → commitment relationship | **Two separate commitments.** (a) Donor→pool USDC movement remains spec-005 `PledgeRegistry.recordHonor` (treats pool as recipient; not a `sa:Commitment` row). (b) Pool→needer movement when the pool's steward accepts/awards the pledged capacity creates a `sa:Commitment` with `sourceKind=MATCH_POOL_PLEDGE` and donor=pool. Keeps the donor→pool rail orthogonal from the pool→recipient rail. |

## Phased Delivery

| Phase | Pipeline | Deliverable | Est. |
|---|---|---|---|
| 1. Design lock | PM → IA → Ontologist → Security → Reviewer | This doc + `contracts.md` + IA classification | 0.5d |
| 2. Predicate + resolver | Developer → Reviewer | `sa:hasTreasury` ontology term; `resolveRecipientTreasury` SDK helper; replace `fundAgent` fallback in `markDisbursementPaid` and `claimDisbursement` | 0.5d |
| 3. CommitmentRegistry contract | Developer → Reviewer → Tester | Contract + deploy script + ABI export; `commit / recordRelease / recordOutcome / cancelCommitment / get / listForProposal / listForPool` | 1.0d |
| 4. ProposalRegistry.announceAward extension | Developer → Reviewer | Add `needIntentId` param; bump SDK; thread through closeRound | 0.3d |
| 5. SDK + lane entry actions | Developer | `CommitmentClient`; three entry actions (`closeRoundAction` extension for grant, new `acceptMatchAction` for direct, new `acceptPoolPledgeForNeedAction` for pool-pledge); shared `releaseTrancheAction` (Rail A); shared `recordOutcomeAction`; `cancelCommitmentAction` + `setRecipient/Donor` | 1.5d |
| 6. GraphDB sync | Developer | `emitCommitmentsTurtle` + `syncCommitmentToGraphDB`; wired to chain-event tail | 0.5d |
| 7. UI surfaces | UX → Developer | Pool steward releases tab; proposer commitment timeline on proposal detail; validator attestation hookup | 1.0d |
| 8. Tests + smoke | Tester → QA → Test User | Forge unit tests for CommitmentRegistry; integration: closeRound → releaseTranche → recordOutcome → completion; fresh-start smoke | 0.5d |
| 9. Docs + memory | Documentarian | Audit doc, IA classification, CLAUDE.md addition, memory entry | 0.3d |

**Total**: ~5.6 person-days sequential; ~3.5 calendar days with parallelism on phases 3/4 and 7.

## IA Classification (short)

| Artifact | Store | Tier | Notes |
|---|---|---|---|
| Commitment row (proposalSubject, recipient, milestones, totalAmount, status) | On-chain `CommitmentRegistry` | Public | Mirrors to GraphDB as `sa:Commitment` |
| Tranche release event (milestoneId, amount, txHash) | On-chain | Public | Emitted alongside USDC.transfer |
| Outcome attestation (outcomeId, evidenceHash) | On-chain | Public | Evidence blob in org-mcp / person-mcp |
| Outcome evidence blob | org-mcp / person-mcp content-addressable store | Private | sha256 hash on chain |
| `sa:hasTreasury` predicate value | On AgentAccount via AttributeStorage | Public | Self-declared by org owner |

Full classification in `docs/information-architecture/13-award-fulfillment-classification.md` (TODO).

## Contracts (summary — full surface in `contracts.md`)

### New: `CommitmentRegistry`

- Class: `sa:Commitment`. Subject key: `keccak256("sa:commitment:", sourceKind, sourceSubject, donor)` — one commitment per (source artifact, donor).
- Predicates:
  - **Lineage / context:** `sa:commitmentSourceKind` (bytes32 enum), `sa:commitmentSourceSubject` (bytes32 — proposal / matchInitiation / poolPledge subject), `sa:commitmentRound` (bytes32, only for grant lane; empty for others), `sa:commitmentNeedIntent` (string), `sa:commitmentOfferIntent` (string).
  - **Parties:** `sa:commitmentDonor` (address — pool for grant/pool-pledge lanes; offerer for direct lane), `sa:commitmentRecipient` (address — resolved via `resolveRecipientTreasury`).
  - **Terms:** `sa:commitmentToken` (address), `sa:commitmentTotalAmount` (uint256), `sa:commitmentMilestonesJson` (string).
  - **State:** `sa:commitmentReleasedAmount` (uint256), `sa:commitmentStatus` (bytes32 enum).
- Source-kind enum (bytes32):
  - `MATCH_AWARD     = keccak256("sa:CommitmentSourceAward")`     — spec-003 grant award.
  - `MATCH_DIRECT    = keccak256("sa:CommitmentSourceDirectMatch")` — spec-001 MatchInitiation acceptance.
  - `MATCH_POOL_PLEDGE = keccak256("sa:CommitmentSourcePoolPledge")` — spec-002 pool pledge steward-accept (pool→recipient leg).
- Status enum: `Pending` | `InFlight` | `Completed` | `Canceled` | `ReleasesBlocked` (donor or recipient unresolved).
- Methods:
  - `commit(CommitParams)` — donor-steward-only (`canManageAgent(donor, msg.sender)`). Validates trancheBps sum = 10000, sourceKind is a known enum, and both donor + recipient ≠ 0x0 (else stamps `ReleasesBlocked`).
  - `recordRelease(commitmentSubject, milestoneId, amount, txHash)` — donor-steward-only; called inside `executeBatch` paired with a `USDC.transfer(recipient, amount)`. Increments releasedAmount; when releasedAmount == totalAmount, status → `Completed` automatically.
  - `recordOutcome(commitmentSubject, outcomeId, evidenceHash)` — open to validators (gating via AnonCreds-issued `ValidatorCredential` checked off chain by org-mcp before on-chain redeem; matches spec-004 voter pattern).
  - `cancelCommitment(commitmentSubject, reason)` — donor-steward-only; status → `Canceled`; undisbursed funds stay with donor.
  - `setDonor(commitmentSubject, newDonor)` / `setRecipient(commitmentSubject, newRecipient)` — donor-steward-only (current donor or originating-publisher); unblocks `ReleasesBlocked` once a previously unresolved party is named.
- Events: `Committed`, `Released`, `OutcomeRecorded`, `Completed`, `Canceled`, `DonorResolved`, `RecipientResolved`.

### Extended: `ProposalRegistry.announceAward`

- New required param: `needIntentId` (string). Stored at predicate `sa:awardNeedIntent` on the public-award facet so the grant-lane commit-from-award call can read it back without re-walking the proposal body.
- Backwards-compat: deploy is a fresh-start; no migration.

### Extended: `MatchInitiationRegistry.setStatus`

- Adds an explicit `MatchInitiationAccepted` status alongside the existing `Pending` / `Consumed` / `Superseded`. The direct-lane commit action gates on the MI being in `Accepted` state (one MI → one commitment per donor).
- Event: `MatchInitiationStatusChanged(miSubj, newStatus)` already exists; no signature change.

### New predicate: `sa:hasTreasury`

- Stored on `AgentAccount` via `AttributeStorage`. Hash: `keccak256("sa:hasTreasury")`.
- Self-set by the agent's owner (org/person) via a new SDK helper `setTreasury(treasuryAddress)`.

## SDK additions

- `CommitmentClient` — `commit / recordRelease / recordOutcome / cancel / get / listForProposal / listForPool`.
- `resolveRecipientTreasury(proposerPrincipal: string): Promise<Address | null>` — priority order:
  1. hex address → read `sa:hasTreasury` from that AgentAccount.
  2. hex address → read `sa:hasPersonalTreasury` (spec-005).
  3. hex address → return self.
  4. `did:` / `person_` / `nullifier:` prefix → look up via org-mcp / person-mcp principal index; recurse on resolved AgentAccount.
  5. unresolvable → return null; commit lands as `ReleasesBlocked`.
- `encodeReleaseBatch(commitmentSubject, milestoneId, amount, recipient)` — returns the `executeBatch` payload for `[USDC.transfer(recipient, amount), CommitmentRegistry.recordRelease(...)]`. Mirrors `encodeHonorBatch` from spec-005.

## Action layer

### Lane entry points (each produces a Commitment)

- **Grant lane** — `closeRoundAction` (existing). After `announceAward` + `setStatus(awarded)`, fan out: for each awarded proposal call `CommitmentClient.commit({ sourceKind: MATCH_AWARD, sourceSubject: proposalSubject, donor: poolAgent, recipient: resolveRecipientTreasury(proposal.principal), needIntent: proposal.basedOnIntentId, offerIntent: round.offerIntentId, totalAmount: award.amount, milestonesJson: proposal.milestones })`. If recipient is null, commit still lands as `ReleasesBlocked`.
- **Direct lane** — `acceptMatchAction` (new). Either side of a `MatchInitiation` (need-holder or offer-holder, whoever is the donor in the agreed terms) presses Accept; the action: (1) sets MI status → `Accepted`, (2) calls `CommitmentClient.commit({ sourceKind: MATCH_DIRECT, sourceSubject: miSubject, donor: <offerer agent>, recipient: resolveRecipientTreasury(<needer principal>), needIntent: mi.viewedIntent, offerIntent: mi.candidateIntent, totalAmount, milestonesJson: <single-tranche default or negotiated> })`.
- **Pool-pledge lane** — `acceptPoolPledgeForNeedAction` (new). Pool steward, after a pool pledge has been honored (spec-005) and assigned to a specific NeedIntent, calls `CommitmentClient.commit({ sourceKind: MATCH_POOL_PLEDGE, sourceSubject: pledgeSubject, donor: poolAgent, recipient: resolveRecipientTreasury(needer.principal), needIntent: <needIntentId>, offerIntent: pool.mandateOfferId, ...})`. Distinct from spec-005's donor→pool flow.

### Shared release / lifecycle (lane-agnostic)

- `releaseTrancheAction` — donor-owner only (`canManageAgent(commitment.donor, signer)`); reads commitment, computes tranche amount from `milestonesJson`, builds `executeBatch([USDC.transfer(recipient, amount), recordRelease(...)])`, signs with the donor's owner key (Rail A, mirrors `honorPledge`).
- `recordOutcomeAction` — validator-side via AnonCreds presentation → org-mcp → on-chain `recordOutcome`.
- `cancelCommitmentAction` — donor-owner only; sets status = `Canceled`.
- `setRecipientAction` / `setDonorAction` — donor-owner only (or originating publisher when donor itself is unresolved); resolves a previously `ReleasesBlocked` commitment.

## GraphDB sync

- `emitCommitmentsTurtle({ proposalFilter?, poolFilter? })` — walks `allSubjects()` on CommitmentRegistry, emits `urn:smart-agent:commitment:<proposalSubject>` rows with full predicate set.
- `syncCommitmentToGraphDB(commitmentSubject)` — per-commitment splice, mirrors `syncPoolToGraphDB`. Called from chain-event tail.
- `emitTrancheReleasesTurtle` — flattens release events into `sa:TrancheRelease` triples for the proposer fulfillment timeline.

## UI surfaces

- **`/h/[hubId]/intents/[intentId]`** — intent detail page, fulfillment forward-walk.
  - **The originating intent stays visible.** A new "Fulfillment" section renders directly under the existing identity panel (title, direction, object, priority, visibility) so the user reading the intent can trace it forward without leaving the page.
  - Walks: `intent` → all matched artifacts (proposals where `basedOnIntentId === thisIntent.id`, match initiations where `viewedIntent === thisIntent.id`, pool pledges targeting this intent) → commitment per (source, donor) → tranche releases + outcomes. The intent page becomes the canonical "did my need get met?" surface — same shape regardless of which lane delivered the match.
  - Empty states by phase:
    - No matches yet → "0 matches for this intent" + links to discovery / direct-match / pool views.
    - Matched but no commitment → list with status badges (`submitted` / `withdrawn` / `awarded` / `pending`).
    - Commitment `ReleasesBlocked` → call out the unresolved donor/recipient warning + link to the action to resolve.
    - Commitment `InFlight` → milestone timeline with released vs. pending tranches; lane badge (grant / direct / pool-pledge) shown.
    - Commitment `Completed` → outcome roll-up: declared `desiredOutcomes` vs. attested `recordedOutcomes`, with evidence hashes linkified.
  - Symmetric on the **counter-intent side**: an Offer/Pool intent page lists commitments anchored to it via `commitmentOfferIntent`. (Pool mandate = aggregate offer; per-need offer-intents from spec-001 also link this way.)

- **`/h/[hubId]/commitments`** — global commitment index for the hub.
  - Filters by lane (grant / direct / pool-pledge), donor, recipient, status. One row per commitment.
  - Roles: members see commitments they're a party to (donor side or recipient side); stewards of any pool/org see their org's commitments; admins see all.

- **`/h/[hubId]/pools/[poolId]/commitments`** — pool steward releases tab.
  - List of commitments grouped by status (Pending / InFlight / Completed / Canceled / ReleasesBlocked).
  - Per-commitment: milestone timeline, validator attestations attached, "Release tranche" button (steward-only, gated on canManageAgent(pool)).
- **`/h/[hubId]/proposals/[proposalId]`** — proposer commitment timeline.
  - New section "Funding timeline" between vote panel and outcomes.
  - Tranche table: milestone label, scheduled amount, status (pending / released), txHash link.
  - "Submit milestone evidence" CTA for proposer; "Attest milestone" CTA for validator.
- **`/h/[hubId]/rounds/[roundId]/validate`** (existing) — extend to attach attestations to commitment milestones, not just standalone proposals.

## Open questions (v2 backlog)

- Tranche refund on cancel: pro-rata to donors vs. stays in pool.
- Validator quorum requirement: per-milestone `requiredAttestations` threshold.
- Outcome required for closure: today, all milestones released → `Completed`. Should `Completed` also require all `desiredOutcomes` recorded?
- Cross-pool co-funding: single commitment with multiple `pool` references.
- Anonymous payout: ZK-rail for nullifier-only proposers to claim into a freshly-derived recipient agent.
- Multi-token: composite-subject pattern from spec-005 ((commitment, token) → amount).

## Smoke test paths (one per lane)

### Grant lane (spec-003)

1. Maria deploys MockUSDC funds to a pool (spec-005 honor flow). Pool USDC = $30k.
2. Round opens; org submits proposal with `needIntentId = urn:smart-agent:need-intent:trauma-care-q3` and 3 milestones (40/30/30 bps).
3. Members cast votes (spec-004 anoncreds path); threshold met.
4. Pool steward calls `closeRound` → `CommitmentRegistry.commit(sourceKind=MATCH_AWARD)` → commitment row, donor=pool, recipient=resolved org treasury, status=`Pending`.
5. Proposer submits milestone-1 evidence (off chain in org-mcp).
6. Validator attests milestone-1 via `recordOutcome`.
7. Pool steward presses Release for milestone-1 → `executeBatch([USDC.transfer(recipient, $12k), recordRelease(...)])` → recipient = $12k, pool = $18k.
8. Repeat for milestones 2 and 3.
9. After last release, `Completed` event fires.

### Direct lane (spec-001)

1. Carlos expresses NeedIntent: "Need $200 for groceries". Maria expresses OfferIntent: "$200 to help neighbors".
2. Matchmaker pairs them; Carlos creates `MatchInitiation` linking the two intents.
3. Maria reviews, presses Accept on the MI → `acceptMatchAction` fires:
   - `MatchInitiationRegistry.setStatus(miSubj, Accepted)`.
   - `CommitmentRegistry.commit(sourceKind=MATCH_DIRECT, donor=Maria.personAgent, recipient=resolveRecipientTreasury(Carlos.principal), totalAmount=$200, milestonesJson=[{ id:'single', label:'On accept', trancheBps:10000 }])`.
4. Maria immediately presses Release on the single milestone (or the UI auto-prompts) → `executeBatch([USDC.transfer(carlosTreasury, $200), recordRelease(...)])` → Carlos = $200, Maria = -$200. `Completed` event fires.
5. Outcome attestation optional (Carlos can record "groceries purchased" via `recordOutcome`).

### Pool-pledge lane (spec-002)

1. Donors pledge to a coaching pool (spec-002). spec-005 honor moves USDC into the pool.
2. NeedIntent matched to the pool: "Need 4 coaching sessions, ~$400."
3. Pool steward accepts the match: `acceptPoolPledgeForNeedAction(pool, need)` → `CommitmentRegistry.commit(sourceKind=MATCH_POOL_PLEDGE, donor=pool, recipient=resolveRecipientTreasury(needer.principal), totalAmount=$400, milestonesJson=[per-session tranches])`.
4. Sessions delivered; validator attests each; steward releases tranche after each.
5. Final release → `Completed`.

### Cross-lane invariants verified

- Same `CommitmentRegistry.recordRelease` path used by all three.
- Same intent detail page renders all three uniformly (lane badge shows the difference).
- Same GraphDB `sa:Commitment` triples emitted.
- Donor signing requirement identical: `canManageAgent(commitment.donor, signer)`.
