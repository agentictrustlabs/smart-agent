# SC1 — External Audit Procurement

> **Status**: Draft, ready for vendor outreach. Awaiting board sub-committee
> sign-off on budget envelope.
> **Audience**: engineering manager (owner), security lead (technical sponsor),
> CFO (budget approver), board sub-committee.
> **Document type**: PROCUREMENT plan. This is not an engagement; this is the
> scaffolding for an RFP/RFQ. No vendor is engaged at the time of writing.
> **Prerequisite (HARD)**: Spec 007 Phase A landed (✅ 2026-05-18, see
> `specs/007-architecture-hardening/phase-A-contract-role-split.md`). Phase A
> changed the factory constructor and `AgentAccount.initialize` signatures;
> auditing the pre-Phase-A code would waste the engagement.

---

## 1. Objective

Engage an independent smart-contract security firm to deliver a
severity-categorised findings report on `packages/contracts/src/`,
with remediation review and an optional second-look review.

The audit is the single largest item on the path to production. It
sequences with internal work (SC4 upgrade governance, SC5 reentrancy
audit, SC7 storage-layout discipline, SC9 cross-chain replay) such that
the auditor receives a code-frozen, threat-modelled, well-documented
package — the audit is for finding what we missed, not for finding what
we already know.

[DECISION] Target audit firm tier: **top-tier** (Trail of Bits, OpenZeppelin
Security, ChainSecurity, Spearbit, NCC Group, Halborn). We do not engage
a budget firm; the system's blast radius (every user's smart account,
every delegation chain, every treasury) makes a quality auditor a 5-10x
return on the price differential.

[DECISION] Engagement model: **fixed-fee, scoped engagement** with a
named lead reviewer, not a marketplace contest. Rationale in §6.

---

## 2. Scope (what we want audited)

### 2.1 P0 — must audit (in-scope)

Every contract in this tier is on the hot path of authority,
delegation, or money movement. An undisclosed bug here can drain
funds or hijack accounts.

| Contract | Path | LOC | Why P0 |
|---|---|---:|---|
| `AgentAccount` | `packages/contracts/src/AgentAccount.sol` | 925 | The user's identity anchor. Owns ERC-4337 validation, ERC-1271 signature acceptance, UUPS upgrade authority, ERC-7579 module install/uninstall, passkey custody, and Variant B session-delegation acceptance. Compromise = total user takeover. |
| `AgentAccountFactory` | `packages/contracts/src/AgentAccountFactory.sol` | 132 | Determines every user account's counterfactual address; sets `bundlerSigner` / `sessionIssuer` for the lifetime of all accounts it deploys. Compromise of the factory address = ability to mis-deploy accounts. |
| `DelegationManager` | `packages/contracts/src/DelegationManager.sol` | 253 | The ERC-7710 redemption surface. Validates delegation chains, runs caveat enforcers, executes through the delegator's `execute()`. Compromise = bypass of every caveat the system relies on. |
| `ICaveatEnforcer` | `packages/contracts/src/ICaveatEnforcer.sol` | 62 | The interface every enforcer implements; spec for `beforeHook` / `afterHook` semantics. |
| `enforcers/TimestampEnforcer` | `packages/contracts/src/enforcers/TimestampEnforcer.sol` | 43 | Gates validity windows. Bug = expired sessions stay usable / pre-valid sessions execute. |
| `enforcers/ValueEnforcer` | `packages/contracts/src/enforcers/ValueEnforcer.sol` | 41 | Per-call ETH cap. Bug = uncapped value. |
| `enforcers/AllowedTargetsEnforcer` | `packages/contracts/src/enforcers/AllowedTargetsEnforcer.sol` | 44 | Per-delegation target allowlist. Bug = call any contract. |
| `enforcers/AllowedMethodsEnforcer` | `packages/contracts/src/enforcers/AllowedMethodsEnforcer.sol` | 48 | Per-delegation selector allowlist. Bug = call any function. |
| `enforcers/CallDataHashEnforcer` | `packages/contracts/src/enforcers/CallDataHashEnforcer.sol` | — | Pins exact calldata for spec-005 honor / spec-006 commit flows. Used for executeBatch atomicity. |
| `enforcers/RateLimitEnforcer` | `packages/contracts/src/enforcers/RateLimitEnforcer.sol` | — | Per-window invocation cap. Stateful. |
| `enforcers/QuorumEnforcer` | `packages/contracts/src/enforcers/QuorumEnforcer.sol` | — | N-of-M approval gating. Stateful. |
| `enforcers/RecoveryEnforcer` | `packages/contracts/src/enforcers/RecoveryEnforcer.sol` | — | Time-locked recovery path. Stateful. |
| `enforcers/AllocationLimitEnforcer` | `packages/contracts/src/enforcers/AllocationLimitEnforcer.sol` | — | Spend-cap across calls. Stateful. |
| `enforcers/TaskBindingEnforcer` | `packages/contracts/src/enforcers/TaskBindingEnforcer.sol` | — | Binds a delegation to a task id. |
| `enforcers/RoundDecisionWindowEnforcer` | `packages/contracts/src/enforcers/RoundDecisionWindowEnforcer.sol` | — | Gates votes / proposals to a round window. |
| `enforcers/MembershipProofEnforcer` | `packages/contracts/src/enforcers/MembershipProofEnforcer.sol` | — | Requires a membership proof at redeem time. |
| `enforcers/PoolMandateEnforcer` | `packages/contracts/src/enforcers/PoolMandateEnforcer.sol` | — | Pool-specific spending mandate. |
| `enforcers/StewardEligibilityEnforcer` | `packages/contracts/src/enforcers/StewardEligibilityEnforcer.sol` | — | Restricts to current stewards. |
| `enforcers/DataScopeEnforcer` | `packages/contracts/src/enforcers/DataScopeEnforcer.sol` | — | Per-data-class scope. |
| `enforcers/McpToolScopeEnforcer` | `packages/contracts/src/enforcers/McpToolScopeEnforcer.sol` | — | Per-tool scope on MCP redemptions. |
| `enforcers/NameScopeEnforcer` | `packages/contracts/src/enforcers/NameScopeEnforcer.sol` | — | Restricts to specific name records. |
| `enforcers/CaveatEnforcerBase` | `packages/contracts/src/enforcers/CaveatEnforcerBase.sol` | — | Shared base; abuse = breaks every derived enforcer. |
| `SmartAgentPaymaster` | `packages/contracts/src/SmartAgentPaymaster.sol` | 124 | ERC-4337 paymaster; sponsors gas. Bug = drained deposit. Note the explicit "DO BEFORE PUBLIC DEPLOY" checklist in the contract (lines 27-34). |
| `MultiSendCallOnly` | `packages/contracts/src/MultiSendCallOnly.sol` | 96 | Batched delegatecall surface. High blast radius if delegatecall mode were ever wired (we use call-only; auditor must confirm). |
| `validators/PasskeyValidator` | `packages/contracts/src/validators/PasskeyValidator.sol` | 97 | WebAuthn P-256 verifier; gates session entry on passkey. |
| `libraries/WebAuthnLib` | `packages/contracts/src/libraries/WebAuthnLib.sol` | — | Core WebAuthn parsing. Bug = forged passkey assertion accepted. |
| `libraries/P256Verifier` | `packages/contracts/src/libraries/P256Verifier.sol` | — | P-256 ECDSA verification. Bug = forged signature accepted. |
| `DaimoP256Verifier` | `packages/contracts/src/DaimoP256Verifier.sol` | 36 | Wrapper around Daimo's P-256 precompile. |
| `UniversalSignatureValidator` | `packages/contracts/src/UniversalSignatureValidator.sol` | 116 | ERC-6492 / ERC-1271 validator. Bug = forged signatures accepted at the universal entry point. |
| `modules/ECDSASessionValidator` | `packages/contracts/src/modules/ECDSASessionValidator.sol` | 125 | ERC-7579 module — gates session validation. |
| `modules/RevocationModule` | `packages/contracts/src/modules/RevocationModule.sol` | 81 | Account-local revocation list; bug = revoked sessions still execute. |
| `modules/SpendCapHookModule` | `packages/contracts/src/modules/SpendCapHookModule.sol` | — | Per-account budget hook (ERC-7579). |
| `modules/RateLimitHookModule` | `packages/contracts/src/modules/RateLimitHookModule.sol` | — | Per-account rate limit (ERC-7579). |
| `modules/TargetSelectorAllowlistHookModule` | `packages/contracts/src/modules/TargetSelectorAllowlistHookModule.sol` | 129 | Per-account allowlist. |
| `SessionAgentAccountFactory` | `packages/contracts/src/SessionAgentAccountFactory.sol` | 180 | Bootstraps session-scoped sub-accounts with co-owner during init. The co-owner path is delicate; cite `AgentAccount.initializeWithCoOwner` (`AgentAccount.sol:167-184`). |

**P0 LOC estimate**: ~5,000 lines of Solidity (counting enforcers and
modules whose LOC is omitted above; see `find packages/contracts/src
-name '*.sol' | xargs wc -l` — total tree is ~12,858 LOC).

### 2.2 P1 — should audit (in-scope if budget permits)

Registries that the system depends on for correctness but whose
compromise has narrower blast radius (a single registry's data) rather
than total takeover.

| Contract | Why P1 |
|---|---|
| `AttributeStorage` | Base for every registry (`packages/contracts/src/AttributeStorage.sol`). A bug here propagates to every inheriting registry. Realistically P0 — see §2.4 for the merge proposal. |
| `OntologyTermRegistry` | Predicate validity check; bug = unregistered predicates pass. |
| `ShapeRegistry` | SHACL-like shape validation; bug = invalid shapes pass. |
| `ProposalRegistry` | Awarded proposals; auth gate is `onlyFundOwner` (lines 77-87). |
| `CommitmentRegistry` | Universal post-match artifact; auth gates: `NotDonorOwner` / `NotDonor` (lines 91-93). |
| `PledgeRegistry` | Pool pledges + spec-005 settlement; auth gates: `NotPoolOperator` / `NotPledgeDonor` (lines 58-64). |
| `GrantProposalRegistry` | Proposal-lane writes. |
| `MatchInitiationRegistry` | Direct-lane writes; auth gate `NotInitiator` (line 43). |
| `VoteRegistry` | Vote casting; permissionless on-chain. |
| `PoolRegistry` | Pool metadata. |
| `FundRegistry` | Fund-of-funds metadata. |
| `RelationshipTypeRegistry` | Trust-graph edge types. |
| `AgentRelationship` | Trust-graph edges. |
| `AgentNameRegistry` / `AgentNameResolver` / `AgentNameAttributeResolver` / `AgentNameUniversalResolver` | `.agent` TLD name resolution. |
| `AgentTrustProfile` / `AgentValidationProfile` / `AgentIssuerProfile` | Trust signals. |
| `AgentSkillRegistry` / `SkillDefinitionRegistry` / `SkillIssuerRegistry` | Skill claims. |
| `CredentialRegistry` | AnonCreds nullifier set. |
| `MandateRegistry` | Operating mandates. |
| `GeoClaimRegistry` / `GeoFeatureRegistry` | Geographic claims. |
| `AgentAssertion` / `ClassAssertion` | Class-assertion observers. |
| `AgentDisputeRecord` / `AgentReviewRecord` | Dispute + review records. |
| `StewardEligibilityRegistry` | Stewardship eligibility. |
| `AgentAccountResolver` / `AgentUniversalResolver` / `AgentRelationshipResolver` / `AgentRelationshipQuery` / `AgentRelationshipTemplate` / `AgentPredicates` | Resolver surface. |
| `ApprovedHashRegistry` | Hashes pre-approved by an account. |

**P1 LOC estimate**: ~5,500 lines.

### 2.3 P2 — nice-to-have (out-of-scope unless explicitly added)

| Contract | Why P2 |
|---|---|
| `MockTeeVerifier` | Mock, dev-only. |
| `mocks/*` | Test mocks. |
| `zk/*` | Reserved for future ZK integration; no active code at audit time. |

### 2.4 [OWE-REVIEWER] Merge `AttributeStorage` from P1 → P0

`AttributeStorage` is the base contract for **every** registry. The
`internal` setters it exposes (`_setBytes32` / `_setUint` / `_setAddress`
/ etc., lines ~110-280) are the only writes any registry performs. If
`AttributeStorage` has a bug — e.g. mis-tracked `_isSet` / `_datatype`
discriminator, missing ontology validation, version-counter skew — the
bug is universal.

The auditor should treat `AttributeStorage` as P0 even though no money
moves through it directly.

### 2.5 Out-of-scope

- `lib/` (forge-std, OpenZeppelin, account-abstraction): trusted
  dependencies. Auditor should confirm we are pinned to safe versions
  but NOT audit the dependency code itself.
- KMS / off-chain signing custody: see `output/KMS-IMPLEMENTATION-PLAN.md`
  and `docs/security/cryptographic-posture/C4-subliminal-channels.md`.
  Crypto-side review may overlap; we want the auditor to be aware of
  it but not own it.
- TypeScript SDK (`packages/sdk/`): not in scope for contract auditor
  (different skillset; consider a separate SDK review later).
- Subgraph / GraphDB indexing: out.

---

## 3. Timing

### 3.1 When is the code "audit-ready"?

[DECISION] Code is audit-ready when ALL of the following hold:

- [x] Spec 007 Phase A landed (factory + AgentAccount stable). Done
      2026-05-18.
- [ ] SC4 (upgrade governance) Phase A.5 contract drafted and merged.
      Auditor must see the governance multisig, not the pre-multisig
      code path.
- [ ] SC5 (reentrancy audit) internal threat model handed to auditor
      as a pre-engagement memo.
- [ ] SC7 (storage layout) baseline locked. Auditor must see the
      `__gap` placeholder pattern in every upgradeable contract OR a
      written commitment to a one-shot migration before mainnet.
- [ ] SC9 (cross-chain replay) Foundry tests landed. Auditor sees
      passing tests, not "this is on our list".
- [ ] Forge test suite ≥ 95% coverage on `src/` (currently 430+
      tests; spec 007 added 15 Phase A tests for 445/445).
- [ ] No `TODO` / `XXX` / `FIXME` in `src/`. `grep -rn 'TODO\|XXX\|FIXME'
      packages/contracts/src/` returns zero hits before code freeze.
- [ ] All `console.log` / debug imports removed from `src/`.
- [ ] `forge build` clean with `-vvv`; no compiler warnings.
- [ ] NatSpec coverage ≥ 95% on `external` / `public` functions
      (`forge doc --build` runs clean).
- [ ] Threat-model handoff package assembled (see §5).
- [ ] Build instructions reproducible from a clean checkout in under
      15 minutes (see §5.6).

[DECISION] Code freeze date: **TBD**, but committed: at least 5 working
days before kickoff. We will not patch the audit branch during the
audit except for auditor-requested clarifications.

### 3.2 Lead time

Top-tier firm engagement lead time (current market, observed 2026):

| Firm | Typical lead time (RFP → kickoff) |
|---|---|
| Trail of Bits | 4-8 weeks |
| OpenZeppelin Security | 3-6 weeks |
| ChainSecurity | 4-8 weeks |
| Spearbit (curated marketplace) | 2-6 weeks; flexible based on reviewer availability |
| NCC Group / Crypto Services | 6-12 weeks (larger firm, slower scheduling) |
| Halborn | 3-6 weeks |
| Cure53 | 6-10 weeks |

[DECISION] Assume **6 weeks** lead time for budgeting purposes. We
will issue RFQ this sprint; engagement begins ~2026-07-01 at earliest.

### 3.3 Engagement duration

A system of ~5,000 P0 LOC (plus ~5,500 P1 if included) typically takes:

- **P0-only scope**: 4-6 weeks of reviewer time, 2-3 reviewers.
- **P0 + P1 scope**: 6-8 weeks of reviewer time, 2-3 reviewers.

Calendar duration with the firm's process (kickoff, mid-engagement
sync, draft report, remediation review):

- P0-only: 6-8 calendar weeks.
- P0 + P1: 8-12 calendar weeks.

### 3.4 Timeline (target)

| Week | Activity | Owner |
|---|---|---|
| W-6 | Issue RFQ to vendor shortlist. | engineering manager |
| W-5 | Receive proposals; technical comparison. | engineering manager + security lead |
| W-4 | Vendor selection; sign engagement letter; PO issued. | engineering manager + CFO |
| W-3 to W-1 | Internal prep: code freeze prep, doc package, threat-model handoff (see §5). | dev team + security lead |
| W0 | Engagement kickoff. Auditor begins. | auditor |
| W0 + 1 | First sync (typically end of week 1). | auditor + dev team |
| W0 + 3 | Mid-engagement sync; preliminary findings shared informally. | auditor + dev team |
| W0 + N (N = 6 for P0-only, 8 for P0+P1) | Draft report delivered. | auditor |
| W0 + N + 1 | Draft report read internally; we draft remediation plan. | security lead + dev team |
| W0 + N + 2 to W0 + N + 4 | Remediation development; PRs land on a separate `audit-remediation` branch. | dev team |
| W0 + N + 5 | Auditor performs remediation review. | auditor |
| W0 + N + 6 | Final report delivered. | auditor |
| W0 + N + 7 | Public disclosure (if firm publishes) coordinated with mainnet timing. | engineering manager + auditor |

So: **~3 calendar months from RFQ issue to final report** for P0-only;
~4 months for P0 + P1.

---

## 4. Budget

### 4.1 Market rates (current, 2026)

Observed pricing for top-tier engagements of systems in our class
(ERC-4337 + delegation + multi-registry on-chain logic):

| Firm | Quoted unit | Typical range for a system of our size |
|---|---|---|
| Trail of Bits | Person-day | $30k-$60k/week per reviewer; engagements $80k-$300k |
| OpenZeppelin Security | Fixed-fee per scope | $50k-$250k for our class |
| ChainSecurity | Fixed-fee per scope | $40k-$200k |
| Spearbit | Reviewer-day, marketplace | $1.5k-$3k/reviewer-day; engagements $40k-$180k |
| NCC Group | Person-day | $30k-$50k/week; engagements $100k-$350k |
| Halborn | Fixed-fee | $40k-$150k |
| Cure53 | Person-day | $25k-$45k/week; engagements $80k-$200k |

URLs (verified 2026-05-18 — auditor must re-verify before sending RFQ):

- Trail of Bits: https://www.trailofbits.com/services/software-assurance/blockchain/
- OpenZeppelin Security Audits: https://www.openzeppelin.com/security-audits
- ChainSecurity: https://chainsecurity.com/
- Spearbit: https://spearbit.com/
- NCC Group Cryptography Services: https://www.nccgroup.com/us/our-services/cyber-security/specialist-practices/cryptography-services/
- Halborn: https://halborn.com/
- Cure53: https://cure53.de/

### 4.2 Budget envelope

[DECISION] **$75k-$200k** is the realistic envelope for a P0-scope
top-tier engagement.

| Scope | Low | Mid (likely) | High |
|---|---:|---:|---:|
| P0-only | $75k | $120k | $180k |
| P0 + P1 | $120k | $180k | $280k |
| P0 + P1 + remediation 2nd-look | +$15k | +$25k | +$40k |
| Public report formatting / publication | +$5k | +$10k | +$20k |

[DECISION] We budget **$150k** for the engagement with a $50k
contingency reserve, for a total budget commitment of **$200k**. This
covers P0 scope, remediation, second-look, and public publication.
P1 scope expansion is treated as a change order against the contingency
reserve.

### 4.3 Rationale for envelope size

- The system is ~5,000 LOC of P0 contracts with unusually high
  conceptual complexity per LOC: ERC-4337, ERC-7710 delegation chains
  with caveat composition, ERC-1271 with WebAuthn P-256 (and ERC-6492
  envelope), UUPS upgrades with custom owner-signed authorization, and
  ERC-7579 module install/uninstall.
- We have **our own** implementations of every primitive (substrate
  independence rule P1, see `docs/architecture/principles.md`); we do
  not benefit from Safe / MetaMask DTK / Aragon prior-art audit
  coverage. The auditor cannot say "this contract is well-known good".
- The blast radius is total: every user account, every delegation,
  every treasury. A budget firm finding fewer bugs is worse than a
  top-tier firm finding all of them.

### 4.4 What the budget does NOT cover

- KMS / signing-infra review. Sized separately (see SC1 scope
  exclusions § 2.5).
- SDK review. Future engagement (~$30k-60k, 2-3 weeks).
- Web frontend / API security review. Future engagement.
- Live operational monitoring (separate from audit).

---

## 5. Internal prep checklist

The single largest determinant of audit ROI is how much we prepare
before kickoff. An unprepared engagement burns the first 1-2 weeks on
context loading at $30-60k/week.

### 5.1 Code freeze

- [ ] Branch `audit/2026-Q3` cut from main on freeze date.
- [ ] `audit/2026-Q3` is protected; only `audit-clarification/*` PRs
      may merge during the engagement.
- [ ] No silent updates: every clarification PR is logged in the
      shared audit channel and named in the final report.

### 5.2 Documentation package (one PDF + one ZIP)

**PDF — narrative**:
- Architecture overview (cite `docs/architecture/INDEX.md`).
- Threat model (cite `docs/security/cryptographic-posture/C1-threat-model.md`).
- Variant A replay analysis (cite `docs/security/cryptographic-posture/C2-replay-analysis-variant-a.md`).
- Spec 007 (cite `specs/007-architecture-hardening/`).
- Substrate-independence statement (cite `docs/architecture/principles.md`)
  — auditor needs to know we built our own and why.
- Pre-engagement memo for reentrancy (SC5).
- Pre-engagement memo for cross-chain replay (SC9).

**ZIP — code package**:
- Git tag of frozen commit + signed signature.
- `packages/contracts/` full directory.
- `forge build` artifacts (out/).
- Build log.
- Test report (`forge test -vv` log + `forge coverage` summary).
- This SC1 / SC4 / SC5 / SC7 / SC9 doc set.

### 5.3 Threat-model handoff

The auditor receives a single memo that says:

- These are the actors. (Cite C1 §1.1.)
- These are the cryptographic gates. (Cite C1 §1.2.)
- These are the residual risks we accept. (Cite C1 §6 — accepted residual.)
- This is what we are most worried about: caveat-enforcer reentrancy
  (SC5), cross-chain replay (SC9), storage layout drift on UUPS upgrade
  (SC7), upgrade-governance bypass (SC4).
- This is what we know is broken but is out of scope: [if anything;
  ideally empty at code freeze].

### 5.4 Test coverage report

- [ ] `forge coverage --report summary > audit-coverage-baseline.txt`
- [ ] Target ≥ 95% line coverage on `src/`.
- [ ] Every external function has at least one positive test and one
      negative test.
- [ ] Property tests for the load-bearing invariants (SC2 — formal
      verification) — at minimum a Foundry fuzzing harness for
      DelegationManager redemption + AgentAccount validation.

### 5.5 Build reproducibility

- [ ] `git clone` → `forge install` → `forge build` from a clean
      Ubuntu 22.04 box, no manual steps, in under 15 minutes.
- [ ] `Dockerfile` for the contracts package, in case the firm
      prefers containerised builds.
- [ ] Pin Foundry version (`foundry.toml` is at `solc = "0.8.28"` with
      `via_ir = true`; we also need to pin `forge-std` and the Foundry
      release).

### 5.6 Dependency inventory

Auditor needs a list of every external dep and its pinned version:

- `@openzeppelin/contracts` — version + commit hash. Cite location:
  `lib/openzeppelin-contracts/`.
- `account-abstraction/` — EntryPoint v0.7 (or v0.8 if Phase A bumped
  it; verify). Cite location: `lib/account-abstraction/`.
- `forge-std/` — version + commit.
- Any other lib under `packages/contracts/lib/`.

For each, state: which contracts use it, why it was chosen over
alternatives, and whether we've forked it.

---

## 6. Engagement model

### 6.1 Options

| Model | Pros | Cons |
|---|---|---|
| Time-and-materials | Firm bills by reviewer-day; flexibility to extend if findings expand. | Open-ended cost; risk of overrun. |
| Fixed-fee scoped | Clear cost; firm absorbs schedule risk; cleaner approval. | Out-of-scope items need change orders; firm may underscope to win bid. |
| Contest (Code4rena / Sherlock / Cantina) | Wide reviewer set; competitive incentive to find bugs. | Variable reviewer quality; weaker remediation review; less suitable for systems with high conceptual surface area. |
| Hybrid (fixed-fee + T&M overflow) | Best of both. | Slightly more complex contract. |

### 6.2 Recommendation

[DECISION] **Fixed-fee scoped engagement** with a **named lead
reviewer** and **T&M overflow option** for scope expansion. Two
reasons:

1. The system has high conceptual surface area (10+ specs, custom
   primitives). Reviewers need 1-2 weeks of context loading; contest
   models do not give enough time. The lead reviewer is the persistent
   memory across the engagement.
2. We control budget approval. Fixed-fee plus a documented overflow
   path lets the CFO sign a known number.

We explicitly NOT recommend a contest model for THIS audit. Once the
contracts have one fixed-fee engagement's worth of confidence, a
post-launch contest (SC3 bug bounty) is the right next step.

### 6.3 Multiple firms?

[DECISION] **One firm**, not two. Two firms in parallel costs roughly
2x for ~20-30% incremental finding rate (most firms find roughly the
same critical issues; the long tail diverges). The right way to get
two perspectives is:

1. SC1 — fixed-fee engagement with firm A.
2. SC3 — post-deployment bug bounty (firm B's marketplace, e.g.
   ImmuneFi or Sherlock, hits the same code after we ship).
3. Periodic review (~annual): firm B does the next audit. Rotation
   across firms over the system's lifetime is more valuable than two
   firms in any single engagement.

---

## 7. Deliverables from the auditor

Required deliverables (specified in the engagement letter):

1. **Kickoff document** — confirms scope, deliverables, team, schedule.
2. **Mid-engagement update** — informal findings list shared in week
   3-4 so we can begin remediation in parallel.
3. **Draft report** — full severity-categorised findings:
   - Critical / High / Medium / Low / Informational / Best-Practice.
   - Each finding: location (file:line), description, exploit
     scenario, severity rationale, recommendation, status (open at
     draft time).
4. **Remediation review** — after we patch, the firm verifies fixes.
   Each finding moves to status: Fixed, Acknowledged, or Open.
5. **Final report** — same shape as draft, with remediation status
   captured per finding.
6. **(Optional) second-look review** — 4-6 weeks post-final, the firm
   re-reviews the contracts including any code that landed in the
   interim.
7. **Public report** — the firm publishes (with our coordination) on
   their public report registry.

### 7.1 Severity rubric we expect the auditor to use

Standard industry rubric (we should not invent our own). For our class
of system:

- **Critical**: loss of user funds, account takeover, total bypass
  of authority. E.g. signature forgery, UUPS upgrade bypass, caveat
  enforcer bypass.
- **High**: significant loss in narrow conditions, denial of access,
  governance bypass.
- **Medium**: limited fund loss, recoverable, or requires specific
  attacker capability.
- **Low**: gas grief, info leak, minor inconsistency.
- **Informational**: code quality, NatSpec, future-proofing.

We will not allow the auditor to downgrade a finding based on
"unlikely in practice" — we want the technical severity, not the
business-impact severity. We do the business adjustment ourselves.

---

## 8. Post-audit plan

### 8.1 Triage SLA

| Severity | Patch SLA from final report | Disclosure |
|---|---|---|
| Critical | 5 business days | Coordinated disclosure with auditor + bug-bounty network |
| High | 10 business days | Coordinated |
| Medium | 30 days | Public after patch |
| Low | 60 days | Public after patch |
| Informational | Best effort, no SLA | Public if we patch; otherwise carry forward |

### 8.2 Disclosure timing

- Findings remain confidential until BOTH:
  - The fix is deployed to all live environments, AND
  - The bug bounty programme (SC3) is live so we are not creating a
    knowledge gap for attackers.
- Public disclosure tied to a coordinated post (us + firm), typically
  90 days after final report or earlier if the patch is broadly
  deployed.

### 8.3 Retainer for follow-up

[DECISION] Negotiate **$30k retainer** for follow-up work in the
12 months post-engagement:

- Mini-review of any system contract upgrade.
- Threat-model review of any new caveat enforcer.
- Q&A access for the dev team (Slack channel with firm rep).

Retainer is not for a full re-audit; that's a separate engagement.

### 8.4 Audit-as-precondition policy

[DECISION] After SC1 lands:
- No new caveat enforcer ships to mainnet without an SC1-firm review
  pass (~$5-15k mini-engagement per enforcer).
- No `src/` change shipped without `audit-required` label review by
  security lead.
- No UUPS upgrade of a system contract without governance multisig
  + auditor review (see SC4).

---

## 9. Vendor shortlist (RFQ recipients)

[DECISION] Issue RFQ to **5 firms**; expect 3-4 proposals back; select 1.

### 9.1 Shortlist

1. **Trail of Bits**
   - Track record: extensive ERC-4337 work (e.g. Safe{Wallet}
     reviews, ZeroDev kernel reviews). Public reports at
     https://github.com/trailofbits/publications.
   - Strengths: deep fuzzing + symbolic capabilities (Echidna,
     Manticore), strong reentrancy detection.
   - Considerations: typically the most expensive tier; long lead
     times.
2. **OpenZeppelin Security**
   - Track record: many AA / multisig audits (e.g. Safe, Compound,
     Optimism). Public reports at
     https://blog.openzeppelin.com/security-audits.
   - Strengths: knows OZ contracts (we use them heavily) intimately;
     deep upgrade-pattern expertise.
   - Considerations: occasionally overloaded; harder to schedule.
3. **ChainSecurity**
   - Track record: ETH Foundation, Curve, Aave; strong formal
     methods background. Public reports at
     https://chainsecurity.com/audits/.
   - Strengths: deep math + formal reasoning; good for caveat
     composition analysis.
   - Considerations: smaller team; one engagement at a time.
4. **Spearbit**
   - Track record: marketplace of senior reviewers (e.g. samczsun,
     Yoav Weiss tier). Many AA reviews on the Pashov-collective lists.
     See https://spearbit.com/portfolio.
   - Strengths: highly flexible scope; can pull individual top
     reviewers; cost-effective for our envelope.
   - Considerations: less institutional brand; coordination overhead
     higher.
5. **Halborn**
   - Track record: large breadth of AA / wallet engagements;
     enterprise-grade reporting. https://halborn.com/audits/.
   - Strengths: process maturity, formal SLA discipline.
   - Considerations: more variable per-engagement quality (depends
     on assigned reviewer).

### 9.2 Considered but de-prioritised

- **NCC Group / Crypto Services**: top-tier; pricing typically above
  envelope; long lead times. Hold as alternate.
- **Code4rena / Sherlock contest**: not the right shape for THIS
  engagement (see §6.2). Consider for re-review after SC1 + bug
  bounty cycle.
- **Cure53**: stronger on web / cryptography than on EVM specifically;
  use for SDK / KMS review later, not for this.
- **Cantina**: newer marketplace; viable alternate to Spearbit.

### 9.3 RFQ template

We will send each firm:

- 1-page system overview.
- This SC1 doc (scope §2, timeline §3, budget §4, engagement model §6).
- Frozen tag of the code (or a sample if pre-freeze).
- Threat-model handoff package (per §5.3).

We ask for:

- Confirmation of scope coverage.
- Proposed reviewer team + lead reviewer named.
- Calendar timeline.
- Fixed-fee quote for P0 scope.
- Optional P1 scope quote.
- Retainer terms (per §8.3).
- References for at least 2 comparable engagements.

---

## 10. Risks specific to this procurement

| # | Risk | Mitigation |
|---|---|---|
| 1 | Auditor is unfamiliar with our custom DelegationManager / caveat composition pattern; first 2 weeks burned on context. | §5.3 threat-model handoff + pre-engagement memos (SC5, SC9) front-load the context. |
| 2 | Code drifts during engagement; auditor reviews stale code. | §5.1 code freeze; clarification PRs only. |
| 3 | Auditor finds a critical that requires a deep redesign mid-engagement. | Reserve $50k contingency; if a critical demands redesign, pause the engagement, redesign, resume with a remediation review. |
| 4 | Public-disclosure pressure: auditor wants to publish before we are ready. | Coordinated disclosure clause in engagement letter; we control the publication date. |
| 5 | Single-vendor lock-in; firm's quality drops on next engagement. | Periodic rotation (§6.3): next year's audit is with a different firm. |
| 6 | Budget overrun if P1 scope is added mid-engagement. | Treat P1 as a change order requiring CFO approval; do not silently expand. |
| 7 | Auditor leaks the system to a third party (intentional or accidental). | NDA in engagement letter; standard. |
| 8 | We discover a critical bug post-audit during testnet rehearsal (SC8). | SC8 is intentionally a 4-week soak with all auditor recommendations in place; finding new criticals there triggers a mini-engagement, not a panic. |

---

## 11. Acceptance criteria for this procurement document

SC1 is complete (and we are ready to issue the RFQ) when ALL of:

- [ ] Board sub-committee approves $200k budget envelope.
- [ ] CFO signs off on contract template.
- [ ] Security lead confirms threat-model handoff package is assembled.
- [ ] Engineering manager confirms vendor shortlist (§9.1) is current
      (re-verify URLs and check for new firms).
- [ ] Phase A.5 (SC4 implementation) is committed to a sprint.
- [ ] SC5 pre-engagement memo is drafted.
- [ ] SC9 cross-chain replay tests are landed in `audit/2026-Q3`.

---

## 12. Open questions

[OWE-REVIEWER] resolve before RFQ issue:

1. Do we engage one or two firms? Plan says one (§6.3); board may
   prefer two for political comfort. Resolve.
2. Is the SDK in scope? Plan says no; some firms bundle it cheaply.
   Decide.
3. Public report or private only? Plan favours public (transparency
   + community-trust signal); some firms charge extra for the
   formatting / publication. Decide before quote.
4. Do we want the auditor to sign an NDA covering KMS / infra details
   they will incidentally see? Yes. Standard.
5. Are we open to a contest as a complement (not replacement) of
   SC1? Plan says: after SC3 is live, periodic contests are healthy.
   No conflict.

---

## 13. Next actions (this week)

1. Engineering manager: re-verify vendor URLs in §9.1; draft RFQ
   recipient email.
2. Security lead: assemble threat-model handoff package per §5.3.
3. Developer: confirm `forge coverage` is ≥ 95%; raise if not.
4. CFO: pre-approve $200k envelope (subject to board final).
5. Schedule board sub-committee review for envelope sign-off in
   next sub-committee meeting.

Once §11 acceptance criteria are met, issue RFQ.
