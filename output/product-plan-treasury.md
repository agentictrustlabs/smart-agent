# Treasury Build — Product-Management View of Remaining Work

> PM lens on `output/onchain-treasury-plan.md` (architecture), `output/dao-pool-round-best-practices.md` (DAO ecosystem comparables), `output/safe-architecture-comparison.md` (Safe patterns we adopted), and `docs/specs/intent-marketplace-capabilities.md` (what's currently in users' hands).
>
> Treats the architecture spec as the master. Names the five remaining buckets, their user value, the explicit hand-offs between them, the demo we run for each, and the risks that could kill or stall any of them. Phases 1, 2, and 2.5 are already shipped — we're triaging *what to build next* and in what order.

---

## 0. Where we are right now (one-paragraph baseline)

Phases 1, 2, and 2.5 of the on-chain treasury build are in production. The full anchoring surface (13 T-Box assertion classes, 8 emit helpers, `KNOWN_ASSERTION_CLASSES` registered in `apps/web/src/lib/ontology/graphdb-sync.ts`) and the full caveat-stack contract surface (12 Solidity contracts including `QuorumEnforcer` with Safe-format packed sigs, `MultiSendCallOnly`, `MandateRegistry`, `StewardEligibilityRegistry`, `ApprovedHashRegistry`, four enforcers) are deployed and tested at 195/195 forge green. The MCP write side has 9 tools (`pool:create`, `pool:rotate_stewards`, `pool:update_mandate`, `round:open`, `round:close`, `round:cancel`, `grant_proposal:award`, `grant_proposal:revoke_award`, `grant_proposal:rescind`) plus dispute-window / cancellation guardian wiring. The web UI has pool create, round create, round close, round cancel, pool detail, round detail, and apply-page surfaces. 18/18 Playwright tests pass.

What this gets us in user value: stewards can create pools and rounds, the system anchors every public state change to chain, the dispute window mechanically blocks any disbursement userOp inside the 72h gate, and a steward can cancel a bad round before it ever pays out. **What it does NOT get us yet: any actual money moves, no real custody, no steward-sig-collection flow, no discretionary disbursement, no outcomes loop, no real reputation feedback.** Phases 2.7 / 3 / 3-cleanup / 4 / steward-sig collection close those gaps.

---

## Bucket 1 — Phase 2.7: Discretionary Disbursement (proposed; not yet codified in the plan)

### Goal in one sentence
Let a steward fulfill a hub `Need` directly out of pool capacity without spinning up a formal `Round`, so small-trust mutual-aid moves at the speed of conversation, not the speed of governance.

### The user problem this solves
Maria posts a Receive intent (`demo-maria-need-trauma-coaching`). The Catalyst NoCo Network has a $250k trauma-care pool sitting open. Today, satisfying that need requires opening a Round, having Maria submit a GrantProposal, the steward set deciding, the dispute window passing — that's 4+ weeks for what should be a 5-minute decision when the pool's mandate already covers her need. Phase 2.7 collapses that to a single steward action.

### User stories

**S1.1 — "As a steward, I want to see hub Needs that match my pool's mandate, so that I can act on them without opening a round."**
Acceptance:
- On `/h/catalyst/intents/[id]` (a Receive intent), if the viewer holds STEWARDSHIP for any pool whose acceptedKinds include the intent's mandate kind, surface a "Match a need from this pool" CTA.
- The CTA is suppressed if the pool's available capacity is below a configurable floor (`pool.minDiscretionaryCapacity`, default = 2× the proposed allocation).
- The CTA is suppressed if the viewer's pool has any open Round in `RoundOpen | RoundReview` state on overlapping mandate (avoid double-booking capacity).
- Suppression reasons are visible to the steward on hover (not silent).

**S1.2 — "As a steward, I want to allocate from pool capacity to a Need with a single confirmation, so that small-trust disbursements feel as cheap as Slack-thread agreement."**
Acceptance:
- The CTA opens a small modal: amount, optional note, recipient (auto-filled from the Need's owner), tranche schedule (single-tranche default with optional milestone split).
- Submit calls new MCP tool `pool:allocate_to_need(poolId, intentId, amount, trancheSchedule)`.
- Tool emits `sa:DiscretionaryAllocationDecidedAssertion` (NEW); on Phase 3 ground, fires the `MultiSendCallOnly` userOp. Pre-Phase-3 it logs intent + emits the assertion in mock mode.
- Maria gets a notification on her intent: "Pastor David allocated $X from `demo-trauma-care-pool` to your need." Status moves to `acknowledged`.

**S1.3 — "As a steward, I want the discretionary path to be gated by the pool's mandate (kind + geo), so that I can't accidentally send trauma-care funds to a software grant."**
Acceptance:
- The new `NeedMandateMatchEnforcer` caveat (NEW contract) reverts the userOp if `intent.mandateKind ∉ pool.acceptedKindsRoot`.
- The forge test suite includes a happy path + a `KindNotAccepted` revert path.
- The MCP tool fails-fast at write time with the same check (UX: surface "this pool doesn't fund this kind of need" before submit).

**S1.4 — "As a steward, I want the discretionary disbursement to still be traceable and disputable, so that the speed advantage doesn't trade away accountability."**
Acceptance:
- `sa:DiscretionaryAllocationDecidedAssertion` carries `{poolAgentId, intentIRI, recipientAgentIRI, amount, trancheSchedule, decidedBy, decidedAt}`.
- The same `DisputeWindowOpenedAssertion` lifecycle from Phase 2.5 applies (default 24h instead of 72h — discretionary moves are smaller-stakes by design).
- The pool root key (or any other steward) can revoke before window closes via `discretionary:revoke`.
- Audit-style: every discretionary move is queryable from GraphDB (`?steward sa:decidedDiscretionarily ?intent ?amount`) — the projection is added to `KNOWN_ASSERTION_CLASSES`.

**S1.5 — "As a donor to the pool, I want discretionary disbursements to count against the same capacity ceiling as round-based ones, so that the pool's `availableTotal` never goes negative."**
Acceptance:
- `sa:PoolPledgedTotalAssertion` (existing helper) re-fires after every discretionary disbursement with updated `allocatedTotal`.
- `available = pledgedTotal - allocatedTotal` is the SHACL-enforced invariant.
- An attempted discretionary allocation whose amount > `availableTotal` reverts (contract) and surfaces UI error (action layer).

**S1.6 — "As a pool root, I want to set a per-steward, per-period discretionary cap so that any single steward can't drain the pool unilaterally."**
Acceptance:
- New caveat term in `STEWARDSHIP_DELEGATION`: `discretionaryCap = (perSteward, perPeriod, periodLength)`. Default unset = no per-steward cap (current pool behavior).
- Setting a cap is a new MCP tool `pool:set_discretionary_cap`.
- The new enforcer maintains a per-steward usage counter that resets at `periodLength` boundaries.
- Forge test: cap exhaustion reverts with `DiscretionaryCapExceeded`.

### Out of scope (Phase 2.7)
- Real USDC movement (Phase 3).
- Multi-steward sign-off on discretionary moves (the whole point is one-signer speed; if you want quorum, open a round).
- Cross-pool discretionary (one need pulled from two pools simultaneously) — defer to v2.
- Streaming/recurring discretionary disbursements — defer to v2.

### Dependencies on other phases
- **None upstream.** This phase reuses existing Phase 2 caveat infra. Adds one new enforcer + one new emit class.
- **Downstream:** Phase 3 needs to wire the discretionary path into the same `treasuryDisburse.action.ts` USDC path; the `pool:allocate_to_need` MCP tool's mock-disburse becomes a real USDC transfer.
- **Downstream:** Phase 4 needs to surface discretionary outcomes in `sa:OutcomeAttestationAssertion` projections so a steward who repeatedly allocates badly accrues anti-reputation.

### Risks
| ID | Risk | Severity | Mitigation owner |
|---|---|---|---|
| R1.1 | Single-steward scope-creep — discretionary becomes the default and Round usage atrophies. | medium | PM + UX: enforce per-steward caps by default, dashboard the discretionary-vs-round split per pool. |
| R1.2 | Mandate match too loose (e.g., Need carries no `mandateKind`, defaults to wildcard). | high | Contracts: enforcer reverts on missing `mandateKind` rather than treating as wildcard. |
| R1.3 | Capacity race — two stewards both allocate to the same need within the same block. | medium | Contracts: `AllocationLimitEnforcer` (already exists) keyed on `(pool, intent)` tuple prevents double-spend at chain level. |
| R1.4 | Privacy leak — discretionary assertion exposes `intentIRI` for an intent the recipient meant to keep private. | high | Security: SHACL shape blocks discretionary anchoring for any intent whose `visibility != public`. Tested in Phase 2.7 acceptance. |
| R1.5 | Demo cluttered — both Round-based and discretionary paths shown, hard for users to know which to use. | low | UX: discretionary CTA is contextual (only on Need pages), Round-creation CTA stays on pool index — different paths, different surfaces. |

### Demo script (Maria + Pastor David, 7 clicks)
1. Sign in as Pastor David (steward of `demo-trauma-care-pool`). Land on `/h/catalyst/discover`.
2. Click "Top open needs" → Maria's `demo-maria-need-trauma-coaching`.
3. On the Need detail, see new "Match a need from this pool" CTA with `demo-trauma-care-pool` selected. Show the mandate-match badge ("trauma-care ✓").
4. Click. Modal opens. Enter $500, single tranche, note "Initial coaching engagement, 5 sessions." Confirm.
5. UI flips status to "allocated"; toast shows "$500 allocated, 24h dispute window open." On-chain assertion id surfaced.
6. Sign out, sign in as Maria. Notification on `/h/catalyst/intents/demo-maria-need-trauma-coaching`: "Pastor David allocated $500 from Catalyst NoCo trauma-care pool." Intent status `acknowledged`.
7. (Bonus) Sign in as third steward, demo `discretionary:revoke` within window. Show the revoke assertion + status flip back.

### Effort sizing — **M**
One new caveat enforcer (~M, well-trodden Merkle pattern); one new emit class + helper (~S); one MCP tool (~S); one web action layer (~S); one Need-detail surface change (~S). The discretionary cap (S1.6) is the only piece pushing this from S to M — stateful per-steward counters are easy in Solidity but need careful test coverage on period boundaries. Total: 1.5–2 weeks.

---

## Bucket 2 — Phase 3: Real USDC Custody + Non-Monetary Commitments

### Goal in one sentence
Pool `AgentAccount`s actually hold USDC, donor pledges trigger real `USDC.transfer` userOps, tranches release real funds under the full caveat stack — and parallel non-monetary commitments (prayer-minutes, coaching-hours, hospitality-nights) settle through `CommitmentRegistry`.

### The user problem this solves
Today the architecture is a beautiful trust-graph mirror with no money in it. Phase 3 puts custody behind the abstractions we've built. Without it, every bullet of the spec — pools, rounds, pledges, awards — is theater.

### User stories

**S2.1 — "As a donor, I want to pledge real USDC into a pool, so that my commitment moves real funds at the moment I sign."**
Acceptance:
- On `/h/catalyst/pools/[poolId]/pledge`, USDC-denominated pledge submission triggers a `USDC.transfer(poolAgentAccount, amount)` userOp through donor's `AgentAccount`.
- The userOp is bundled by the existing 4337 bundler infrastructure.
- The pool's `AgentAccount` USDC balance increases by `amount` on chain; the action layer reads the post-tx balance and surfaces it.
- `sa:PledgeAssertion` fires unchanged (existing helper) carrying `unit=USDC` and the actual transfer txHash.
- Failure cases (insufficient balance, declined userOp, bundler timeout) surface user-visible error states distinct from "pledge succeeded but didn't move money."

**S2.2 — "As a donor, I want to pledge prayer-minutes / coaching-hours into a non-monetary pool, so that I can commit a non-fungible unit and have a steward later attest delivery."**
Acceptance:
- For a pool whose `acceptedUnits` is non-monetary, pledge submission writes a row to `CommitmentRegistry` with `(commitmentId, committer, pool, unitClass, totalUnits, expiresAt)`.
- `CommitmentRegistry.commit()` is gated by donor's `AgentAccount` (only the committer can commit on their own behalf).
- A public-tier non-monetary pledge ALSO fires `sa:PledgeAssertion` with `unit ≠ USDC` (per plan § 3.2).
- Anonymous-tier non-monetary pledges go through `CommitmentRegistry` only, no class assertion (visibility cascade enforces).

**S2.3 — "As a steward, I want to disburse a tranche of an awarded grant under the full caveat stack, so that the system enforces every rule the off-chain decision encoded."**
Acceptance:
- After Round close + dispute window, lead steward kicks `treasuryDisburse.action.ts` for tranche 1.
- Action layer assembles N-of-M sigs (Bucket 5), calls `DelegationManager.redeemDelegation([STEWARDSHIP, SESSION], target=USDC, data=transfer(recipient, amount))`.
- The redemption walks the full caveat chain: `PoolMandateEnforcer` (mandate-match), `RoundDecisionWindowEnforcer` (post-decisionDate, in awards root), `AllocationLimitEnforcer` (under tranche cap), `QuorumEnforcer` (sig threshold met), `ValueEnforcer` (under per-call ceiling), `TimestampEnforcer` (post-disputeUntil).
- `MultiSendCallOnly.multiSend([USDC.transfer, ClassAssertion.emit])` packs both into one atomic userOp; transfer + assertion succeed or fail together.
- The recipient's `AgentAccount` USDC balance increases by `amount`. The pool's USDC balance decreases by `amount`. `sa:DisbursementAssertion` lands in GraphDB within sync latency.

**S2.4 — "As a steward of a non-monetary pool, I want to redeem a commitment by attesting fulfillment, so that the donor and recipient have a verifiable record that the prayer-chain / coaching-hour was delivered."**
Acceptance:
- New action `commitmentRedeem.action.ts`: steward picks a commitment, attests delivery, calls `CommitmentRegistry.redeem(commitmentId, units, attestationURI)` gated by `CommitmentRedemptionEnforcer`.
- `CommitmentMadeAssertion` and `CommitmentRedeemedAssertion` (or reuse `sa:OutcomeAttestationAssertion` with kind=`commitment-fulfilled`) project to GraphDB.
- The committer (donor) sees their commitment-redemption history on `/h/catalyst/pledges/[pledgeId]`.
- Partial redemption is supported (commit 100 prayer-minutes → redeem 30 → 70 remaining).

**S2.5 — "As a recipient of a grant, I want to see the actual money landing in my agent account with a verifiable on-chain audit trail, so that I can trust the system end-to-end."**
Acceptance:
- Recipient surface (probably `/h/catalyst/agents/[agentId]/treasury` or a notification) shows incoming USDC transfers tagged with the originating `sa:DisbursementAssertion` IRI.
- One click drills to: round → award → tranche schedule → this disbursement.
- The recipient's `AgentAccount` is the address that receives — no intermediate wrapper.

**S2.6 — "As a pool root, I want every Phase-3 disbursement to fail-closed if the new `IAccountGuard` slot rejects it, so that org-wide kill-switches actually work in production."**
Acceptance:
- A reference `DisputeFreezeGuard` (already shipped in Phase 2 as additive infra) is wired up on at least one demo pool.
- A simulated open dispute on the pool causes the next disbursement userOp to revert at `checkBefore`.
- Forge integration test covers the guard-revert path end-to-end.

**S2.7 — "As a security reviewer, I want a complete revert-path test suite for the disbursement chain, so that we know every caveat fails closed before real money is at risk."**
Acceptance:
- Forge tests cover: `KindNotAccepted`, `GeoNotAccepted`, `TooEarly` (pre-decisionDate), `TooEarly` (in dispute window), `NotInAwardsList`, `TrancheCapExceeded`, `InsufficientQuorum`, `UnauthorizedSigner`, `DuplicateSigner`, `ApprovedHashRequired`, `ContractSigInvalid`, `MandateMismatch` (between off-chain decision and on-chain replay), `replay protection` (same userOp submitted twice).
- E2E happy-path test runs through `fresh-start.sh` and exercises a full open round → propose → close → dispute window → disburse → outcome path with real USDC on a local fork.

### Out of scope (Phase 3)
- Anonymous USDC custody (Q4 in plan: requires tumbler / Privacy Pool, deferred to v2).
- Multi-asset pools beyond single USDC + non-monetary (Q17: deferred to v2 via sub-pool-per-asset).
- Sablier / streaming disbursements (Q16: opt-in `RecurringRound` deferred to v2).
- Multi-chain treasury (Q2: one pool, one chain).
- Outcome attestation loop (Phase 4).
- Validator-set delegation pattern (Phase 4).

### Dependencies on other phases
- **Hard upstream:** Phase 2 (caveat enforcer suite — done) + Phase 2.5 (dispute window — done) + Bucket 5 (steward sig collection flow — needed because real disbursements MUST gate on real N-of-M sigs, not deployer auth).
- **Recommended upstream:** Phase 3 cleanup (Bucket 3) — chunked SPARQL UPDATE, before sustained on-chain → GraphDB sync load tests Phase 3 to its CPU saturation point.
- **Hard downstream:** Phase 4 cannot start without real disbursement events to attest outcomes against.

### Risks
| ID | Risk | Severity | Mitigation owner |
|---|---|---|---|
| R2.1 | Custody bug — funds get stuck in pool `AgentAccount` due to enforcer logic error. | **HIGH** | Security + contracts: full revert-path test suite (S2.7); audit by external reviewer before mainnet; staged rollout (testnet → small-pool mainnet → full). |
| R2.2 | Bundler / paymaster failures — donor signs, no money moves, system thinks pledge succeeded. | high | Web: action-layer retries with idempotency keys; clear UX for "submitted but not yet confirmed" vs "confirmed" vs "failed". |
| R2.3 | USDC blocklisting — Circle freezes a pool address. | medium | Security: document this as a known custody risk; multi-pool resilience (a pool freeze does not affect sibling pools). |
| R2.4 | MultiSendCallOnly delegatecall vulnerability. | **HIGH** | Contracts: stick with CallOnly variant for treasury path; never expose the full MultiSend (delegatecall-allowing) variant on disbursement paths; forge invariant test that MultiSendCallOnly cannot escalate to delegatecall. |
| R2.5 | Anonymous-pledge confusion — users pick anonymous expecting full privacy, USDC tx reveals donor identity anyway. | medium | UX: anonymous-tier pledges show "anonymous attribution; USDC custody is not anonymous" disclaimer. Documented in spec 002 follow-up. |
| R2.6 | Gas-cost surprise — small disbursements ($50 mutual-aid) cost more in gas than they're worth. | medium | Infra: deploy on Base (per Q1), confirm sub-$0.50 gas budget for full caveat-chain redeem; if not, paymaster sponsorship. |
| R2.7 | Race between tranche disbursement and an in-flight dispute filing. | medium | Contracts: dispute filing flips a guard flag that pre-empts in-flight redeems; tested in S2.6. |

### Demo script (Maria + Pastor David + a 3rd steward, 12 clicks)
**Setup**: pool funded with $1500 from a previous step; round closed with award to Maria for $500 in 2 tranches.

1. Sign in as Maria. Land on `/h/catalyst/proposals/demo-maria-trauma-proposal`. See "Awarded" status with tranche schedule.
2. Sign out. Sign in as 3rd steward (round lead). Land on `/h/catalyst/rounds/demo-trauma-care-q2`.
3. Click "Disburse tranche 1" CTA (visible only post-dispute-window). Modal: shows tranche details, awards root, sigs collected (3-of-3 from Bucket 5).
4. Click "Submit". Spinner. Action layer assembles sigs, calls `redeemDelegation`.
5. Toast: "Tranche 1 disbursed. Tx: 0x...". Pool USDC balance ticker drops from $1500 to $1250.
6. Sign out. Sign in as Maria. Notification: "$250 received from `demo-trauma-care-pool`." `/h/catalyst/proposals/demo-maria-trauma-proposal` shows "Tranche 1 of 2 released" with disbursement assertion link.
7. Verify on chain: Maria's `AgentAccount` USDC balance = $250.
8. Verify in GraphDB: `sa:DisbursementAssertion` instance with all fields (proposalIRI, recipient, amount, tranche, txHash) projected within sync window.
9. **Adversarial sub-demo**: another steward files a dispute on the round before tranche 2's window opens. The next "Disburse tranche 2" attempt reverts at the `DisputeFreezeGuard.checkBefore`. UI shows "Disbursement blocked: open dispute on this pool."
10. **Non-monetary sub-demo**: as Maria, browse to `demo-prayer-pool` (new seed). Pledge 30 prayer-minutes. Commitment lands.
11. As steward of prayer pool, click "Attest delivery" on Maria's commitment, mark 10 minutes redeemed with note "Prayed during her Sunday session." `CommitmentRedeemedAssertion` emits.
12. As Maria, see updated commitment status: "10/30 prayer-minutes redeemed."

### Effort sizing — **L → XL**
The contract surface is built; the integration surface is large. Wiring real USDC through the donor pledge path (~M), wiring the disbursement orchestration through the full caveat stack with sig assembly (~L, depends on Bucket 5), commitment registry happy + revoke + redeem paths (~M), full revert-path forge suite (~L), end-to-end integration test (~M), recipient-side surfaces (~M). 4–5 weeks of focused work assuming Bucket 5 lands first or in parallel. Pushes into XL territory if external security review is run synchronously in-window (recommend: run async, gate mainnet on completion).

---

## Bucket 3 — Phase 3 Cleanup: Architecture Debt

### Goal in one sentence
Replace the full-graph PUT in `graphdb-sync.ts` with chunked SPARQL UPDATE statements (fixes GraphDB CPU saturation under sustained load) and retire the legacy `emitPoolsTurtle` / `emitRoundsTurtle` MCP-read pipe (IA P4 violation in spirit).

### The user problem this solves
This is invisible to users until it isn't: under Phase 3 load (real money moving = more emit volume = more sync writes), GraphDB CPU saturates and the public-read surface (`/h/catalyst/discover`, every pool index, every round detail) starts to lag or 5xx. The legacy MCP-read pipe is also a latent IA-violation (private MCP data shaped into public projections) — keeping it around invites accidental P4 breakage.

### User stories

**S3.1 — "As any UI consumer, I want public projections to render under Phase-3 emit load without latency degradation, so that the system stays responsive when real money is moving."**
Acceptance:
- Replace the full-graph PUT in `graphdb-sync.ts` with chunked SPARQL UPDATE: `INSERT DATA { ... }` per assertion class, batched 50–100 triples per request.
- Load test: 10 emits/sec sustained for 10 minutes. GraphDB CPU stays under 60%. Read latency on `/h/catalyst/discover` stays under 200ms p95.
- Failure mode: chunk fails → retry with backoff; surface monitoring metric `graphdb_sync_chunks_failed`.

**S3.2 — "As an information architect, I want the legacy `emitPoolsTurtle` / `emitRoundsTurtle` MCP-read pipe gone, so that the only path from MCP to GraphDB is via on-chain assertion, no exceptions."**
Acceptance:
- Grep returns zero hits for `emitPoolsTurtle` / `emitRoundsTurtle` / any `publishProjection` / `mirrorToGraphDb` helper after this phase.
- Reviewer checklist (IA § 7) flag added to CI.
- Verification SPARQL query (plan § 6.5) returns zero violations: every public Pool / Round in GraphDB has a matching `sa:PoolOpenedAssertion` / `sa:RoundOpenedAssertion`.

**S3.3 — "As an operator, I want the GraphDB sync to be observable, so that I can diagnose lag without ssh-ing into the box."**
Acceptance:
- `tmp/logs/graphdb-sync.log` (already exists per `fresh-start.sh`) gains structured chunk-level logging (chunkId, classCount, durationMs, status).
- A simple admin page `/admin/sync-status` shows last-sync timestamp, lag (now - lastEmitTime), chunk-failure count.

**S3.4 — "As a developer adding a new assertion class, I want to do so without touching sync internals, so that adding classes doesn't bottleneck on infra knowledge."**
Acceptance:
- Adding a new class is a one-line `KNOWN_ASSERTION_CLASSES` registry entry + a one-function projection mapper. No sync-loop changes.
- Documentation update in `docs/agents/developer.md` reflecting the new shape.

### Out of scope (Phase 3 cleanup)
- Migrating to a different graph store (Stardog, AllegroGraph, etc.).
- SPARQL CONSTRUCT-as-projection (we're sticking with INSERT DATA for predictability).
- Anything user-facing — this is pure infrastructure.

### Dependencies on other phases
- **Recommended upstream:** Phase 3 cleanup ships *before* Phase 3 main. Doing it after means the Phase-3 load test is the discovery vector for the CPU saturation — that's an embarrassment shape we can avoid.
- **No downstream dependency** — every later phase benefits but none is gated on this.

### Risks
| ID | Risk | Severity | Mitigation owner |
|---|---|---|---|
| R3.1 | Chunked UPDATEs introduce ordering bugs (assertion B references assertion A but B's chunk lands first). | medium | Infra: chunk by assertion class, not by emit time. Project ordering-sensitive relationships via a deferred CONSTRUCT after all chunks land. |
| R3.2 | Retiring `emitPoolsTurtle` breaks something we forgot. | low | Search before deletion; run full demo + Playwright pass post-removal. |
| R3.3 | The chunked path has a subtle eventual-consistency window where a UI query reads stale data. | low | UX: acceptable; we're already eventual-consistent on the on-chain → KB path. |
| R3.4 | Load-test environment doesn't reflect real production patterns. | medium | Infra: load-test against a fresh-start clone with seeded volume that mimics Phase 3 (10 active pools × 5 rounds × 20 awards). |

### Demo script (operator + dev, 5 clicks)
1. On a fresh-start clone with Phase 3 seed (10 pools × 5 rounds × 20 awards), start the sync.
2. Drive a load script that emits 10 assertions/sec for 10 minutes.
3. Open `/admin/sync-status`. Show lag chart staying under 5s.
4. Open Grafana / `htop` on the GraphDB process. Show CPU under 60% sustained.
5. Open `/h/catalyst/discover` in a fresh tab during the load. Page renders in under 200ms; Top-5 needs are current.

### Effort sizing — **M**
Chunked SPARQL is well-understood (a few days). Retiring the legacy pipe + grep-clean (~S). Observability surface (~S). Load test setup is the chunk that pushes it from S to M. 1.5–2 weeks. Best done by the same dev who wrote `graphdb-sync.ts` originally; context-rich.

---

## Bucket 4 — Phase 4: Outcomes, Rescission, Validators, Reputation

### Goal in one sentence
Close the BDI loop: validators attest tranche outcomes, bad outcomes can rescind awards, and proposer reputation accumulated from outcomes feeds the matchmaker's ranking signal.

### The user problem this solves
A grant system without a feedback loop is a one-way pipe. Today, a proposer's track record is invisible to future stewards and to the matchmaker. Phase 4 makes "did this proposer deliver last time?" a first-class signal in the ranking formula, and gives the system a path to claw back awards from non-delivering recipients without going to court.

### User stories

**S4.1 — "As a validator, I want to attest a tranche outcome, so that the system and future stewards know whether the recipient delivered."**
Acceptance:
- New role: `Validator`. Validator set is per-pool (NEW: `pool.validatorSet` field) or per-round; defaults to the steward set.
- Validator's `AgentAccount` calls `ClassAssertion.emit(sa:OutcomeAttestationAssertion, {disbursementId, validatorIRIs, outcomeKind: delivered|partial|not_delivered|disputed, outcomeQuality: 1..5, evidenceURI})`.
- Validator delegation pattern mirrors steward pattern (NEW caveat: `ValidatorEligibilityEnforcer`, NEW registry: `ValidatorEligibilityRegistry` — or reuse the steward registry under a different role flag).
- UI: `/h/catalyst/rounds/[roundId]/outcomes` shows tranches awaiting attestation; click → modal → attest.

**S4.2 — "As a future steward of a similar round, I want to see a proposer's track record at proposal-review time, so that I can weight my decision on past delivery."**
Acceptance:
- New GraphDB projection `sa:ProposerTrackRecord` derived from `sa:OutcomeAttestationAssertion`s where `recipient = proposerAgent`.
- Fields: `(proposerAgent, deliveredCount, notDeliveredCount, disputedCount, partialCount, avgQuality)`.
- Surface on `/h/catalyst/rounds/[roundId]/proposals` (steward review surface) — a small "Track record: 3 delivered, 1 partial" badge per proposer.
- Drill-through: click badge → see all past tranches with quality + evidence.

**S4.3 — "As the matchmaker, I want proposer track record to feed my composite rank, so that better-delivering proposers naturally surface higher in candidate lists."**
Acceptance:
- The existing matchmaker formula `0.6 * 1/(1+hops) + 0.4 * (fulfilled+1)/(fulfilled+abandoned+2)` already takes `fulfilled / abandoned`. Phase 4 populates these counts from `sa:ProposerTrackRecord`.
- The `outcomeScore` half of the formula derives from outcome attestations, not from match-initiation status (current placeholder).
- Regression test: a proposer with 5 delivered / 0 abandoned outranks a proposer with 5 abandoned / 0 delivered on the same hops distance.
- The matchmaker explicitly doesn't trust "self-reports" — only attestations from validator-role agents count.

**S4.4 — "As a steward, I want to rescind an award when a recipient demonstrably failed to deliver, so that the system can claw back any unreleased tranches and signal the failure to the network."**
Acceptance:
- `grant_proposal:rescind` MCP tool (already exists per Phase 2 work) is now wired to the post-disbursement path.
- Rescission triggers `sa:GrantRescindedAssertion` (already in T-Box) with `reasonURI` pointing to evidence.
- Any unreleased tranches in the round have their SESSION_DELEGATION revoked.
- Rescission also fires `AgentDisputeRecord.fileDispute` (existing contract) for the audit chain.
- The recipient is notified and has a 7-day window to file a counter-evidence assertion (UI surface: `/h/catalyst/proposals/[id]/dispute`).

**S4.5 — "As a recipient of a rescinded award, I want a path to dispute the rescission, so that bad-faith rescissions don't destroy my reputation unilaterally."**
Acceptance:
- `proposal:dispute_rescission` MCP tool emits `sa:DisputeFiledAssertion` (NEW or reuse existing).
- The dispute pauses the rescission's effect on `sa:ProposerTrackRecord` projection until resolved.
- Resolution path: steward set re-decides (could uphold rescission or reverse). Decision emits `sa:DisputeResolvedAssertion` (NEW).
- Out of scope: bond-collateralized arbitration (UMA-style); v1 keeps it human-arbitrated by the steward set.

**S4.6 — "As a pool root, I want to designate validators that aren't the same people as stewards, so that the attestation is independent of the allocation decision."**
Acceptance:
- New MCP tool `pool:set_validator_set(poolId, validators[], threshold)`.
- The validator set can equal the steward set (default) or be disjoint (recommended for pools > $50k).
- `sa:ValidatorSetUpdatedAssertion` (NEW) fires on change.
- UI: pool detail page surfaces validator set distinct from steward set.

**S4.7 — "As an analyst, I want to query GraphDB for outcome statistics across the network, so that I can answer 'which mandate kinds have the highest delivery rate' and feed that back into pool design."**
Acceptance:
- SPARQL queries return aggregations: delivery rate per mandate kind, per pool, per region, per validator-set composition.
- A simple admin dashboard (`/admin/outcomes`) shows top-line stats.
- Privacy: aggregation is over public-tier outcomes only; private-tier outcomes (if any are added in v2) excluded from aggregations.

### Out of scope (Phase 4)
- Bond-collateralized validator commitments (UMA-style optimistic dispute resolution beyond steward-arbitration).
- ML-based outcome classification — outcomes are validator-attested, not auto-derived.
- Cross-network reputation portability (a proposer's NoCo reputation appearing in a different network) — defer to v2; needs a portable identity story.
- Validator reputation (validators-of-validators) — deferred to avoid meta-layer.
- Outcome NFTs — overkill for v1.

### Dependencies on other phases
- **Hard upstream:** Phase 3 (real disbursements must exist to attest outcomes against).
- **Soft upstream:** Phase 3 cleanup (`sa:ProposerTrackRecord` is a new projection; better to land it on the chunked-sync architecture).
- **Downstream:** v2 cross-network reputation. v2 BDI-loop deepening. v2 validator-of-validators.

### Risks
| ID | Risk | Severity | Mitigation owner |
|---|---|---|---|
| R4.1 | Validator collusion — same humans wear steward + validator hats, attestations rubber-stamp. | high | Security + UX: pool root key is encouraged (and UX-prompted) to set disjoint validator sets for pools > $50k threshold; SHACL warning on overlapping sets. |
| R4.2 | Sparse attestation — most tranches never get attested, `ProposerTrackRecord` is mostly null. | medium | UX: validator nudges via notification; pool-mandated default that disbursement past tranche N requires tranche N-1 attestation. |
| R4.3 | Reputation gaming — proposer pumps up easy deliveries to inflate score before going for a big grant. | medium | Matchmaker: weight `outcomeScore` by `(delivered_amount + 1)` so $50 deliveries don't outvote $50k deliveries; document. |
| R4.4 | Rescission abuse — bad-faith steward rescinds to harm a proposer's reputation. | high | UX: dispute path (S4.5); audit log of all rescissions; pool-root override. |
| R4.5 | Outcome attestation latency feeds into matchmaker before evidence is reviewed. | medium | Architecture: matchmaker reads `ProposerTrackRecord`; rescissions / disputes pause projection updates. |
| R4.6 | The simple matchmaker formula doesn't reward repeat delivery enough (Laplace smoothing dampens). | low | Tune the formula in production; the architecture is correct, the constants are tunable. |

### Demo script (Maria + Pastor David + 3rd steward as validator, 10 clicks)
**Setup**: pool funded; round awarded to Maria; tranche 1 disbursed (from Phase 3 demo).

1. Sign in as 3rd steward (designated validator). Land on `/h/catalyst/rounds/demo-trauma-care-q2/outcomes`.
2. See "Tranche 1: awaiting attestation" for Maria's award.
3. Click. Modal: outcome kind dropdown (delivered / partial / not_delivered / disputed), quality slider 1-5, evidence URL (paste a notes link), confirm.
4. Submit. Toast: "Outcome attestation emitted." `sa:OutcomeAttestationAssertion` lands.
5. Refresh `/h/catalyst/rounds/demo-trauma-care-q2/proposals`. Maria's row now shows track-record badge: "1 delivered (q4)".
6. Sign in as Maria. On her `/h/catalyst/intents/[id]` (or `/h/catalyst/discover`), her own track record shows.
7. Sign in as a future steward of a NEW round (`demo-coaching-q3`). On that round's review surface, Maria's prior delivery shows.
8. **Adversarial sub-demo**: as Pastor David, simulate a bad outcome — attest tranche 2 as `not_delivered`, quality=1.
9. As Pastor David, click `grant_proposal:rescind` on Maria's award. Reason URL paste. Confirm.
10. As Maria, see notification: "Award rescinded. You have 7 days to dispute." Click "File dispute" → upload counter-evidence → submitted.
11. As pool root, see "Open dispute" → review evidence → choose "Reverse rescission" or "Uphold rescission". Either choice emits `sa:DisputeResolvedAssertion`.
12. **Matchmaker verification**: search candidates for a new trauma-care need; Maria's rank reflects her `(delivered:1, not_delivered:1)` track record per the formula.

### Effort sizing — **M → L**
Outcome attestation flow + UI (~M); rescission + dispute flow + UI (~M); validator-set delegation pattern (reuses steward pattern, ~S); `sa:ProposerTrackRecord` GraphDB projection (~S, but with care for ordering); matchmaker integration (~M, plus a regression suite for rank stability); admin/analyst dashboard (~S). 3–4 weeks. Pushes to L if validator-set delegation needs its own caveat suite parallel to the steward one (it shouldn't — recommend reusing).

---

## Bucket 5 — Steward Sig Collection Flow (cross-cutting prerequisite)

### Goal in one sentence
Build the `treasury_proposal:*` MCP tools that collect EIP-712 sigs from N-of-M stewards before `closeRound()` (and Phase 3 disbursement), so that the system actually requires steward consensus instead of operating under deployer auth.

### The user problem this solves
Today, `closeRound()` accepts awards directly under deployer auth. That works for the demo; it does not work for "real money under steward control." Bucket 5 is the cryptographic spine of every other bucket from here on. Without it, Phase 3 is a fiction (stewards aren't signing — the deployer is).

### User stories

**S5.1 — "As a steward, I want to see treasury proposals awaiting my signature, so that I can review and sign without hunting through Slack threads."**
Acceptance:
- `/h/catalyst/treasury` page lists treasury proposals visible to the signed-in steward, grouped by pool, status (`collecting | ready | executed | expired`), and progress (sigs collected / threshold).
- Each row drills into `/h/catalyst/treasury/[proposalId]` showing the EIP-712 payload (roundId, awardsRoot, decisionDate, expiresAt, stewardSetHash) + the awards list (proposalIRI, recipient, totalAmount, tranches).
- Sig button is prominent. Per-steward sig-status indicator (signed / not signed / approved-via-hash).

**S5.2 — "As a steward, I want to sign a treasury proposal with my AgentAccount (passkey), so that I don't need an EOA private key just to participate."**
Acceptance:
- Sign button supports three sig types matching `QuorumEnforcer` v-byte discrimination: ECDSA (EOA stewards), ERC-1271 (AgentAccount-backed stewards via passkey), and `approveHash` pre-approval (passkey stewards who can't easily produce off-chain sigs).
- The submission goes through `treasury_proposal:sign` MCP tool which validates against current STEWARDSHIP signer set + the v-byte type.
- For `approveHash` path, the UI calls `ApprovedHashRegistry.approveHash(payloadHash)` from steward's `AgentAccount` then calls `treasury_proposal:sign` with `v=1`.

**S5.3 — "As a lead steward, I want to assemble collected sigs and bundle them into the disbursement userOp, so that the actual on-chain redeem happens after sigs land."**
Acceptance:
- Once `sigsCollected >= threshold`, a "Ready to execute" banner appears for the lead steward.
- `treasury_proposal:assemble` packs the sigs in Safe-format (sorted-ascending, 65-byte slot, EIP-1271 dynamic-tail) ready as `args` for `QuorumEnforcer.beforeHook`.
- Lead steward kicks `treasuryDisburse.action.ts` which calls `assemble` + `redeemDelegation` in one orchestrated call.
- On success, `treasury_proposal:mark_executed` flips status; the proposal disappears from pending lists.

**S5.4 — "As a steward set, I want a treasury proposal to expire if not signed within a configured window, so that stale proposals don't accumulate forever."**
Acceptance:
- `treasury_proposal:create` takes `expiresAt`; default = 14 days.
- A daily background job marks expired proposals; UI hides them after expiry.
- Expired proposals have a "Recreate" CTA for the lead steward.

**S5.5 — "As a steward whose eligibility was just removed, I want any in-flight proposal sigs I made to be invalidated automatically, so that a kicked steward can't continue gating disbursements."**
Acceptance:
- `treasury_proposal:list_pending` filters at query time: any proposal where the signer set now contains an ineligible steward shows status `degraded`.
- A `degraded` proposal can either be (a) re-collected with the new signer set or (b) ignored and let expire.
- Forge test: a steward signs, gets removed, the next `assemble` call fails with `StewardNotEligible(signer)`.

**S5.6 — "As an operator, I want to see real-time sig-collection metrics, so that I can identify a steward who is consistently slow to sign and follow up off-chain."**
Acceptance:
- Admin dashboard `/admin/treasury` shows: open proposals, avg time-to-threshold, per-steward sign-rate.
- Per-steward sign-rate panel surfaces "Maria signed 3/4 last month, mean response 18h."

**S5.7 — "As a developer, I want the sig-collection flow to be reachable from a CLI as well as the web UI, so that stewards can integrate with their own tooling (Slack bots, mobile, etc.) without UI lock-in."**
Acceptance:
- The MCP tools (`treasury_proposal:create / sign / list_pending / assemble / mark_executed`) are callable via the standard MCP CLI flow with steward delegation tokens.
- A reference CLI script `scripts/treasury-cli.ts` walks through create → list → sign → assemble end-to-end.

### Out of scope (Bucket 5)
- Bond-collateralized signing (slashing for missing sigs) — overkill for small steward sets.
- Threshold signature aggregation (BLS, FROST) — single-sig-per-steward is operationally simpler for small sets.
- A dedicated `treasury-mcp` service (per `safe-architecture-comparison.md` § 6, fold into `org-mcp`).
- Sig collection over multiple rounds in a single proposal (one proposal = one round = one EIP-712 payload).

### Dependencies on other phases
- **Hard upstream:** Phase 2 (`QuorumEnforcer` contract — done) + Phase 1 sig-rehearsal MCP tools (already laid out in plan § 7 Phase 1; need to verify what's actually shipped).
- **Hard downstream:** Phase 3 cannot work without Bucket 5 (real disbursement = real sigs).
- **Soft downstream:** Phase 2.7 discretionary disbursement is single-signer by design and does NOT depend on Bucket 5; that's why it can ship in parallel.

### Risks
| ID | Risk | Severity | Mitigation owner |
|---|---|---|---|
| R5.1 | EIP-712 domain mismatch between off-chain sig and on-chain `QuorumEnforcer` verification. | **HIGH** | Contracts + web: golden-file test with known sig + known payload, run against forge. Domain separator built from the Pool's address (not a global one) so each pool has its own domain. |
| R5.2 | Sig collection UX is too steward-heavy and stewards stop signing, system stalls. | high | UX: notification + email on sig requests; per-steward dashboard; reasonable expirations to recycle stalled proposals. |
| R5.3 | Eligibility-registry drift between sig-collection time and assemble time (steward signs while eligible, gets removed before assemble). | medium | Contracts + MCP: `assemble` re-verifies eligibility; `degraded` status surfaced in UI. |
| R5.4 | ApprovedHash race — steward calls `approveHash` then signs `v=1` but the on-chain `approveHash` call hasn't been mined when assemble fires. | medium | Web: assemble waits for approveHash tx confirmation before treating sig as valid. |
| R5.5 | Sigs leak via the org-mcp DB — anyone with read access sees in-progress allocations. | medium | Security: ensure org-mcp's `treasuryProposals` table is read-gated by STEWARDSHIP delegation; non-stewards cannot list. |

### Demo script (Maria + Pastor David + 3rd steward, 10 clicks)
**Setup**: round closed, awards decided off-chain by stewards in a meeting, ready to encode on-chain.

1. Sign in as Pastor David (lead steward). Click "Close round" CTA on `/h/catalyst/rounds/demo-trauma-care-q2`.
2. Modal: paste awards JSON. Click "Create treasury proposal." Action layer calls `treasury_proposal:create`.
3. Banner: "Proposal created. 0/3 signatures collected." Other stewards notified.
4. Sign out, sign in as 2nd steward. Land on `/h/catalyst/treasury`. See pending proposal. Click into it.
5. Review awards list. Click "Sign with AgentAccount." Passkey prompt. Sig submitted via `treasury_proposal:sign`.
6. Banner updates to "1/3 signatures." Sign out, sign in as 3rd steward.
7. Same flow — sign, banner updates to "2/3 signatures."
8. Sign in as a 4th steward who happens to be passkey-only and chooses approveHash path. Click "Approve hash on chain" → tx prompt → tx lands → `treasury_proposal:sign(v=1)` → "3/3 signatures, ready to execute" banner.
9. As Pastor David (lead), see "Ready to execute" CTA. Click it. `treasury_proposal:assemble` runs, packs sigs, calls `redeemDelegation`. SESSION_DELEGATION minted.
10. Verify on chain: SESSION_DELEGATION hash registered. Verify in MCP: proposal status `executed`. Round status flips to `AllocationDecided` with full sig provenance.

### Effort sizing — **L**
Five MCP tools (~M, but with careful sig-format handling); two web action layer pieces (`roundClose.action.ts` already exists per shipped, needs sig-collection wiring; `treasuryDisburse.action.ts` is new) (~M); UI pages (`/h/catalyst/treasury` index + detail + admin dashboard) (~M); revert-path forge tests (~M); golden-file EIP-712 test (~S). 2.5–3 weeks. The risk surface (R5.1, R5.5) keeps it firmly L; underestimating sig-format edge cases is the typical way this slips.

---

## Cross-cutting

### Sequencing recommendation

**Recommended order: Bucket 5 → Bucket 3 → Bucket 1 (parallel) → Bucket 2 → Bucket 4.**

Default order in the brief was 2.7 → 3 cleanup → 3 main → 4. Adjusted rationale below.

| Step | What | Why this order |
|---|---|---|
| 1 | **Bucket 5 (Steward sig collection)** first | It is the cryptographic prerequisite for Phase 3. Building Phase 3 on deployer-auth and "we'll add sigs later" is a known refactor trap; the sig path touches `treasuryDisburse.action.ts` and we should not refactor that twice. Bucket 5 also exercises the full caveat stack from a real-user surface for the first time, surfacing UX + auth bugs before money is at stake. |
| 2 | **Bucket 3 (Phase 3 cleanup)** second | Land before Phase 3 main so we're not discovering CPU saturation under real money. Cleanup is also a stable slot for a context-rich dev between high-stakes phases. |
| 3 | **Bucket 1 (Phase 2.7 Discretionary)** in parallel with Bucket 5 | Bucket 1 has no Bucket 5 dependency (single-signer by design). Doing it in parallel gives early product-feedback on the discretionary UX and pressure-tests the new caveat enforcer pattern before Phase 3 piles more enforcers on. Different developer; minimal merge friction (touches different files). |
| 4 | **Bucket 2 (Phase 3 main)** third (after 5 + 3 land) | The main event. Custody is binary; either it works or it doesn't. Best done with fresh attention after the prerequisites are stable. Recommend external security review *during* this phase (not at the end) — async review of frozen contracts in parallel with frontend integration work. |
| 5 | **Bucket 4 (Phase 4 outcomes)** last | Hard upstream dependency on Phase 3 — outcomes attest disbursements, no disbursements means nothing to attest. Also the lowest urgency: the demo can show value without it. |

**What I'd do differently from the default:** swap "Bucket 1 first" for "Bucket 5 first." Bucket 1 is a tempting easy-win, but it doesn't unblock anything — Phase 3 (the value engine) is gated on Bucket 5 cryptographic plumbing. Doing Bucket 5 first compresses the critical path.

**Optional acceleration:** Bucket 1 + Bucket 5 in parallel from week 1 (different devs); Bucket 3 by a third dev when context permits; Bucket 2 starts when 5 lands; Bucket 4 starts when 2 lands. Total elapsed: ~10–12 weeks if staffing supports parallelism.

### Risk register (top 5 across all buckets)

| Rank | Risk | From bucket | Severity | Mitigation owner |
|---|---|---|---|---|
| 1 | Custody bug — funds get stuck in pool `AgentAccount` due to enforcer logic error (R2.1). | 2 | HIGH | **Security + Contracts**: full revert-path test suite (S2.7) + external security review gate before mainnet + staged rollout (testnet → small-pool → full). |
| 2 | EIP-712 domain mismatch between off-chain sig and on-chain `QuorumEnforcer` verification (R5.1). | 5 | HIGH | **Contracts + Web**: golden-file test with known sig + known payload, ran against forge in CI. Domain separator built from Pool address. |
| 3 | MultiSendCallOnly delegatecall vulnerability — escalation path (R2.4). | 2 | HIGH | **Contracts**: stick with CallOnly variant for treasury path; never expose full MultiSend (delegatecall-allowing) on disbursement paths; forge invariant test that escalation is impossible. |
| 4 | Validator collusion — same humans wear steward + validator hats; attestations rubber-stamp (R4.1). | 4 | high | **Security + UX**: pool root key strongly nudged to set disjoint validator sets > $50k; SHACL warning on overlap. |
| 5 | Sig collection UX too heavy — stewards stop signing, system stalls (R5.2). | 5 | high | **UX**: email + push notifications on sig requests; per-steward dashboard; sensible expirations; one-click "approve hash" for passkey users. |

### Success metrics (production-grade, not just "tests pass")

**Per bucket:**

| Bucket | Production-grade success looks like |
|---|---|
| 1 (Discretionary) | At least 5 real discretionary allocations made by 3+ different stewards in the first 2 weeks live. Time-from-need-posting to allocation-decision <24h median. Zero `KindNotAccepted` reverts in production (the UX prevents the attempt). |
| 2 (USDC custody) | Total USDC custody flowing through pools > $X (PM to set threshold by demo audience). Zero stuck funds. Revert rate at any caveat enforcer < 5% of attempts (most reverts should be caught in UI pre-check). p95 disbursement latency from sig-threshold to confirmation <5min. |
| 3 (Cleanup) | GraphDB CPU sustained < 60% under Phase-3 production load. Sync lag p95 < 5s. Zero IA P4 violations in CI grep checks. |
| 4 (Outcomes) | Attestation coverage > 70% of disbursed tranches within 30 days of disbursement. `ProposerTrackRecord` populated for > 80% of repeat proposers. Matchmaker rank changes detectably correlate with track record (regression metric: rank-stability test passes). |
| 5 (Sig collection) | Median time-to-threshold < 48h on routine proposals. Steward sign-rate > 80% per steward. Zero `degraded` proposals due to eligibility drift in production (rotations are coordinated with proposal queues). |

**Cross-cutting** (the system as a whole):
- Time-from-pledge to disbursement (median) shows the system is moving real money on real timescales: target < 5 weeks for a Round-based grant, < 24h for a discretionary allocation.
- Zero security incidents requiring fund recovery.
- Demo script for each bucket runs cleanly from `fresh-start.sh` (any drift from this is a regression).
- New-steward time-to-first-sign < 30 minutes from invitation.

### Stakeholder map (who needs to see / approve what, in what order)

| Bucket | Approval gate sequence |
|---|---|
| 1 (Discretionary) | PM (problem framing) → Ontologist (new emit class T-Box) → Security (NeedMandateMatchEnforcer caveat scope review) → IA (privacy review for discretionary anchoring per R1.4) → Developer → Tester → Reviewer → QA → Test User. Standard pipeline. |
| 2 (USDC custody) | PM → **Security review gate (mandatory; external reviewer recommended)** → Contracts → Developer → Tester → Reviewer → QA → Test User → **Security re-review gate before mainnet rollout** → Operations runbook approval → Live. The security gates are non-negotiable; this is the only bucket where money is at stake. |
| 3 (Cleanup) | PM (low-touch) → Infra → Developer → Tester (load test specifically) → Reviewer → QA. No external review needed. |
| 4 (Outcomes) | PM → Ontologist (new emit classes + projection) → Security (validator-set delegation pattern review) → IA (track-record privacy classification) → Developer → Tester → Reviewer → QA → Test User → matchmaker-stability regression sign-off. |
| 5 (Sig collection) | PM → Security (EIP-712 domain spec review; ApprovedHash pattern review) → Contracts (QuorumEnforcer revert-path coverage) → Developer → Tester → Reviewer → QA → Test User → **Security re-review before Phase 3 starts**. |

The **Security Review gate before Phase 3 mainnet** is the single most important checkpoint in this plan. Until that gate passes, Phase 3 stays on testnet. Recommend booking an external auditor's calendar slot the same week Bucket 5 lands so the audit window aligns with Phase 3 contract freeze.

**Security gate detail (Bucket 2 specifically):**
- **Pre-implementation gate** (start of bucket): security agent reviews the disbursement happy-path + all enforcer revert-paths in a written threat model. Sign-off before contract changes start.
- **Mid-implementation gate** (contract freeze): contracts handed to external auditor as a tagged commit. Auditor scope = `MultiSendCallOnly`, `QuorumEnforcer`, `PoolMandateEnforcer`, `RoundDecisionWindowEnforcer`, `AllocationLimitEnforcer`, `StewardEligibilityRegistry`, `ApprovedHashRegistry`, `IAccountGuard` slot, plus the `treasuryDisburse.action.ts` orchestration. Findings tracked in a public `output/security-audit-findings.md`.
- **Pre-mainnet gate** (post-audit): all critical / high findings resolved. Medium findings tracked with a public mitigation timeline. Low findings documented. PM + Security + Contracts sign off.
- **Pilot gate** (first mainnet pool, $5k cap): pilot runs for 14 days under enhanced monitoring (every disbursement reviewed by Security within 24h). PM owns the abort signal.
- **Full rollout gate** (post-pilot): pilot retro complete, no incidents, ready for general availability.

### Communication cadence and PM ownership

This is a 13–16 week build. PM owns the following coordination cadence:

- **Weekly stand-up readout** (Mondays): per-bucket status (red / amber / green), top blocker, top decision needed. Distributed to PM, Security, Contracts, Web, UX, Operations.
- **Bi-weekly demo** (Fridays of demo week): the bucket(s) currently in flight get demoed end-to-end on a fresh-start clone. Demo failures count as bucket regressions.
- **Phase gate review** (end of each bucket): PM-led 60-min review with stakeholders, decision: ship / hold / kick. Output: written gate decision in `output/treasury-gate-decisions.md`.
- **Risk register refresh** (every 2 weeks): top-5 risk list (this doc § Cross-cutting) updated; new risks added, mitigated risks closed.
- **External communication** (per-bucket): release notes for shipped features land on the Catalyst hub home page; Security incident comms (if any) are the highest priority.

---

## Appendix A — Per-bucket effort + sequencing summary

| Bucket | Goal | Effort | Critical path? | Parallelizable? |
|---|---|---|---|---|
| 5 — Steward sig collection | Cryptographic spine for real disbursements | L (~2.5–3 wks) | Yes | With 1 |
| 3 — Phase 3 cleanup | Architecture debt before load | M (~1.5–2 wks) | No (but recommended pre-Phase-3) | With 1, 5 |
| 1 — Phase 2.7 Discretionary | Steward fast-path mutual-aid | M (~1.5–2 wks) | No | With 5 |
| 2 — Phase 3 USDC custody | Real money moves | L → XL (~4–5 wks) | Yes (depends on 5) | No |
| 4 — Phase 4 outcomes | Close the BDI loop | M → L (~3–4 wks) | No (depends on 2) | No |

**Total elapsed time, sequential**: ~13–16 weeks.
**Total elapsed time, optimal parallelism (3+ devs)**: ~10–12 weeks.

---

## Appendix A.1 — Definition of done, per bucket

A bucket is "done" only when ALL of these are true. PM owns the checklist; nothing ships without explicit sign-off.

**Bucket 1 (Phase 2.7 Discretionary):**
- [ ] All 6 user stories pass acceptance.
- [ ] `NeedMandateMatchEnforcer.sol` deployed; forge tests cover happy + 4 revert paths.
- [ ] `pool:allocate_to_need`, `pool:set_discretionary_cap`, `discretionary:revoke` MCP tools wired.
- [ ] `discretionaryDisburse.action.ts` web action layer with full visibility-cascade respect.
- [ ] "Match a need from this pool" CTA on Need detail with mandate-match badge + suppression reasons.
- [ ] Demo script runs cleanly on `fresh-start.sh`.
- [ ] T-Box updated with `sa:DiscretionaryAllocationDecidedAssertion`; sync-ontology run.
- [ ] Documentation in `docs/specs/` updated.
- [ ] Playwright test for full discretionary flow.

**Bucket 2 (Phase 3 USDC Custody):**
- [ ] All 7 user stories pass acceptance.
- [ ] External security audit complete; all critical + high findings resolved.
- [ ] Pilot phase complete (14 days, no incidents) on first mainnet pool.
- [ ] Full revert-path forge suite green (S2.7 enumeration).
- [ ] E2E happy-path + adversarial-path Playwright tests green.
- [ ] `treasuryDisburse.action.ts` + `commitmentRedeem.action.ts` shipped.
- [ ] Recipient surface (`/h/catalyst/agents/[agentId]/treasury`) shipped.
- [ ] Operations runbook written and tested (incident response, fund recovery, paymaster topup).
- [ ] Demo script runs cleanly on testnet AND on mainnet pilot pool.

**Bucket 3 (Phase 3 Cleanup):**
- [ ] All 4 user stories pass acceptance.
- [ ] Chunked SPARQL UPDATE shipped; full-graph PUT removed.
- [ ] Load test passing (10 emits/sec for 10 min, GraphDB CPU < 60%, p95 < 200ms).
- [ ] `emitPoolsTurtle` / `emitRoundsTurtle` / any `publishProjection` helper removed; CI grep guard added.
- [ ] `/admin/sync-status` page shipped.
- [ ] Developer documentation reflects new shape.

**Bucket 4 (Phase 4 Outcomes):**
- [ ] All 7 user stories pass acceptance.
- [ ] Validator-set delegation pattern shipped (reuses steward registry).
- [ ] `sa:ProposerTrackRecord` GraphDB projection populated and queryable.
- [ ] Matchmaker rank regression test green: track-record materially affects rank in expected direction.
- [ ] Rescission + dispute flow shipped end-to-end.
- [ ] `/h/catalyst/rounds/[roundId]/outcomes` + `/admin/outcomes` pages shipped.
- [ ] T-Box updated with `sa:OutcomeAttestationAssertion` payload extensions, `sa:DisputeResolvedAssertion`, etc.
- [ ] Demo script runs cleanly on `fresh-start.sh`.

**Bucket 5 (Steward sig collection):**
- [ ] All 7 user stories pass acceptance.
- [ ] `treasury_proposal:*` MCP tools shipped (5 tools).
- [ ] `/h/catalyst/treasury` index + detail pages shipped; `/admin/treasury` dashboard shipped.
- [ ] Golden-file EIP-712 test green in CI.
- [ ] All 3 sig types (ECDSA, ERC-1271, approveHash) tested end-to-end.
- [ ] Sig expiration + degraded-state UX shipped.
- [ ] Reference CLI script `scripts/treasury-cli.ts` works end-to-end.
- [ ] Security re-review sign-off: domain separator scoping, eligibility-drift handling, sig-leak prevention.
- [ ] Demo script runs cleanly with 3 different stewards on 3 different sig types.

---

## Appendix A.2 — What we are explicitly NOT building (cross-cutting v2 deferrals)

These are noted in the source plan as "v2" / "deferred"; consolidating here so PM can answer the inevitable "but what about X?" questions consistently.

| Capability | Why deferred | Resurface trigger |
|---|---|---|
| Anonymous USDC custody (Q4 in plan) | Requires tumbler / Privacy Pool contract; novel research surface. | A pool with regulatory or social need for anonymous donor flow surfaces a real use case. |
| Multi-asset pools beyond USDC + non-monetary (Q17) | Oracle dependency for cross-asset comparison; we deliberately avoid oracles. | Pool operators ask for ETH or other ERC-20 acceptance and accept oracle dependency. |
| Multi-chain treasury (Q2) | Cross-chain delegation is research-grade; bridges are attack surface. | A pool needs to span chains for compliance or reach reasons. |
| Sablier / streaming disbursements (Q16) | Adds Sablier dep; breaks per-month milestone gating story. | A pool with monthly cadence + low milestone gating need surfaces (e.g., a coaching network). |
| Hats Protocol hat-tree integration (Q18) | We have namespace tree already; Hats adds dep without v1 benefit. | Eligibility-module pattern (now in `StewardEligibilityRegistry`) battle-tested. |
| Quadratic funding strategy | Wrong trust model for our pools (steward-decided, not crowd-allocated). | A NoCo network or similar wants a public-goods crowd-vote round. |
| Moloch ragequit (donor exit rights) | Donors are not members with pro-rata claim. | Not expected; pools are charitable, not investment clubs. |
| Sponsor token / proposer staking | Adds complexity for minimal v1 benefit. | A pool sees spammy proposal abuse. |
| Validator-of-validators | Meta-layer; reputation mechanism gets too abstract. | Repeated validator collusion incidents. |
| Bond-collateralized arbitration (UMA-style) | Steward-arbitrated disputes are operationally simpler. | Steward arbitration shows bias / capture in production. |
| Cross-network reputation portability | Identity portability story not yet defined. | Multi-network pool emerges; PRs flag a need. |
| Cross-pool discretionary (one need, two pools) | UX adds complexity; rare case. | Multi-pool stewards routinely allocate to the same recipient and complain. |
| Outcome NFTs | Decorative; no functional gain over assertions. | Token-collector/PR motivation surfaces a real use case. |
| Threshold sig aggregation (BLS / FROST) | Per-steward sig works for small sets. | Steward sets > 12 routinely; sig collection becomes the bottleneck. |
| Multi-org pool (cross-org steward set) | Triggers the "should treasury-mcp be a separate service" question. | A pool's stewards span multiple organizations and no one is the natural owner. |

When any of these become "not deferred any more," PM owns the v2 spec authoring.

---

## Appendix B — File-path index for shipped baseline

For traceability, the PM lens references these already-shipped artifacts (from the brief and verified-in-repo paths):

- Caveat enforcers: `packages/contracts/src/enforcers/` (5 enforcers including `QuorumEnforcer.sol`)
- Mandate / steward registries: `packages/contracts/src/MandateRegistry.sol`, `StewardEligibilityRegistry.sol`, `ApprovedHashRegistry.sol`
- MultiSend library: `packages/contracts/src/MultiSendCallOnly.sol`
- Emit helpers: `apps/web/src/lib/onchain/poolPledgeAssertion.ts`, `poolPledgedTotalAssertion.ts`, `roundAssertion.ts`, `matchInitiationAssertion.ts`, plus 4 more shipped per Phase 1
- GraphDB sync registry: `apps/web/src/lib/ontology/graphdb-sync.ts` (`KNOWN_ASSERTION_CLASSES`)
- MCP write tools: `apps/org-mcp/src/tools/pools.ts` (3 tools), `apps/org-mcp/src/tools/rounds.ts` (3 tools), `apps/org-mcp/src/tools/grantProposals.ts` (3 tools)
- Web actions: `apps/web/src/lib/actions/poolCreate.action.ts`, `roundOpen.action.ts`, `roundClose.action.ts`, `roundCancel.action.ts`
- UI pages: `/h/catalyst/pools/new`, `/h/catalyst/rounds/new`, `/h/catalyst/pools/[poolId]`, `/h/catalyst/rounds/[roundId]`, `/h/catalyst/rounds/[roundId]/apply`, `/h/catalyst/rounds/[roundId]/proposals`
- Tests: 195/195 forge tests, 18/18 Playwright tests
- T-Box: 13 assertion classes including `sa:PoolOpenedAssertion`, `sa:AllocationDecidedAssertion`, `sa:DisputeWindowOpenedAssertion`, `sa:RoundCanceledAssertion`, `sa:GrantAwardedAssertion`, `sa:DisbursementAssertion`, `sa:OutcomeAttestationAssertion` (per plan § 3.5)
- SHACL: `docs/ontology/tbox/shacl/visibility.ttl`
- Fresh-start: `scripts/fresh-start.sh` (canonical reset; updated per Phase 1)

New file paths the buckets above will create:

- Bucket 1: `packages/contracts/src/enforcers/NeedMandateMatchEnforcer.sol`, `apps/org-mcp/src/tools/discretionary.ts` (`pool:allocate_to_need`, `pool:set_discretionary_cap`, `discretionary:revoke`), `apps/web/src/lib/actions/discretionaryDisburse.action.ts`, `apps/web/src/lib/onchain/discretionaryAllocationDecidedAssertion.ts`, "Match a need from this pool" UI surface on Need detail pages
- Bucket 2: `apps/web/src/lib/actions/treasuryDisburse.action.ts`, `apps/web/src/lib/actions/commitmentRedeem.action.ts`, recipient treasury surfaces under `/h/catalyst/agents/[agentId]/treasury`, USDC integration in pledge action layer
- Bucket 3: chunked-update implementation in `apps/web/src/lib/ontology/graphdb-sync.ts`, removal of `emitPoolsTurtle` / `emitRoundsTurtle` legacy helpers, `/admin/sync-status` page
- Bucket 4: `apps/org-mcp/src/tools/outcomes.ts`, `apps/org-mcp/src/tools/disputes.ts`, `apps/web/src/lib/actions/outcomeAttest.action.ts`, `apps/web/src/lib/onchain/proposerTrackRecord.ts` (projection), `/h/catalyst/rounds/[roundId]/outcomes`, `/admin/outcomes`, validator-set MCP tools in `pools.ts`
- Bucket 5: `apps/org-mcp/src/tools/treasuryProposals.ts`, `/h/catalyst/treasury` index + detail, `/admin/treasury`, `scripts/treasury-cli.ts`, `apps/org-mcp/src/db/schema.ts` (treasuryProposals + treasuryProposalSigs tables)

---

## Appendix C — Open product questions (PM owns; needs decision before bucket starts)

| Bucket | Question | PM recommendation | Decision date |
|---|---|---|---|
| 1 | Per-steward discretionary cap default value? | $1k per steward per month for pools < $100k; configurable. | Before bucket 1 dev starts |
| 1 | Discretionary dispute window — same 72h as round-based, or shorter? | 24h. Smaller stakes, faster cycle. | Before bucket 1 dev starts |
| 2 | First mainnet pool + amount? Pilot scope? | One trauma-care pool, $5k seed, 3 stewards (Maria + David + 1). | Before bucket 2 dev starts |
| 2 | External security review — which auditor, what scope? | Recommend single auditor for full caveat stack + MultiSendCallOnly + QuorumEnforcer; ~2-3 week budget. | Before bucket 2 contract freeze |
| 4 | Validator set default — same as steward set, or required disjoint? | Same as steward set for v1; SHACL warning on overlap > $50k pool size. | Before bucket 4 dev starts |
| 4 | Reputation portability — does proposer rep travel cross-network? | No in v1. v2 question. Document as known-limitation. | At bucket 4 kickoff |
| 5 | Treasury dashboard placement — `/h/catalyst/treasury` (hub-scoped) or `/agents/[orgId]/treasury` (org-scoped)? | Hub-scoped for v1 demo; revisit when multi-hub stewards exist. | Before bucket 5 UI work |
| 5 | Sig expiration default — 14 days (recommended) or shorter? | 14 days for v1; tunable per pool. | Before bucket 5 dev starts |

---

**End of product plan.**
