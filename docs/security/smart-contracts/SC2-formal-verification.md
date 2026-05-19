# SC2 — Formal Verification

> **Status**: Draft. Decision required on Certora vs Halmos-first.
> **Audience**: security lead (owner), developer (executor), engineering
> manager (budget approver).
> **Document type**: Procurement plan (tool licensing) + analysis (invariant
> selection) + impl plan (harness build).
> **Pairs with**: SC1 (some firms bundle FV; we decide whether to do it
> in-house or contract it).
> **Prerequisite**: Spec 007 Phase A landed. The invariants listed here
> presume the post-Phase-A capability role split.

---

## 1. Why formal verification

Standard testing (Foundry tests, 445 passing as of 2026-05-18) proves
that for a finite set of inputs, the system behaves as expected. Formal
verification proves the system behaves as expected **for all inputs**
in a given input space, provided the specification is correct.

For this system, the invariants we care most about are not just
"function returns correct value" — they are negative invariants about
authority that must hold universally:

- *Master signer is NEVER an owner of any AgentAccount.*
- *Bundler can submit but NEVER authorise a userOp.*
- *Caveat enforcers always run; redemption NEVER executes if any
  enforcer reverts.*

These are universal-quantified properties. A test suite of 10,000
random fuzz runs is a strong empirical signal; a formal proof closes
the residual. For the high-blast-radius authority gates in
`AgentAccount.sol` and `DelegationManager.sol`, we want both.

---

## 2. Tools considered

### 2.1 Certora Prover

- **What**: SMT-backed formal verifier for Solidity. Industry standard.
  Specification language: CVL (Certora Verification Language).
- **Cost**: commercial license; ranges $30k-$100k+ per year for a
  small team; $50k typical for our scope based on Certora's published
  pricing tiers. Public reference customers include Aave, Compound,
  Optimism. URL: https://www.certora.com/.
- **Strengths**: mature, well-supported, used by every major DeFi
  protocol. Best-in-class for complex EVM invariants.
- **Weaknesses**: license cost; specification authoring requires CVL
  expertise; engineering team needs ramp time (2-4 weeks per engineer
  for productive CVL).
- **Vendor lock**: medium. CVL specs are non-portable.

### 2.2 Halmos

- **What**: symbolic execution-based verifier from a16f crypto;
  open-source. Specifications are written as Foundry-style tests
  using symbolic values. URL: https://github.com/a16z/halmos.
- **Cost**: free.
- **Strengths**: integrates with existing Foundry test suite (huge
  win — our 445 tests are Foundry); no separate spec language;
  immediate ROI.
- **Weaknesses**: less mature than Certora; some invariants too
  complex for SMT solver to discharge within practical timeouts;
  smaller community.
- **Vendor lock**: low.

### 2.3 Slither

- **What**: static analysis for Solidity from Trail of Bits.
  URL: https://github.com/crytic/slither.
- **Cost**: free.
- **Strengths**: catches large classes of bugs immediately (reentrancy
  patterns, unchecked low-level calls, missing access control); fast.
- **Weaknesses**: it is static analysis, not formal verification. False
  positives are common; it cannot prove deep invariants.
- **Verdict**: ship as CI gate; not a replacement for FV.

### 2.4 Mythril

- **What**: symbolic execution for EVM bytecode. URL:
  https://github.com/ConsenSys/mythril.
- **Cost**: free.
- **Strengths**: works on compiled bytecode (catches things solc
  optimisation might obscure).
- **Weaknesses**: slower than Slither; less actively maintained than
  Halmos.
- **Verdict**: optional CI add-on; not load-bearing.

### 2.5 Echidna

- **What**: property-based fuzzer from Trail of Bits. URL:
  https://github.com/crytic/echidna.
- **Cost**: free.
- **Strengths**: best-in-class fuzz testing for invariants written in
  Solidity. Catches what symbolic execution cannot (high-dimensional
  inputs, deep state).
- **Weaknesses**: fuzzing != proving; finds bugs, doesn't prove
  absence.
- **Verdict**: ship alongside Foundry fuzz; complementary to Halmos.

### 2.6 Foundry fuzz / invariant testing

- **What**: built into `forge`. Already in use (`foundry.toml` shows
  `[fuzz] runs = 256`).
- **Cost**: free; already integrated.
- **Strengths**: zero friction; runs in CI.
- **Weaknesses**: 256 runs is light; want to bump significantly for
  load-bearing invariants.

### 2.7 K-EVM / KEVM

- **What**: K Framework formal semantics of EVM. Used by RV (Runtime
  Verification). URL: https://runtimeverification.com/.
- **Cost**: commercial; engagements typically $100k+.
- **Strengths**: strongest formal foundation; bytecode-level proofs.
- **Weaknesses**: highest cost; longest engagement; specialist work.
- **Verdict**: out of envelope for v1. Re-evaluate post-mainnet.

---

## 3. Recommendation

[DECISION] **Halmos-first, Certora-later (conditional).** Specifically:

### Phase 2.A — Halmos (now)

- Write symbolic Foundry tests for the **P0 invariants** below using
  Halmos. Engineering time: 3-4 weeks of one senior contracts dev.
- No license cost; no vendor procurement; no ramp time beyond reading
  the Halmos docs.
- Lands in `packages/contracts/test/symbolic/` as a new directory.
- Halmos runs in CI alongside `forge test` (separate target).

### Phase 2.B — Slither + Echidna (now, in parallel)

- Slither gates every PR as a CI step (block on any High severity).
- Echidna runs nightly against a property suite in
  `packages/contracts/test/properties/` (new directory).

### Phase 2.C — Certora (conditional, post-audit)

- Engage Certora ONLY if:
  - Halmos cannot discharge one or more P0 invariants within
    practical SMT timeouts after good-faith engineering effort, AND
  - The unprovable invariants are in our critical path (e.g.
    upgrade authorisation, caveat enforcement).
- Budget envelope if engaged: $50k for an initial 8-week engagement
  with 1 Certora engineer pair-spec'ing with our team.

### Phase 2.D — KEVM / RV

[DECISION] Defer indefinitely. Not in v1 budget.

### Rationale

The Phase 2.A + 2.B combo gets us 80% of the FV value for ~3% of the
cost. We do not engage Certora pre-emptively for political theatre.
We engage them when we have a concrete invariant Halmos can't prove
AND that invariant matters.

---

## 4. Invariants to formalise (P0)

Each invariant below states the property, the contract location, the
recommended tool, and the effort estimate. The invariants are
prioritised — top of list ships first.

### 4.1 INV-AUTH-1: master signer is never in `_owners` (any account, any time)

- **Property**: For any `AgentAccount a` deployed by
  `AgentAccountFactory.createAccount`, for any address `m` that is
  the master signer, `a.isOwner(m) == false` after `initialize`.
- **Why**: This is the load-bearing M-1 finding mitigation. Master
  compromise = total takeover if broken.
- **Cite**: `packages/contracts/src/AgentAccount.sol:141-149`,
  `:808-811`; `packages/contracts/src/AgentAccountFactory.sol:67-93`.
- **Tool**: Halmos.
- **Spec sketch**:
  ```solidity
  function check_master_never_owner(address user, uint256 salt, address master) external {
      vm.assume(user != address(0) && master != address(0));
      vm.assume(master != user);
      AgentAccount a = factory.createAccount(user, salt);
      assert(!a.isOwner(master));
  }
  ```
- **Effort**: 2 days (small symbolic state space).
- **Acceptance**: discharged in < 30s on a developer laptop.

### 4.2 INV-AUTH-2: bundlerSigner is never in `_owners`

- **Property**: Identical shape to INV-AUTH-1 but for
  `factory.bundlerSigner()`.
- **Cite**: `AgentAccount.sol:270-273`, `AgentAccountFactory.sol:37`.
- **Tool**: Halmos.
- **Effort**: 1 day (variant of INV-AUTH-1).
- **Acceptance**: discharged in < 30s.

### 4.3 INV-AUTH-3: sessionIssuer is never in `_owners`

- **Property**: Same shape for `factory.sessionIssuer()`.
- **Cite**: `AgentAccount.sol:276-279`, `AgentAccountFactory.sol:42`.
- **Tool**: Halmos.
- **Effort**: 1 day.
- **Acceptance**: discharged in < 30s.

### 4.4 INV-AUTH-4: `executeFromBundler` accepts only bundlerSigner-signed envelopes

- **Property**: For any non-bundler EOA `e`, any `(op, hash,
  sig_by_e)`, `executeFromBundler(op, hash, sig_by_e)` reverts.
- **Cite**: `AgentAccount.sol:358-385`.
- **Tool**: Halmos (signature-recovery space is bounded;
  `tryRecover` is the workhorse).
- **Spec sketch**: symbolic `e`, symbolic `sig`, assume
  `e != bundlerSigner()`, assert revert.
- **Effort**: 5 days. ECDSA recovery is non-trivial for the symbolic
  engine; we may need to abstract `_verifySignerEcdsa` as an
  uninterpreted function and prove the wrapper separately.
- **Acceptance**: discharged in < 5 minutes, OR axiomatised
  (`_verifySignerEcdsa` is uninterpreted in the spec but proven
  correct in a separate hand-written argument with cite).

### 4.5 INV-AUTH-5: `upgradeToWithAuthorization` requires owner-signed digest

- **Property**: For any non-owner EOA `e`, any signature `s` of `e`
  over a digest `d`, `upgradeToWithAuthorization(impl, s)` reverts
  with `NotOwnerSig` for any `impl`.
- **Cite**: `AgentAccount.sol:216-232`. The digest binds chainId
  (line 223), so cross-chain replay is also covered (see SC9
  invariant CC-1).
- **Tool**: Halmos.
- **Effort**: 5 days (same ECDSA abstraction as INV-AUTH-4).
- **Acceptance**: discharged in < 5 minutes.

### 4.6 INV-DEL-1: `DelegationManager.redeemDelegation` respects all attached caveats

- **Property**: For any delegation `d` with caveats `c[0..n]`, if
  any `c[i].beforeHook` reverts, `redeemDelegation` reverts and
  execution does NOT occur (no side effect on the delegator account).
- **Cite**: `packages/contracts/src/DelegationManager.sol:73-95`
  (top-level redemption), `:158-177` (beforeHook loop).
- **Tool**: Halmos for the structural property; Echidna for the
  stateful side-effect-non-occurrence.
- **Spec sketch**:
  ```solidity
  function check_caveat_reverts_block_execution(...) external {
      // Set up a delegation with a single caveat that always reverts
      caveats[0].enforcer = address(revertingEnforcer);
      // Snapshot
      bytes32 preState = keccak256(abi.encode(
          delegator.code, target.balance, target.code
      ));
      try delegationManager.redeemDelegation(delegations, target, value, data) {
          assert(false); // must revert
      } catch {}
      bytes32 postState = keccak256(abi.encode(
          delegator.code, target.balance, target.code
      ));
      assert(preState == postState);
  }
  ```
- **Effort**: 1 week. Cross-contract symbolic execution is harder
  for Halmos than single-contract; may need to abstract enforcer
  behaviour.
- **Acceptance**: spec passes OR we have a documented partial proof
  (e.g. proves for 1-3 caveat chains; we accept the n-caveat case
  by induction over the loop body).

### 4.7 INV-DEL-2: caveat enforcers are non-reentrant w.r.t. AgentAccount.execute

- **Property**: While inside a `beforeHook` of caveat enforcer `c`
  redeeming on delegator account `a`, a re-entrant call to
  `a.execute(...)` MUST revert.
- **Cite**: This is the SC5 reentrancy concern; see SC5 § 4 for the
  full threat scenario. The current `AgentAccount.execute` is gated
  by `_requireForExecute` (lines 700-708), which allows
  `_delegationManager` as a caller. A re-entry via the
  delegation-manager path is the open question.
- **Tool**: Echidna fuzz (a malicious enforcer is easier to fuzz
  than to symbolically reason about); supplement with hand-proof.
- **Effort**: 1.5 weeks. Requires building an adversarial enforcer
  in the test harness and a property that asserts post-redemption
  state matches a single execution.
- **Acceptance**: Echidna finds no violation in 24h fuzz; hand
  argument documents why re-entry is bounded.

### 4.8 INV-DEL-3: delegation chain authority is well-formed

- **Property**: For a chain of delegations `d[0..n]`, the root
  delegation `d[n]` MUST have `authority == ROOT_AUTHORITY`; every
  inner delegation `d[i]` (i < n) MUST have `authority ==
  hashDelegation(d[i+1])`.
- **Cite**: `DelegationManager.sol:144-148`.
- **Tool**: Halmos.
- **Effort**: 3 days.
- **Acceptance**: discharged in < 1 minute.

### 4.9 INV-DEL-4: revoked delegations cannot be redeemed

- **Property**: After `revokeDelegation(h)`, any redemption whose
  any-link hash equals `h` MUST revert with `DelegationRevoked_`.
- **Cite**: `DelegationManager.sol:97-101`, `:134`.
- **Tool**: Halmos.
- **Effort**: 2 days.
- **Acceptance**: discharged in < 30s.

### 4.10 INV-DEL-5: signature validation gates the chain

- **Property**: For any delegation `d` where the signature does NOT
  recover to (or ERC-1271-validate against) `d.delegator`, redemption
  MUST revert with `InvalidSignature`.
- **Cite**: `DelegationManager.sol:225-240`.
- **Tool**: Halmos for the ECDSA path; ERC-1271 path likely needs
  abstraction.
- **Effort**: 1 week.
- **Acceptance**: ECDSA path discharged; ERC-1271 path documented as
  axiomatised + hand-proven.

### 4.11 INV-NONCE-1: nonce monotonicity in DelegationManager

- **Property**: We do **not** use an in-DelegationManager nonce; the
  delegation `salt` field serves the uniqueness role and the
  revocation set serves the burn role. Confirm the invariant by
  showing: for distinct `salt` values, distinct delegation hashes.
- **Cite**: `DelegationManager.sol:40-42` (`DELEGATION_TYPEHASH`
  includes `salt`), `:109-122` (`hashDelegation`).
- **Tool**: Halmos.
- **Effort**: 1 day.
- **Acceptance**: discharged in < 30s. **[OWE-REVIEWER]** If we
  discover a salt collision is possible (e.g. delegator forgets to
  rotate salt), document the operational gap and add an off-chain
  mitigation note.

### 4.12 INV-OWN-1: cannot remove the last signer

- **Property**: After any sequence of `addOwner` / `removeOwner` /
  `addPasskey` / `removePasskey` calls, the account always has at
  least one signer.
- **Cite**: `AgentAccount.sol:831-836`, `:881-889`.
- **Tool**: Halmos.
- **Effort**: 3 days.
- **Acceptance**: discharged in < 1 minute.

### 4.13 INV-1271-1: ERC-1271 acceptance matches `_validateSig`

- **Property**: For any `(hash, sig)`, `isValidSignature(hash, sig)
  == ERC1271_MAGIC_VALUE` iff `_validateSig(hash, sig) == true`
  (after ERC-6492 envelope stripping).
- **Cite**: `AgentAccount.sol:719-732`.
- **Tool**: Halmos.
- **Effort**: 1 week (the ERC-6492 envelope abi.decode is non-trivial
  symbolically).
- **Acceptance**: discharged OR ERC-6492 path axiomatised.

### 4.14 INV-MOD-1: module install/uninstall maintains invariant

- **Property**: After any sequence of `installModule` /
  `uninstallModule`, `isModuleInstalled(t, m, _)` iff `m` is in
  `getInstalledModules(t)`. And no more than `MAX_HOOKS=8` hook
  modules ever active.
- **Cite**: `AgentAccount.sol:460-562`.
- **Tool**: Halmos.
- **Effort**: 5 days.
- **Acceptance**: discharged in < 5 minutes.

---

## 5. Invariants to formalise (P1)

Lower priority but valuable. Defer until P0 set is discharged.

### 5.1 INV-PROP-1: only fund owner can announce / mutate proposals

- **Cite**: `ProposalRegistry.sol:77-87`, `:89-115`.
- **Tool**: Halmos.
- **Effort**: 2 days.

### 5.2 INV-COMMIT-1: only donor or recipient (per gate) can release / cancel

- **Cite**: `CommitmentRegistry.sol:91-100`.
- **Tool**: Halmos.
- **Effort**: 3 days.

### 5.3 INV-PLEDGE-1: pledge state transitions are monotone

- **Property**: `STATUS_FULLY_HONORED` is terminal; honored amount
  is monotone non-decreasing.
- **Cite**: `PledgeRegistry.sol:56-77`.
- **Tool**: Echidna fuzz.
- **Effort**: 3 days.

### 5.4 INV-MATCH-1: only initiator owner can mutate match initiation

- **Cite**: `MatchInitiationRegistry.sol:99-122`.
- **Tool**: Halmos.
- **Effort**: 2 days.

### 5.5 INV-ATTR-1: AttributeStorage version monotone

- **Property**: `subjectVersion(s)` is monotone non-decreasing for
  every `s`.
- **Cite**: `AttributeStorage.sol:54-56` (mapping declarations);
  setter implementations bump version.
- **Tool**: Halmos.
- **Effort**: 2 days.

### 5.6 INV-PAY-1: paymaster in prod mode only sponsors accept-list

- **Cite**: `SmartAgentPaymaster.sol:101-110`.
- **Tool**: Halmos.
- **Effort**: 1 day.

### 5.7 INV-ENF-1: every enforcer in `enforcers/` is non-state-modifying in `beforeHook`/`afterHook` unless intended

- Per-enforcer:
  - `TimestampEnforcer`: view (verified).
  - `ValueEnforcer`: pure (verified).
  - `AllowedTargetsEnforcer`: pure (verified).
  - `AllowedMethodsEnforcer`: pure (verified).
  - `CallDataHashEnforcer`: TBD — verify view/pure.
  - `RateLimitEnforcer`: writes state; verify only the rate-limit
    counter changes, nothing else.
  - `QuorumEnforcer`: writes state; verify approval counter only.
  - `RecoveryEnforcer`: writes state; verify recovery timer only.
  - `AllocationLimitEnforcer`: writes state; verify allocation
    counter only.
- **Tool**: Slither view/pure check + per-enforcer Halmos spec.
- **Effort**: 1 week total across 16 enforcers.

---

## 6. Tool setup

### 6.1 Halmos

- Install: `pip install halmos` (per
  https://github.com/a16z/halmos#installation).
- Test layout: `packages/contracts/test/symbolic/Inv*.t.sol`.
- Invocation: `halmos --contract InvAuth1Test --function check_master_never_owner`.
- CI: GitHub Actions job in `.github/workflows/halmos.yml`. Run on
  every PR touching `src/AgentAccount.sol`, `src/AgentAccountFactory.sol`,
  `src/DelegationManager.sol`, or `src/enforcers/*.sol`.
- Per-invariant time budget: 10 minutes default; bump to 1 hour for
  hard invariants (e.g. INV-DEL-1).

### 6.2 Slither

- Install: `pip install slither-analyzer`.
- Config: `slither.config.json` in `packages/contracts/`.
- CI: block PR on High severity. Surface Medium as comment, not block.
- Excludes: lib/ directory; test/ directory; auto-suppress known false
  positives via inline `// slither-disable-next-line` comments.

### 6.3 Echidna

- Install: native binary from `https://github.com/crytic/echidna/releases`.
- Test layout: `packages/contracts/test/properties/*.sol`.
- Config: `echidna.yaml` per property suite.
- CI: nightly run (not per-PR; too slow). 6-hour budget per run.

### 6.4 Foundry fuzz upgrade

Current `foundry.toml`:
```
[fuzz]
runs = 256
```

[DECISION] Bump fuzz runs for load-bearing tests:

```
[fuzz]
runs = 1024

[invariant]
runs = 256
depth = 32
```

256 invariant runs at depth 32 is the Aave / OZ standard for
non-CI environments. CI invariant: 64 runs at depth 16 to keep
CI duration reasonable.

---

## 7. Setup cost + learning curve

### 7.1 Halmos

- Dollar cost: $0.
- Engineer time:
  - 1 week ramp for one senior contracts dev to be productive.
  - 3 weeks to write P0 specs.
  - 1 week to integrate into CI.
- Calendar duration: 5 weeks.
- **Total dollar cost (loaded at $300/hr senior dev): ~$60,000.**

### 7.2 Slither + Echidna

- Dollar cost: $0.
- Engineer time: 1 week to write Slither config + Echidna properties.
- **Total dollar cost: ~$12,000.**

### 7.3 Certora (conditional)

- Dollar cost: $50k license / engagement.
- Engineer time: 4 weeks per engineer to learn CVL; we deploy 1
  engineer pairing with a Certora engineer.
- **Total cost if engaged: ~$110,000** ($50k license + $60k internal).

### 7.4 Aggregate

- **Phase 2.A + 2.B (Halmos + Slither + Echidna)**: ~$72,000
  internal cost, $0 license. Calendar: 6 weeks.
- **Phase 2.C (Certora, if triggered)**: +$110,000. Calendar: +12
  weeks.

---

## 8. Acceptance criteria

### 8.1 What MUST be formally verified before mainnet

[DECISION] These invariants are blocking for mainnet launch:

- INV-AUTH-1 (master never owner) — load-bearing for spec 007.
- INV-AUTH-2 (bundler never owner) — load-bearing for spec 007.
- INV-AUTH-3 (sessionIssuer never owner) — load-bearing.
- INV-AUTH-5 (upgrade requires owner sig) — load-bearing.
- INV-DEL-3 (delegation chain well-formed) — fundamental.
- INV-DEL-4 (revoked cannot redeem) — fundamental.
- INV-OWN-1 (cannot remove last signer) — bricking-safety.

If any of these cannot be discharged by Halmos in good faith, we
trigger Phase 2.C (Certora) for the specific invariant.

### 8.2 What CAN rely on test coverage alone

- All P1 invariants (§5).
- INV-AUTH-4 (executeFromBundler signature check) — defence-in-depth;
  blast radius is bounded because EntryPoint also gates this.
- INV-DEL-1 (caveats respected) — high-effort symbolic spec; if not
  discharged, we accept Echidna fuzz + auditor opinion as substitute.
- INV-DEL-2 (caveat enforcer reentrancy) — bounded by SC5
  recommendation: add ReentrancyGuard regardless.
- INV-1271-1 (ERC-1271 round-trip) — high effort; auditor reviews
  the path manually.
- INV-MOD-1 (module install invariant) — covered by Foundry tests
  + auditor review.

### 8.3 Trigger conditions for Certora engagement

Engage Certora IF any of:

1. Any blocking invariant (§8.1) fails to discharge in Halmos within
   2 weeks of focused engineering effort.
2. Auditor (from SC1) recommends formal verification of a specific
   invariant we did not pre-identify.
3. We find a critical bug post-audit that retrospectively could have
   been caught by an FV spec we did not write.

---

## 9. Operational plan

### 9.1 Sprint allocation

- **Sprint N (current)**: Set up Halmos toolchain; write INV-AUTH-1,
  INV-AUTH-2, INV-AUTH-3 specs. Land in CI.
- **Sprint N+1**: INV-AUTH-5, INV-DEL-3, INV-DEL-4, INV-OWN-1.
- **Sprint N+2**: Slither + Echidna integration; INV-DEL-1.
- **Sprint N+3**: P1 invariants (§5).
- **Sprint N+4** (after SC1 audit results): close gaps the auditor
  identifies; possibly trigger Certora.

### 9.2 Maintenance

- Every PR that modifies `src/AgentAccount.sol`,
  `src/AgentAccountFactory.sol`, `src/DelegationManager.sol`, or any
  enforcer triggers the Halmos suite as a required check.
- A failing Halmos check is a hard blocker; the PR author must
  either fix the contract or — IF the property has genuinely
  changed — file an FV-spec-update PR signed off by the security
  lead.
- Slither runs on every PR; nightly Echidna on main.

### 9.3 Specification reviewability

Every FV spec lives at the same path as the contract it verifies,
under `test/symbolic/`. NatSpec on the spec describes the property
in English, then references the contract source lines it claims
about. A reviewer should be able to:

1. Read the English property.
2. Read the spec.
3. Confirm the spec matches the property by inspection.

This is critical: a wrong spec proves nothing. FV does not catch
spec bugs.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| F1 | Halmos cannot discharge a blocking invariant; we are stuck. | Trigger §8.3 to engage Certora; do not ship without proof. |
| F2 | We write the spec wrong; the proof is meaningless. | §9.3 reviewability requirement; security lead signs every spec PR; auditor reviews the FV spec set as part of SC1. |
| F3 | FV slows down the dev cycle excessively. | CI time budget; if Halmos is > 10 min on critical path, fall back to a smaller scope and run the full check nightly. |
| F4 | Engineers cannot ramp on Halmos. | Bring in a contractor with prior Halmos experience (a16f has a small consulting network); allocate budget if needed (~$15k for 2-week engagement). |
| F5 | Certora triggered, runs over budget. | Cap engagement at $50k; if more needed, escalate to engineering manager + board. |
| F6 | Slither false positives bog down CI. | Aggressive suppression via inline comments; only High severity blocks; document every suppression. |
| F7 | An invariant we did NOT write turns out to be load-bearing. | Auditor (SC1) is asked to enumerate critical invariants in their kickoff; we add any they identify to this doc. |

---

## 11. Open questions

1. [OWE-REVIEWER] Is the contractor-Halmos-expert budget (F4) pre-approved? Decide before Sprint N.
2. [OWE-REVIEWER] Does the FV spec set count toward the audit-readiness criterion in SC1 §3.1? Plan says yes; confirm with security lead.
3. Should we publish the FV spec set publicly post-mainnet? Plan: yes; it raises the bar on the substrate-independence argument (P1). Decide before publication.

---

## 12. Next actions

1. Developer: read Halmos docs + write INV-AUTH-1 spec as the
   tracer-bullet. Land in `test/symbolic/InvAuth1.t.sol`.
2. Security lead: review tool selection §3 with engineering manager;
   confirm decision.
3. Engineering manager: confirm engineer budget for Phase 2.A + 2.B
   (5-6 weeks senior dev time, ~$72k loaded cost).
4. Once first spec passes CI: open this doc to the auditor (SC1) for
   pre-engagement review.
