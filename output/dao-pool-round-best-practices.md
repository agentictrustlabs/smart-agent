# DAO Pool & Grant Round Best Practices — Beyond Safe

> Complement to `output/safe-architecture-comparison.md`. What does the broader DAO + on-chain grants ecosystem teach us about **pool design** and **round design** that Safe alone does not? Opinionated; adoption / divergence calls included.

---

## 1. TL;DR

### Top 5 patterns to adopt

1. **Allo's three-verb lifecycle (`register / allocate / distribute`)** is the right shape for our Round lane. Our current spec has `RoundOpened → AllocationDecided → Disbursement` — same shape, different vocabulary. Adopt the verbs explicitly so caveat enforcers and assertion classes line up phase-by-phase. ([Allo strategies docs](https://docs.allo.gitcoin.co/strategies))
2. **Profile / Anchor pattern from Allo v2 Registry**: every recipient has a long-lived identity contract (Anchor) that receives funds and can carry attestations across rounds. We already have this — `AgentAccount` *is* the Anchor. Make the analogy explicit and stop reinventing recipient state per round. ([Allo v2 README](https://github.com/allo-protocol/allo-v2))
3. **Hats Protocol eligibility-module pattern** for steward sets: an eligibility module (mechanistic `IHatsEligibility` contract or humanistic push) decides whether a wearer is in good standing *at redemption time*, not at delegation-mint time. Our `STEWARD_SET_PROXY` should consult an eligibility hook so revocation cascades **without** re-minting the STEWARDSHIP_DELEGATION. ([Hats README](https://github.com/Hats-Protocol/hats-protocol/blob/main/README.md))
4. **Sablier-style cancelable streams as an *option* for monthly tranches** — used by Optimism's RetroPGF working groups for structured vesting. Keep our discrete tranche model as the default; expose stream-as-disbursement as one strategy (Allo-style) for "monthly recurring" pledge cadences. ([Sablier grants page](https://sablier.com/grants), [Sablier Flow](https://blog.sablier.com/overview-token-streaming-models/))
5. **Snapshot + oSnap optimistic execution** as the right mental model for our off-chain N-of-M signing → on-chain redeem path. The "dispute window" idea (UMA Optimistic Oracle) is *exactly* what `sa:GrantRescindedAssertion` should formalize: an award is presumed valid unless disputed within a window. ([oSnap docs](https://docs.snapshot.org/user-guides/plugins/safesnap-osnap))

### Top 3 places to deliberately diverge

1. **No quadratic funding curve for v1.** Gitcoin/Allo's marquee strategy is `DonationVoting` (QF). Our pool taxonomy (giving fund / coaching / prayer chain) is **steward-decided**, not crowd-allocated. QF requires a matching pool funder + sybil resistance + a public donation phase — none of which fit our "steward set decides" model. Divergence justification: we are explicitly not running a public goods crowd-vote; we are running a small-trust delegated allocation.
2. **No on-chain Governor / Timelock pipeline.** Already decided. The OZ Governor `Pending → Active → Succeeded → Queued → Executed` lifecycle is overkill for 2–7 stewards. We borrow the *concept* (state machine + cancellation guardian) but encode it as caveat windows + revocation, not as a Governor contract. ([OZ Governance docs](https://docs.openzeppelin.com/contracts/4.x/api/governance))
3. **No Moloch ragequit.** Pledgers in our model are *donors*, not *members with exit rights*. Ragequit assumes pledgers retain a pro-rata claim on the pool; in our spec, a USDC pledge is a transfer, not a share. Donors can `pool_pledge:stop` *future* pledges; they cannot reclaim *past* pledges. Justification: our pools are charitable / mutual-aid / coaching commitments, not investment clubs.

---

## 2. Per-ecosystem findings

### 2.1 Gitcoin Allo Protocol v2

**The big idea.** Allo v2 separates three concerns into three contract surfaces:

- `Registry.sol` — long-lived **profiles** with **Anchor** sub-contracts that hold the recipient identity across rounds. Each profile maps 1:1 to an off-chain identity, and ownership is enforced by a profile-owner key.
- `Allo.sol` — central pool manager. Holds the pool's funds + metadata + admin pointer to a strategy. Functions: `createPool`, `fundPool`, `allocate`, `distribute`, `registerRecipient`.
- `BaseStrategy.sol` — abstract; each strategy (DonationVoting / DirectGrants / RFP / Microgrants) overrides `_registerRecipient`, `_allocate`, `_distribute`. The strategy is **bound to the pool at creation time** and is permanent for that pool.

**Lifecycle.** Strict three-phase: `register → allocate → distribute`. Each phase is its own gate. The pool manager controls phase transitions; strategy contract enforces phase rules.

**Roles.** Pool Manager (sets policy + pulls remaining funds via `recoverFunds`), Profile Owner (recipient identity), Allocator (phase-2 actor — can be open or whitelisted depending on strategy), Distributor (phase-3 — usually pool manager or open).

**Sybil defense.** External; bound at the strategy level. Gitcoin Passport stamps gate the *donor* in DonationVoting strategies. Recommended threshold = 20 (out of 100) — high enough to filter bots, low enough to keep humans included.

**Maintenance status.** Allo entered maintenance mode in May 2025 after Gitcoin Labs / Grants Stack wound down. Contracts remain deployed and forkable. Treat the design as a reference, not a live dependency.

> Sources: [Allo v2 docs overview](https://docs.allo.gitcoin.co/), [Strategies pattern](https://docs.allo.gitcoin.co/strategies), [Working with Pools](https://docs.allo.gitcoin.co/allo/working-with-pools), [allo-v2 GitHub](https://github.com/allo-protocol/allo-v2), [Passport scoring](https://docs.passport.gitcoin.co/).

### 2.2 Optimism RetroPGF

**The big idea.** Retroactive funding — projects are rewarded for *past* impact, not *future* promise. Voting is by a curated **Badgeholder** set (~146 in Round 3, smaller specialized cohorts in Round 5). Voting is **private** to defeat coercion / bribery.

**Phases.** (a) Application registration (project submits form), (b) Review / list creation (badgeholders curate themed lists), (c) Voting (private ballots; quadratic in Round 3, list-based in 5/6), (d) Claim (winner claims OP via on-chain redemption against an EAS attestation).

**Attestations.** RetroPGF uses **EAS (Ethereum Attestation Service)** as the public read source: badgeholder identity, project application, vote tallies, and final allocation are all EAS attestations. This is structurally identical to our `ClassAssertion` pattern.

**Curation model.** Round 5 split badgeholders into themed sub-cohorts ("OP Stack", "governance tooling", etc.), tested expert-vs-non-expert ballots in parallel, and is moving to **continuous evaluation rather than discrete rounds** for 2025+. Worth noting: large-N curation (>100 voters) wears people out and was the explicit reason for the 2025 pivot.

**Lessons for us.** (i) Private ballots matter even at small scale — coercion-resistance is not just an anti-bribery measure, it lets stewards vote honestly. (ii) Sub-cohort specialization scales better than monolithic voter sets. (iii) "Continuous" allocation > discrete rounds for ecosystems where round fatigue is real.

> Sources: [RetroPGF Round 6](https://community.optimism.io/citizens-house/rounds/retropgf-6), [Retro Funding 2025](https://www.optimism.io/blog/retro-funding-2025), [RetroPGF 3 voting badge distribution](https://gov.optimism.io/t/retropgf-3-voting-badge-distribution/6557).

### 2.3 Moloch v2 / Baal (MolochV3)

**The big idea.** A guild treasury where members hold **shares** (governance + exit) or **loot** (exit only). All proposals follow `submit → sponsor → vote → grace period → execute`. The novelty is **ragequit**: a member can burn shares during grace period to withdraw their pro-rata claim on the treasury *before* a proposal they dislike executes. This is the canonical "exit, don't fight" mechanism.

**Tribute / sponsoring.** Submitters pay a sponsor token; a member with minimum threshold must sponsor before the proposal goes to vote. Anti-spam.

**Treasury layer.** Baal explicitly delegates custody to a Gnosis Safe via Zodiac. Governance lives in Baal; assets live in Safe. The two are loosely coupled — exactly the "Pool Agent vs Steward Set" separation we have.

**Why ragequit doesn't apply.** Moloch members put capital in *expecting it back* (or expecting governance influence over its deployment). Our pledgers donate to a charitable / coaching / mutual-aid pool *without* expecting return. Unit (USDC for monetary, prayer-minutes for non-monetary) is *consumed*, not held.

**What does apply: the "minimum retention" trip-wire.** Baal lets a DAO set "if outstanding shares fall below X during ragequits, the proposal auto-fails." Translate to our world: a pool can declare a *minimum-pledge floor* below which a round auto-cancels. This is a useful safety valve for a coaching pool whose donors withdraw faster than expected.

> Sources: [MolochV3 Baal](https://moloch.daohaus.fun/), [DAOhaus user guide](https://daohaus.mirror.xyz/9zJrqvsPGwwqrz89Eea6RdsBd8ba9ZG0oCjY05_BXsY), [MolochV3 Medium](https://medium.com/@molochmystics/molochv3-8eb732cd0930).

### 2.4 Aragon OSx

**The big idea.** Three primitives: `DAO`, `PermissionManager`, `Plugin`. Everything else is composition.

- **Permission tuple**: `(who, where, permissionId)` → `ALLOW_FLAG | UNSET_FLAG | conditionContract`.
- **Conditional permissions**: `IPermissionCondition` is a tiny contract whose `isGranted(who, where, permissionId, msg.data)` decides per-call. **This is exactly our caveat enforcer pattern.** Aragon arrived at the same shape independently.
- **Plugin Setup Processor** orchestrates install / upgrade / uninstall as a two-step approved flow: PSP gets `ROOT_PERMISSION_ID` temporarily, configures permissions, immediately renounces. The renunciation pattern is the right mental model for any "elevated installer" we add to the Smart Agent factory pipeline.

**Multiple plugins compose.** A DAO can have a `Multisig` plugin AND a `TokenVoting` plugin AND a custom `TreasuryStream` plugin simultaneously. Each is granted the specific subset of permissions it needs (transfer USDC, change a registry, etc.). No catch-all admin role.

**Comparison to caveat-stack.** Aragon's `(who, where, permissionId, condition)` ≈ our `(delegator, target, selector, caveat[])`. The differences:

| Axis | Aragon | Smart Agent |
|---|---|---|
| Authority chain | Flat — direct grant from DAO | Nested — `ROOT_AUTHORITY → STEWARDSHIP → SESSION` |
| Revocation | `revoke(who, where, permId)` | `revokeDelegation(hash)` walks chain |
| Per-call data | `msg.data` available to condition | `args` separately encoded |
| Off-chain compose | Hard — every grant is a tx | Easy — sign delegation, redeem later |

Our nested-authority model is **strictly more expressive** for the case where a steward set needs to spawn a per-round sub-key. Aragon's flat model is *cleaner* for static role assignments. Both should coexist in our heads; we already chose nested.

> Sources: [Aragon OSx core](https://devs.aragon.org/docs/osx/how-it-works/core/), [OSx PermissionManager reference](https://devs.aragon.org/docs/osx/reference-guide/core/permission/PermissionManager/), [MetaLamp deep dive](https://metalamp.io/magazine/article/aragon-dao-v2-plugins-permissions-and-the-new-osx-architecture).

### 2.5 OpenZeppelin Governor + Timelock

**The big idea.** A proposal walks a state machine: `Pending → Active → (Succeeded | Defeated) → Queued → Executed | Canceled | Expired`. The Timelock controller adds a `schedule → wait → execute` layer between vote-pass and actual call.

**The Cancellation Guardian.** A separate role — **canceller** — can move any `Pending` operation back to `Unset`. OZ docs are emphatic: only the Governor itself should hold canceller; granting it to another EOA is "very risky" because that EOA can DoS approved proposals. The role exists specifically to stop a malicious or buggy proposal between vote-pass and execution.

**Adopt selectively.**

1. **State machine names.** Our spec has implicit states (round opened / round closed / awarded / disbursed). Make them explicit, OZ-style: `RoundDraft | RoundOpen | RoundClosed | AllocationDecided | TrancheReleased | RoundClosed | RoundCanceled`. SHACL shapes can enforce transitions.
2. **Timelock pattern.** Between `AllocationDecidedAssertion` (steward sigs verified) and `DisbursementAssertion` (USDC actually moves), insert a **dispute window** (24–72h). This is the same `Waiting → Ready → Done` shape OZ uses, but encoded as a `TimestampEnforcer` lower-bound on the SESSION_DELEGATION.
3. **Cancellation guardian.** Designate one steward (or a higher-trust role: pool root key) as the canceller who can revoke the SESSION_DELEGATION between AllocationDecided and Disbursement if a dispute arises. Single canceller, like OZ recommends.

> Sources: [OZ Governor 5.0](https://docs.openzeppelin.com/contracts/4.x/api/governance), [TimelockControl source](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/governance/extensions/GovernorTimelockControl.sol), [Tally docs](https://docs.tally.xyz/user-guides/governance-frameworks/openzeppelin-governor).

### 2.6 Snapshot + SafeSnap + oSnap

**The big idea.** Off-chain vote on Snapshot (gasless, signature-based ballots), on-chain execution via a Zodiac module on a Safe.

- **SafeSnap (Reality.eth)** — vote outcome is asked as a Reality.eth oracle question; bond-collateralized arbitration decides truth; 24h cooldown then execution.
- **oSnap (UMA)** — vote outcome is *asserted* by an executor; UMA Optimistic Oracle dispute window opens (typically 24–72h); if no dispute, executes; if disputed, UMA arbitration decides.

**The pattern.** Off-chain vote (cheap, expressive) + on-chain assertion + dispute window (cheap default path; expensive only if challenged) + on-chain execution. **This is structurally identical to our model**: stewards sign EIP-712 off-chain, lead steward redeems on-chain via QuorumEnforcer. The missing piece is the *dispute window*.

**Adopt: insert an explicit dispute window.** Our `sa:AllocationDecidedAssertion` should commit a `disputeUntil = decisionDate + 72h`. The `RoundDecisionWindowEnforcer` we already plan should require `block.timestamp >= disputeUntil` as a precondition. If a dispute is filed (`AgentDisputeRecord.fileDispute`) within the window, the SESSION_DELEGATION is revocable by the cancellation guardian.

**UX adoption.** Snapshot's proposal page is the de-facto UX for "show in-flight governance items + voter tally + countdown." Our org-mcp `treasury_proposal:*` tools should mirror this surface: list proposed allocations, show signatures collected (M-of-N progress bar), countdown to dispute window close.

> Sources: [oSnap docs](https://docs.snapshot.org/user-guides/plugins/safesnap-osnap), [SafeSnap Reality](https://docs.snapshot.box/v1-interface/plugins/safesnap-reality), [UMA oSnap announcement](https://medium.com/uma-project/announcing-osnap-gasless-snapshot-voting-with-on-chain-execution-by-uma-7374ed729b28).

### 2.7 Hats Protocol

**The big idea.** Roles are wearable ERC-1155 tokens. Hats form a tree: a parent hat is admin of its children. Modules slot into each hat:

- **Eligibility module** (`IHatsEligibility`) — does this address *qualify* to wear this hat? Pulled at every check.
- **Toggle module** (`IHatsToggle`) — is this hat *active* right now?
- **Hatter contract** — custom admin logic (staking, eligibility checks before mint).

**Revocation cascade.** When eligibility flips false, the hat is **burned automatically** (revoked). For downstream actions: Hats does NOT retroactively invalidate prior actions; that's external systems' responsibility. But it DOES instantly stop future actions because access checks query eligibility at call time. **Tophats** are root-of-tree, self-administered.

**Critical adoption: eligibility-module pattern for steward sets.** Our plan currently revokes the STEWARDSHIP_DELEGATION when the steward set rotates (plan § 4.3). That's coarse. Better:

1. The STEWARDSHIP_DELEGATION delegates to a `STEWARD_SET_PROXY` whose `isValidSignature` first calls a `IStewardEligibility` module to confirm each signing steward is currently in good standing.
2. Adding/removing a steward = updating the eligibility module's mapping = single SSTORE, no delegation re-mint, no cascade re-mint of in-flight SESSION_DELEGATIONs (those continue to be valid but with reduced quorum).
3. `sa:StewardSetUpdatedAssertion` fires from the eligibility module's update event, not from the delegation chain.

This is a meaningful simplification of plan § 4.3.

**Hat tree → hierarchical pools.** A Catalyst NoCo Network "supreme pool" holds a Tophat that is admin of "Wellington Circle pool" and "Loveland Circle pool" hats. Revoking the Catalyst Tophat doesn't destroy the sub-pools, but does sever their admin chain. Useful: see Q8.

> Sources: [Hats Protocol main repo](https://github.com/Hats-Protocol/hats-protocol), [Hats README](https://github.com/Hats-Protocol/hats-protocol/blob/main/README.md), [Hats docs](https://docs.hatsprotocol.xyz/).

### 2.8 Llama (acquired by Uniswap, 2023)

**The big idea.** Onchain policy framework: `LlamaCore` orchestrates `Action`s; `LlamaPolicy` mints role NFTs (non-transferable); `LlamaStrategy` defines approval rules per action; `LlamaAccount` holds assets.

**Action lifecycle.** `create → approve → queue → execute` (with `disapprove` and `cancel` short-circuits). Each action carries a policy reference; the strategy decides quorum by reading approver role-holders from the policy NFT.

**Strategy variants (reference implementations).**
- `LlamaRelativeQuantityQuorum` — % of role-holders must approve.
- `LlamaAbsoluteQuorum` — fixed N.
- `LlamaAbsolutePeerReview` — peer signoff with abstain.
- `LlamaRelativeUniqueHolderQuorum` — % of unique addresses (sybil-aware).

**Treasury operations.** Llama's value-add to clients (Aave, PoolTogether, Uniswap, FWB, Gitcoin, ARCx) was *operations*, not contracts: categorizing inflow/outflow, linking transactions to proposals, multi-asset reporting. The contracts are a thin substrate; the operational discipline is what enterprises pay for.

**Lessons.** Llama's `Strategy` ≈ Allo's `Strategy` ≈ our caveat stack (different names, same idea). The pattern is universal: **separate "what is this action" from "who can approve it" from "where does the asset live."** We already do this; affirming the pattern is canonical.

> Sources: [Llama framework docs](https://docs.llama.xyz/framework/policies), [llamaxyz/llama GitHub](https://github.com/llamaxyz/llama).

### 2.9 Sablier / Superfluid Streaming

**Sablier** = closed-ended streams (fixed deposit, fixed end). Best for: vesting, grant tranches, payroll with known duration. Distribution curves: linear, cliff, stepped, monthly unlocks, custom. Cancellation + clawback supported. **Sablier Flow** (2024) adds open-ended streams that can be paused / topped-up.

**Superfluid** = open-ended streams (perpetual flow until balance depletes). Best for: salaries, subscriptions, ongoing protocol incentives.

**Use in DAOs.** Optimism RetroPGF working groups use Sablier for structured vesting of OP tokens. Sablier's Merkle-lockup contracts include a clawback grace period (7 days post-claim). DAOs adopting streaming for monthly contributor pay is a 2024–2025 trend.

**For us: streaming as one disbursement strategy.** Our default is *discrete tranches* (good for milestone-gated grants). For a "monthly recurring pledge → monthly recurring disbursement" pattern (Wellington Circle monthly $50 → coach monthly $50), streaming is a better fit:

- One on-chain stream per recipient = O(1) gas amortized over the duration.
- Cancellation = single tx; recovers unstreamed funds.
- No per-month QuorumEnforcer signature-collection round.

But streaming **breaks the milestone-gating story**. If the disbursement is "monthly unless milestone fails", you need a per-month attestation (or a per-month cancel decision). Steward set effort doesn't go away; it shifts from "approve each month" to "approve to stop." Tradeoffs in Q5.

> Sources: [Sablier streaming overview](https://blog.sablier.com/overview-token-streaming-models/), [Sablier Flow](https://sablier.com/), [Sablier grants page](https://sablier.com/grants), [Superfluid](https://defillama.com/protocol/superfluid).

### 2.10 Endaoment / DAFs

**The big idea.** Donor-advised funds — donor contributes, gets immediate tax receipt, recommends grants over time; the platform (501(c)(3) sponsor) approves and disburses. Endaoment puts this on chain with smart-contract-backed DAFs and supports multi-asset donations (cash, stock, crypto).

**Roles.**
- **Donor** — funds the DAF; recommends grants.
- **Fund Advisor** — optional delegated decision-maker (donor's family, investment advisor).
- **Endaoment** — fiscal sponsor; approves grants for compliance with current laws/policies; transfers funds within ~48h.
- **Recipient** — IRS-recognized 501(c)(3).

**Pooled DAFs / Community Funds.** Endaoment's "Community Funds" let token holders pool to support nonprofits with collective allocation — a real-world analog of our Pool lane. Specific governance details aren't published, but the structure is: many donors → one DAF → community vote → disbursement.

**Universal Impact Pool (UIP).** Algorithmic matching pool — an additional layer that amplifies donations across the platform. Closest to a quadratic-funding-style match without the explicit QF curve.

**Lesson: the fiscal-sponsor role.** A DAF has an explicit *compliance approver* between donor recommendation and disbursement. In Web3 grants, this role is usually conflated with "steward" — but Endaoment splits it. **Worth mirroring in our model:** the steward set decides *whom*; an additional `ComplianceApprover` role (could be the pool root key, could be a third-party validator) confirms *legality / mandate-fit*. Our `PoolMandateEnforcer` already encodes mandate-fit on-chain — what's missing is an *attestation* role that signs off. See plan delta § 4.

> Sources: [Endaoment docs](https://docs.endaoment.org/donors/about/donor-advised-funds), [Endaoment donor page](https://endaoment.org/donors), [Endaoment overview](https://endaoment.org/).

---

## 3. Per-question recommendations

### Q1 — Pool / Strategy separation (Allo v2)

**Recommendation: do NOT split for v1; revisit at v2.**

Allo's split (`Allo.sol` holds capital + admin pointer; `Strategy.sol` holds rules) makes sense when you have many competing strategies (QF, direct grants, RFP, microgrants) being authored by third parties. Our reality:

- We have **one** allocation pattern in flight — steward N-of-M decides.
- We don't expect third-party strategy authors any time soon.
- Splitting `Pool` (capital) from `Strategy` (rules) doubles the contract count and adds an extra hop for every disbursement.

What Allo's flexibility *buys*: easy plug-in of new allocation logic without touching the pool. We don't need that yet.

**However — in the SDK type system, do split.** A `Pool` type holds capital + steward set; a `Round` type holds the strategy (mandate, decision rules, deadline). When v2 brings additional allocation strategies (lottery? matching? quadratic), the type-level split lets us add new `Round` subtypes without changing `Pool`.

**Action.** Keep contracts collapsed. Split TS types. Document the "Strategy = Round" mapping in the SDK so future v2 has an obvious slot.

### Q2 — Round phases

**Current spec.** `Open → ProposalsReceived → Closed → Awarded → Disbursed` (~5 phases).

**Mature ecosystems.** `Register → Apply → Review → Decide → Claim → Report → Close` (7 phases).

**Recommendation: add three phases, fold one.**

| Add | Why | Source pattern |
|---|---|---|
| `Review` (between submit and decide) | Stewards need a discoverable, auditable "proposals-under-review" surface. Today this is implicit; make it explicit. | RetroPGF List Creation; Allo's `register` phase post-submission |
| `DisputeWindow` (between Decide and Disburse) | The off-chain `oSnap` pattern. 24–72h gives the cancellation guardian time to revoke a bad allocation. | oSnap, OZ Timelock |
| `Report` (post-disbursement) | Outcome attestation lives here. Already planned (`sa:OutcomeAttestationAssertion`) but isn't a named phase. | RetroPGF round 5+, Endaoment 12-month report cadence |

| Fold | Why |
|---|---|
| `ProposalsReceived` is not a phase — it's a counter event during `Apply`. | Already noted in plan § 2.2 R2 (recommend skip the assertion). |

**Revised state machine:**

```
RoundDraft → RoundOpen → RoundReview → AllocationDecided → DisputeWindow → TrancheReleased* → ReportingOpen → RoundClosed
                                                          ↓ (dispute filed)
                                                          → RoundCanceled / GrantRescinded
```

`TrancheReleased*` repeats per tranche. SHACL shapes encode allowed transitions.

### Q3 — Eligibility / Sybil

**Where credentials bind in mature ecosystems:**

| Ecosystem | Proposer-side | Steward / voter-side |
|---|---|---|
| Gitcoin Allo | Gitcoin Passport (donor; threshold = 20) | Round operator KYC (off-chain) |
| RetroPGF | Self-attestation + EAS verification | Badgeholder NFT (curated) |
| Moloch | Sponsor-then-vote (member must sponsor) | Membership share |
| Endaoment | 501(c)(3) verification (centralized) | Donor identity (KYC for tax purposes) |

**Recommendation: bind credentials at *both* ends, but in different shapes.**

- **Proposer side**: Use our existing AnonCreds credential registry. A round can declare `requiredCredentials: [credentialDefIRI]` (already in plan § 2.2 R1). The `RoundDecisionWindowEnforcer` reads from a `CredentialEnforcer` (NEW caveat) at award-time, not at apply-time. Apply-time check is UX-only; chain-time check is binding.
- **Steward side**: Hats-style eligibility module. Stewards must hold a `sa:StewardHat` issued by the pool root key; eligibility is checked at signing time via the proposed `IStewardEligibility` module. Revocation cascades automatically per § 2.7.

**No Gitcoin Passport integration for v1.** Different trust assumption — Passport is anti-bot, our threat model is anti-fraud-within-known-network. Different tool.

### Q4 — Quadratic / Matching

**Recommendation: explicitly NOT QF for v1. No matching curves.**

Our pool taxonomy:
- **Giving fund** — donor → pool → recipient. Steward-decided allocations. *Not QF.*
- **Coaching network** — coach commits hours; recipient consumes. Unit ≠ fungible. *Not QF.*
- **Prayer chain** — same. *Not QF.*

Quadratic funding requires (a) a public donation phase where every donor's contribution is sybil-validated, (b) a matching pool funder who agrees to amplify, (c) a sybil-resistant identity layer (Passport / WorldID / PoH). Our donors are *known to the pool by trust*; the matching budget doesn't exist; we'd need to graft on Passport.

**However — leave a slot for a `MatchingStrategy` Round subtype in v2.** If Catalyst NoCo or a similar pool ever wants to run a matching-style round, the SDK should accommodate.

### Q5 — Vesting / Streaming

**Recommendation: discrete tranches by default; Sablier as opt-in `RecurringRound` subtype.**

| Pattern | When to use | Pros | Cons |
|---|---|---|---|
| **Discrete tranches** (current plan) | Milestone-gated grants; ad-hoc rounds | Clean per-tranche audit; per-tranche caveat policy; no oracle | Per-tranche steward effort; gas per disbursement |
| **Sablier stream** | Monthly recurring pledge → monthly recurring disbursement; no per-month milestone | O(1) amortized gas; cancel-on-failure; matches monthly cadence donor expectation | Requires Sablier dependency; harder to gate per-month milestone |
| **ERC-4626 vault shares** | Donor wants pro-rata claim with yield (rare) | Composable | Yield on charitable funds raises mandate questions; not fit-for-purpose |

**Architecture.** A `Round` with `cadence: "monthly"` and `recipientCount: 1` (or small N) is a candidate for streaming. Stream creation is a single `DisbursementAssertion` of kind `stream`; cancellation emits `sa:DisbursementStreamCanceledAssertion`. The QuorumEnforcer runs once at stream-creation, not per month.

For multi-recipient rounds with milestones (the typical case), stay with discrete tranches.

**Don't use ERC-4626.** Vault shares assume ownership / yield; our pools are charitable.

### Q6 — Clawback / Dispute

**Current plan.** `sa:GrantRescindedAssertion` + `AgentDisputeRecord.fileDispute`.

**What mature DAOs do beyond filing:**

1. **Streaming cancellation** (Sablier) — single call to `cancel(streamId)` recovers unstreamed funds to the originator. Operational, not adversarial.
2. **Optimistic dispute window** (oSnap, UMA) — 24–72h challenge period before execution. If challenged, escalates to bond-collateralized arbitration.
3. **Cancellation guardian** (OZ Governor) — single trusted role can revoke a Pending operation between vote-pass and execution.
4. **Sponsor slashing** (Moloch) — sponsor's offering token is forfeited if the proposal is malicious. Skin-in-the-game for the sponsor.

**Recommendation for our spec:**

- **Adopt cancellation guardian.** Pool root key (or designated lead steward) can revoke the SESSION_DELEGATION between AllocationDecided and Disbursement, OZ-style. Add `sa:RoundCanceledAssertion` and `sa:AllocationRevokedAssertion` for the audit trail.
- **Adopt dispute window.** 72h window between AllocationDecided and the first tranche disbursement. RoundDecisionWindowEnforcer requires `block.timestamp >= disputeUntil`.
- **Consider sponsor token for grant proposals.** If a proposer is malicious / spammy, their next proposal's sponsor stake is at risk. Defer to v2 — adds complexity for minimal v1 benefit.
- **Adopt streaming cancel** for stream-style disbursements (Q5).

### Q7 — Multi-asset pool

**Current plan.** Single-stablecoin v1 (USDC). Non-monetary via `CommitmentRegistry`.

**Mature ecosystem patterns:**
- **Gnosis Safe** — holds any ERC-20/721/1155 in one address. Per-token allowance modules (AllowanceModule supports per-token caps).
- **Endaoment** — multi-asset DAF (cash, stock, crypto); converts to USDC at disbursement.
- **Llama Accounts** — multi-asset; per-asset accounting via Llama's reporting layer.

**Recommendation: single-asset pool v1; multi-asset v2 via *sub-pools per asset*.**

Multi-asset accounting questions in one pool:
- "Pool has 1000 USDC + 0.5 ETH + 50 prayer-minutes — what's the *total*?" Requires oracle. We deliberately avoid oracles.
- "Allocate `$500` to Alice" — which asset? Requires oracle or fixed policy.

**Cleaner: each asset is a sub-pool (its own AgentAccount).** A "Catalyst NoCo Network" agent owns multiple sub-pool agents:
- `catalyst-usdc-pool.agent`
- `catalyst-prayer-pool.agent`
- `catalyst-coaching-pool.agent`

Each sub-pool has its own steward set (could be identical) and its own mandate. The parent agent is a coordinator, not a custody contract. **This composes naturally with the hierarchical-pool answer in Q8.**

For v2 stretch: a single `MultiAssetPool` contract that internally tracks per-asset balances and per-asset stewards. Plumbing-heavy; defer.

### Q8 — Hierarchical pools

**Recommendation: flat parent-child with namespace edges; NO Hats hierarchy for v1.**

Hats Protocol's hat-tree model is genuinely elegant — admin authority cascades, revocation cascades. But:

1. We already have `NAMESPACE_CONTAINS` edges in our agent naming architecture (per `project_naming_architecture` memory). `catalyst.agent` contains `wellington.catalyst.agent` contains `wellington-pool.catalyst.agent`. This *is* a tree.
2. Hats requires onboarding the `Hats.sol` registry contract as a dependency. Adds surface area.
3. Our tree is in *agent-naming space*, not in *capability-grant space*. Conflating them prematurely couples namespace to authority.

**For v1**: Use namespace tree for hierarchy (display, organization, search). Each pool has its own delegation chain. A "Catalyst supreme pool" delegating to "Wellington Circle pool" looks like:
- Wellington pool agent's root key = a key that the Catalyst pool's stewards co-control.
- OR: Catalyst pool is the *funder* of Wellington pool (a series of `pool_pledge:submit` calls from Catalyst → Wellington).

**For v2**: revisit Hats once the eligibility-module pattern (Q3) is in place. Hats trees become a compelling primitive for "Catalyst Tophat → Wellington steward hat → Wellington proposer hat" once eligibility modules are battle-tested.

### Q9 — Round duration & calendar

**What ecosystems do:**

| Ecosystem | Cadence | Round length |
|---|---|---|
| Gitcoin Grants Stack | ~6 rounds/year | 2 weeks (donations) |
| Optimism RetroPGF | ~1–2/year (moving to continuous in 2025) | 3 weeks (apply) + 1 week (review) + 2 weeks (vote) |
| Moloch | Per-proposal | Voting period 5 days + grace 2 days |
| Llama clients (e.g., Aave) | Weekly admin actions | 24h queue + 24h dispute |

**Lesson: round fatigue is real.** RetroPGF's 2025 pivot from discrete rounds to continuous evaluation is the strongest signal. Smaller, more focused, more frequent — but not so frequent that stewards check out.

**Recommendation:**

- **Default round length: 4 weeks.** 2 weeks proposal-open + 1 week steward review + 1 week dispute window before first tranche.
- **Steward fatigue cap: 1 round per pool per month.** A pool's steward set should not be running concurrent rounds. SHACL enforce: `sa:Pool` may have at most one `sa:Round` in `RoundOpen | RoundReview` state at a time.
- **Continuous mode (v2)**: a "rolling round" pattern where proposals can be submitted and decided ad-hoc, no fixed close. Useful for prayer chains, coaching matches. Defer.

### Q10 — Reputation feedback loop

**Current plan.** `sa:OutcomeAttestationAssertion` exists; payload includes `outcomeKind` and `evidenceURI`.

**What mature ecosystems leave behind:**

- **RetroPGF** — EAS attestations for project, voters, allocations. Future rounds can read past attestations to weight curation.
- **Gitcoin Passport** — accumulates "stamps" — verifiable credentials across rounds. Reputation is the stamp set.
- **Llama** — proposal pass/fail rates per proposer; per-role activity logs.
- **Karma3 / EigenTrust** — trust-graph algorithms over attestation streams.

**Gaps in our `OutcomeAttestationAssertion` design:**

1. **Yes/no is not enough.** Should carry `outcomeQuality: 1..5` or `delivered | partially_delivered | not_delivered | dispute`. Update T-Box `sa:OutcomeKind` enum.
2. **No proposer-reputation accumulation.** Add a derived projection: `sa:ProposerTrackRecord` in GraphDB, computed from `OutcomeAttestationAssertion`s where the asserter's recipient = proposer's agent. Read-only; not on chain.
3. **No validator-reputation.** Validators who attest outcomes themselves accrue reputation (or anti-reputation if their attestations don't match consensus). Defer — adds a meta-layer.

**Recommendation:**

- Extend `sa:OutcomeAttestationAssertion` payload with a quality enum (4–5 values, not yes/no).
- Add a GraphDB projection `sa:ProposerTrackRecord(proposerAgent, deliveredCount, notDeliveredCount, disputedCount)` derived from outcome attestations. Use this in the existing matchmaker ranking formula `0.6 * 1/(1+hops) + 0.4 * (fulfilled+1)/(fulfilled+abandoned+2)` — the `fulfilled / abandoned` numerator is exactly what we should populate from outcome attestations.
- **Tie outcome attestations into matchmaker ranking explicitly.** This is the feedback loop.

---

## 4. Plan delta — specific edits to `output/onchain-treasury-plan.md`

These are *what* to change, not the changes themselves.

| § | Edit | Why |
|---|---|---|
| § 1 (Architecture summary) | Add a paragraph: "We mirror Allo v2's `register / allocate / distribute` lifecycle in our verb names, but collapse Pool + Strategy into a single contract; we mirror Aragon OSx's conditional-permission model in our caveat enforcers; we mirror Hats Protocol's eligibility-module pattern in `STEWARD_SET_PROXY`." | Anchors the design in known-good prior art; helps reviewers navigate. |
| § 2.2 (Round lane) | Insert two new phases between R4 (Decision) and R5 (Disbursement): `R4a sa:DisputeWindowOpenedAssertion` + `R4b sa:RoundCanceledAssertion` (optional). | oSnap-style dispute window; OZ cancellation guardian. |
| § 2.2 R2 | Confirm decision: skip `sa:RoundCounterAssertion`. | Already noted; reaffirm. |
| § 2.2 R6 | Tighten: `sa:OutcomeAttestationAssertion` payload should add `outcomeKind: enum(delivered | partial | not_delivered | disputed)` + `outcomeQuality: 1..5`. | Reputation feedback loop (Q10). |
| § 3.1 | Add new caveat: `enforcers/CredentialEnforcer.sol` — verifies a proposer's AnonCreds credential at award-time. | Q3 binding. |
| § 3.1 | Add new caveat: `enforcers/StewardEligibilityEnforcer.sol` — pulls from `IStewardEligibility` module à la Hats. | Replaces / augments § 4.3 steward rotation. |
| § 3.1 (QuorumEnforcer) | Adopt Safe's signature packing exactly (sorted-ascending, 65-byte slot, mixed ECDSA/ERC-1271 via v-byte discriminator). | Per § 2.6 oSnap + Safe Q1 in safe-architecture-comparison.md. |
| § 3.2 | Add new contract: `StewardEligibilityRegistry.sol` (mirrors `MandateRegistry.sol`) — pool maps to current steward set + eligibility flags. | Hats-style eligibility, no per-rotation delegation re-mint. |
| § 3.3 (Class-assertion taxonomy) | Add: `sa:DisputeWindowOpenedAssertion`, `sa:DisputeFiledAssertion`, `sa:RoundCanceledAssertion`, `sa:AllocationRevokedAssertion`, `sa:DisbursementStreamCreatedAssertion`, `sa:DisbursementStreamCanceledAssertion`. | Phase additions (Q2) + streaming optionality (Q5). |
| § 4.1 | Tier-0 STEWARDSHIP_DELEGATION: add `StewardEligibilityEnforcer` to caveat list. | Hats-style runtime eligibility check. |
| § 4.1 | Tier-1 SESSION_DELEGATION: add `TimestampEnforcer` lower-bound = `disputeUntil = decisionDate + 72h`. | oSnap dispute window. |
| § 4.3 (Steward-set rotation) | Replace "sign new STEWARDSHIP_DELEGATION + revoke prior" with "update `StewardEligibilityRegistry`". The STEWARDSHIP_DELEGATION stays the same; only eligibility flips. | Hats pattern; cheaper; cascades automatically. |
| § 5.3 (rounds.ts) | Add tools: `round:open_review_phase` (transitions to RoundReview), `round:open_dispute_window` (emits dispute-window assertion). | Phase explicitness (Q2). |
| § 5.5 (grantProposals.ts) | Add tool: `grant_proposal:cancel_award` (cancellation-guardian path); only callable by pool root key. | Q6 cancellation guardian. |
| § 5.6 (web actions) | New: `actions/streamDisburse.action.ts` for Sablier-stream-style disbursement (opt-in for `RecurringRound`). | Q5. |
| § 6 (GraphDB sync) | Add a new projection `sa:ProposerTrackRecord` computed from outcome attestations. Wire into matchmaker ranking. | Q10 feedback loop. |
| § 7 (Phased rollout) | Insert **Phase 2.5**: dispute window + cancellation guardian. Comes between caveat stack (P2) and real USDC (P3) — adversarial-path tests need to pass before custody. | Risk sequencing. |
| § 8 (Risks) | Add Q13: "Sablier dependency for streaming — yes/no decision per round. v1 = no; v2 = optional `RecurringRound` subtype." | Q5. |
| § 8 | Add Q14: "Multi-asset pools — sub-pool-per-asset model deferred to v2." | Q7. |
| § 8 | Add Q15: "Hierarchical pools — namespace tree only for v1; Hats integration deferred." | Q8. |
| § 11 (Critical files) | Add `packages/types/src/round.ts` — define explicit phase enum + transition table. | Q2 state machine. |

---

## 5. Sources (consolidated)

- [Allo Protocol docs](https://docs.allo.gitcoin.co/) — architecture, strategies, working-with-pools.
- [allo-v2 GitHub](https://github.com/allo-protocol/allo-v2) — Allo.sol, Registry.sol, BaseStrategy.sol.
- [Optimism RetroPGF Round 6 docs](https://community.optimism.io/citizens-house/rounds/retropgf-6) — phases, badgeholders.
- [Retro Funding 2025 announcement](https://www.optimism.io/blog/retro-funding-2025) — pivot to continuous evaluation.
- [Moloch Baal docs](https://moloch.daohaus.fun/) — shares vs loot, ragequit, sponsor pattern.
- [Aragon OSx core docs](https://devs.aragon.org/docs/osx/how-it-works/core/) — DAO + Plugin + PermissionManager.
- [MetaLamp Aragon OSx deep dive](https://metalamp.io/magazine/article/aragon-dao-v2-plugins-permissions-and-the-new-osx-architecture) — conditional permissions.
- [OpenZeppelin Governance docs](https://docs.openzeppelin.com/contracts/4.x/api/governance) — proposal lifecycle, Timelock.
- [GovernorTimelockControl source](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/governance/extensions/GovernorTimelockControl.sol) — cancellation guardian recommendation.
- [oSnap docs](https://docs.snapshot.org/user-guides/plugins/safesnap-osnap) — optimistic snapshot execution.
- [SafeSnap (Reality.eth)](https://docs.snapshot.box/v1-interface/plugins/safesnap-reality) — earlier oracle-based pattern.
- [UMA's oSnap announcement](https://medium.com/uma-project/announcing-osnap-gasless-snapshot-voting-with-on-chain-execution-by-uma-7374ed729b28) — dispute window pattern.
- [Hats Protocol main repo](https://github.com/Hats-Protocol/hats-protocol) and [README](https://github.com/Hats-Protocol/hats-protocol/blob/main/README.md) — eligibility modules, hat trees.
- [Hats Protocol docs](https://docs.hatsprotocol.xyz/) — overview.
- [Llama framework docs](https://docs.llama.xyz/framework/policies) — policy / action / strategy / role.
- [llamaxyz/llama GitHub](https://github.com/llamaxyz/llama) — LlamaCore, LlamaPolicy, LlamaStrategy, LlamaAccount.
- [Sablier streaming overview](https://blog.sablier.com/overview-token-streaming-models/) — closed-ended models.
- [Sablier grants page](https://sablier.com/grants) — DAO grant disbursement use cases.
- [Sablier docs use-cases](https://docs.sablier.com/concepts/use-cases) — clawback, milestone cancellation.
- [Endaoment](https://endaoment.org/) — DAF architecture, community funds, UIP.
- [Endaoment donor docs](https://docs.endaoment.org/donors/about/donor-advised-funds) — fund-advisor role, grant approval.
- [Gitcoin Passport docs](https://docs.passport.gitcoin.co/) — sybil-resistance, score thresholds.

---
