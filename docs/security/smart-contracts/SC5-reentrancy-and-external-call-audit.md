# SC5 — Reentrancy and External Call Audit

> **Status**: Draft, ready for auditor handoff. This document IS the
> pre-engagement memo for SC1 on the reentrancy threat surface.
> **Audience**: SC1 auditor (primary reader), security lead (author),
> developer (executor of recommended mitigations).
> **Document type**: Analysis (threat modelling) + impl spec
> (recommended mitigations + adversarial test plan).
> **Pairs with**: SC1 §5.3 (threat-model handoff requirement). The
> auditor receives this document before kickoff.

---

## 1. Why this is the central reentrancy concern

`DelegationManager.redeemDelegation` is the most reentrancy-sensitive
function in the system. Every redemption:

1. Iterates over a chain of delegations (potentially multi-link).
2. For each delegation, runs `beforeHook` on each attached caveat
   enforcer — **arbitrary contracts** specified by the delegation
   issuer.
3. Calls `delegator.execute(target, value, data)` — **arbitrary call**
   to **arbitrary target** with **arbitrary value + data**.
4. Iterates again, running `afterHook` on each caveat enforcer.

Two distinct reentrancy surfaces, both inside one redemption:

- **Surface A**: caveat enforcer `beforeHook` / `afterHook` is an
  arbitrary contract call. Reentry from the enforcer back into
  `redeemDelegation` (with a different delegation), or back into
  `AgentAccount.execute` directly.
- **Surface B**: `delegator.execute(target, ...)` is an arbitrary
  call. The target can re-enter the system in any way the call data
  allows.

For Surface A, the v1 audited enforcers (TimestampEnforcer,
ValueEnforcer, AllowedTargetsEnforcer, AllowedMethodsEnforcer) are
state-less / read-only / pure. They have no reentrancy risk. **Future
custom enforcers** (RateLimitEnforcer, QuorumEnforcer, etc., and any
enforcer added in a later spec) are where the risk concentrates.

For Surface B, the target may be a malicious contract. Reentrancy
checks must hold at the delegator-account layer
(`AgentAccount.execute`), the delegation-manager layer, and the
caveat-enforcer layer collectively.

---

## 2. Call-chain reconstruction

A complete trace of a redemption (cite-by-line):

```
1. caller (session-key holder) → DelegationManager.redeemDelegation(
       delegations[], target, value, data)
   Cite: packages/contracts/src/DelegationManager.sol:73-95.

2. for each delegation i in [0..n]:
     DelegationManager._validateDelegation(delegations, i)
       - hashDelegation(d)  (line 109-122)
       - _revoked[dHash] check  (line 134)
       - delegate-chain validation  (lines 137-142)
       - authority chain validation  (lines 144-148)
       - _validateSignature(d.delegator, dHash, d.signature)
         (lines 150-151, body 225-240)
         |-- if d.delegator has code:
         |     IERC1271(d.delegator).isValidSignature(...) (lines 231-234)
         |     <-- EXTERNAL CALL #1 (smart-account)
         |-- else:
               ECDSA.recover on eth-signed-message hash (lines 237-239)

     DelegationManager._runBeforeHooks(d, target, value, data)
       for each caveat j:
         ICaveatEnforcer(c.enforcer).beforeHook(...)
         <-- EXTERNAL CALL #2 (caveat enforcer, arbitrary contract)
         Cite: lines 158-177.

3. _executeFromDelegator(rootDelegator, target, value, data)
   Cite: lines 202-221.
   - rootDelegator.call(execute(target, value, data))
   <-- EXTERNAL CALL #3 (delegator AgentAccount)
   In AgentAccount.execute (line 605):
     _requireForExecute()  (line 700, allows _delegationManager)
     for each installed hook:
       IERC7579HookLike(hook).preCheck(...)  (line 619)
       <-- EXTERNAL CALL #4 (hook module, arbitrary contract)
     target.call{value: value}(data)  (line 623)
     <-- EXTERNAL CALL #5 (arbitrary target with arbitrary data)
     for each installed hook:
       IERC7579HookLike(hook).postCheck(...)  (line 633)
       <-- EXTERNAL CALL #6 (hook module)

4. _runAfterHooks for each delegation (root-to-leaf order)
   for each caveat j:
     ICaveatEnforcer(c.enforcer).afterHook(...)
     <-- EXTERNAL CALL #7 (caveat enforcer)
   Cite: lines 179-198.
```

**Seven distinct external-call surfaces** per redemption. Each is a
potential reentrancy entry point.

---

## 3. Currently audited enforcers (Surface A — known safe)

The four core enforcers landed at Phase A:

### 3.1 `TimestampEnforcer`

- `beforeHook`: view (decodes terms, reads `block.timestamp`,
  reverts on out-of-window). Cite: `enforcers/TimestampEnforcer.sol:16-29`.
- `afterHook`: pure (no-op). Cite: `:31-42`.
- **Reentrancy risk**: zero. No state, no external calls.

### 3.2 `ValueEnforcer`

- `beforeHook`: pure (decodes max, compares to `value`, reverts on
  overrun). Cite: `enforcers/ValueEnforcer.sol:15-27`.
- `afterHook`: pure (no-op).
- **Reentrancy risk**: zero.

### 3.3 `AllowedTargetsEnforcer`

- `beforeHook`: pure (linear search through allowed list). Cite:
  `enforcers/AllowedTargetsEnforcer.sol:15-30`.
- `afterHook`: pure.
- **Reentrancy risk**: zero.

### 3.4 `AllowedMethodsEnforcer`

- `beforeHook`: pure (linear search through allowed selectors).
  Cite: `enforcers/AllowedMethodsEnforcer.sol:15-34`.
- `afterHook`: pure.
- **Reentrancy risk**: zero.

These four are reentrancy-safe by construction. The audit needs to
confirm no upgrade / extension introduces statefulness.

---

## 4. Stateful enforcers (Surface A — risk concentration)

Several enforcers carry state. Each is a reentrancy risk vector.

### 4.1 `RateLimitEnforcer`

- Maintains per-(delegationHash, window) counters.
- `beforeHook` reads + writes the counter.
- **Reentrancy risk**: HIGH. A re-entrant call to `beforeHook` from
  itself, or a re-entry through `AgentAccount.execute` that triggers
  a second `redeemDelegation` with the same delegation, could
  bypass the counter by:
  - Reading counter before write (race).
  - Writing 1 to the counter twice if there's a check-then-update
    pattern.

**Recommended mitigation**: ReentrancyGuard pattern on
`beforeHook`; check-effect-interaction order; cite-line audit.

### 4.2 `QuorumEnforcer`

- Per-(delegationHash) approval set.
- `beforeHook` records approvals; reverts until N approvals seen.
- **Reentrancy risk**: HIGH. A re-entrant `beforeHook` could
  double-count an approval.

### 4.3 `RecoveryEnforcer`

- Per-(account) recovery timer.
- `beforeHook` updates timer state.
- **Reentrancy risk**: MEDIUM-HIGH. A re-entrant call could reset
  the timer.

### 4.4 `AllocationLimitEnforcer`

- Per-(delegationHash) cumulative spend.
- **Reentrancy risk**: HIGH. Classic "spend-tracker re-entry"
  pattern; check-then-write race could allow over-spend.

### 4.5 `CallDataHashEnforcer`

- Pins exact calldata hash. Used for spec-005 honor + spec-006
  commit.
- **Reentrancy risk**: LOW (no mutable state in the enforcer
  itself, but the calldata-hash binding is load-bearing for the
  USDC transfer + recordHonor atomicity).
- **Note**: the binding is to a specific calldata; an attacker
  reentering with different calldata would fail the hash check.

### 4.6 `TaskBindingEnforcer`

- Per-task binding.
- **Reentrancy risk**: MEDIUM. Verify task-state mutation order.

### 4.7 `RoundDecisionWindowEnforcer`

- Reads round metadata from an external registry.
- **Reentrancy risk**: LOW-MEDIUM. Depends on whether the registry
  is mutated within the same call chain.

### 4.8 Other stateful enforcers

- `MembershipProofEnforcer`, `PoolMandateEnforcer`,
  `StewardEligibilityEnforcer`, `DataScopeEnforcer`,
  `McpToolScopeEnforcer`, `NameScopeEnforcer`: each has its own
  state read pattern. **Auditor must enumerate per-enforcer.**

---

## 5. AgentAccount.execute — Surface B

### 5.1 Current code

```solidity
function execute(address target, uint256 value, bytes calldata data) external override {
    _requireForExecute();
    // ... hook preCheck loop ...
    (bool ok, bytes memory ret) = target.call{value: value}(data);
    // ... hook postCheck loop ...
}
```

Cite: `AgentAccount.sol:605-635`.

### 5.2 Authorization gate

`_requireForExecute()`:

```solidity
if (
    msg.sender != address(entryPoint()) &&
    msg.sender != address(this) &&
    msg.sender != _delegationManager
) {
    revert NotFromEntryPoint(...);
}
```

Cite: `AgentAccount.sol:700-708`.

### 5.3 Reentrancy threat: malicious target

The `target.call{value: value}(data)` is unconstrained. The target
can re-enter:

- `AgentAccount.execute` directly — fails `_requireForExecute`
  (target is not EntryPoint, not self, not DelegationManager).
- `DelegationManager.redeemDelegation` — passes if target has its
  own delegation. Triggers nested redemption.
- Any other AgentAccount function — most are `onlySelf`, so target
  fails. `setDelegationManager` allows owner-or-self; target is
  unlikely to be an owner.
- ERC-7579 hook surface — modules see preCheck / postCheck during
  this very call; if a hook calls back into execute, the inner
  hook loop runs again.

**Worst-case scenario**: malicious `target` is a contract owned by
the attacker. It calls `redeemDelegation` again with a different
delegation chain, triggering a second redemption. Each redemption
runs its caveat enforcers, executes its target call, and re-enters.

The check that makes this nested-redemption safe (for now) is that
each redemption's beforeHooks must succeed independently. If the
attacker doesn't have valid signed delegations for the nested
chain, it can't redeem.

But: the attacker may have **legitimate** delegations they want to
spend faster than a rate-limit allows. Calling out, then re-entering
to spend again, may bypass per-redemption state in a stateful
enforcer.

### 5.4 Reentrancy threat: malicious hook module

`installModule` is `onlyOwnerOrSelf`. A user installing a malicious
hook attacks themselves (their funds; their account). This is a
self-attack, not a system attack.

BUT: if a hook module attached by a legitimate process turns out to
have a bug, the user's account state may be corrupted. Mitigation:
limit the hook surface to first-party modules at v1 (no third-party
registry; see `AgentAccount.sol:388-398` comment).

### 5.5 Reentrancy threat: paymaster

`SmartAgentPaymaster._validatePaymasterUserOp` is `view` and reverts
on accept-list miss. No reentrancy surface in v1 dev mode.
Auditor must verify the prod-mode codepath has no new external
calls added.

---

## 6. Recommended mitigations

### 6.1 ReentrancyGuard on AgentAccount.execute / executeBatch

[DECISION] Add OpenZeppelin's `ReentrancyGuard` (or a custom
non-reentrant modifier) to `execute` and `executeBatch`.

```solidity
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AgentAccount is ..., ReentrancyGuard {
    function execute(address target, uint256 value, bytes calldata data)
        external override nonReentrant
    { ... }

    function executeBatch(Call[] calldata calls)
        external override nonReentrant
    { ... }
}
```

**Caveat**: ReentrancyGuard adds one storage slot. We must:

- Pin the slot in ERC-7201 namespaced storage (consistent with
  existing pattern: passkey storage, modules storage). Cite the
  existing pattern: `AgentAccount.sol:411-426`.
- Storage-layout check (SC7) must run after this change.

**Open question**: a legitimate "execute -> target -> redeemDelegation
-> execute on the same account" pattern is currently possible (for
self-redemption). ReentrancyGuard would break it. **Auditor must
confirm we do not have a legitimate self-reentry path.**

[OWE-REVIEWER] Search for any test that exercises self-reentry:

```
$ grep -rn 'redeemDelegation' packages/contracts/test/ | grep -i 'self'
```

If any test exists that requires self-reentry on the same account,
the design needs revisiting. Plan default: there is no such test.

### 6.2 ReentrancyGuard on DelegationManager.redeemDelegation

[DECISION] Add a non-reentrant modifier on
`redeemDelegation`. Prevents one redemption from triggering a second
redemption via a caveat enforcer or target call.

This is more aggressive than 6.1 but eliminates the entire
"nested redemption" class of bugs.

**Trade-off**: legitimate composition (e.g. "redeem delegation A,
which calls a contract that itself redeems delegation B for a
follow-on action") becomes impossible. For our v1 use cases (every
documented spec — pledge honor, grant proposal, match initiation),
no such composition is required.

[DECISION] Add ReentrancyGuard. Document the constraint loudly in
NatSpec.

### 6.3 ReentrancyGuard on stateful enforcers

[DECISION] Every stateful enforcer adds `nonReentrant` on
`beforeHook` and `afterHook` (and the storage gap for the guard
slot).

Affected enforcers (§4.1-4.4):

- `RateLimitEnforcer`
- `QuorumEnforcer`
- `RecoveryEnforcer`
- `AllocationLimitEnforcer`
- And any future stateful enforcer.

### 6.4 Caveat enforcer registry (allowlist)

[DECISION] Long-term posture: introduce an `EnforcerRegistry` that
stores audited enforcers. `DelegationManager.redeemDelegation`
checks `EnforcerRegistry.isApproved(c.enforcer)` for every caveat;
reverts otherwise.

This forecloses Surface A entirely for user delegations.

**Implementation phasing**:

- v1: ship without registry; rely on audit + ReentrancyGuard.
- v1.5 (post-SC1, post-bounty cycle): introduce registry as a
  hardening feature. Governance multisig (SC4) owns the registry.

Note: this is a substantive policy choice. It means user
delegations can ONLY use system-approved enforcers. We are trading
flexibility for safety.

[OWE-REVIEWER] Decide v1.5 timeline; flag for board approval (it
changes the protocol's permissionlessness story).

### 6.5 Static-call mode for caveat checks

[DECISION] Mark `beforeHook` and `afterHook` for STATELESS
enforcers as `view` (already done for the four core enforcers)
AND have `DelegationManager` call them via `staticcall` when
possible.

This is a defense-in-depth measure: even if a "view" enforcer
turns out to have a hidden write surface (e.g. SELFDESTRUCT or
delegatecall), `staticcall` enforces the contract-level immutability.

**Trade-off**: stateful enforcers (§4.1-4.4) cannot use staticcall.
We need a way to distinguish in code.

Proposed: `ICaveatEnforcer.beforeHookView(...)` is a separate
optional interface that DelegationManager probes via
`supportsInterface` (ERC-165). If supported, call via staticcall.
Otherwise, fall back to the writeable call.

[OWE-REVIEWER] This is non-trivial. Decide if v1 ships with this
or defers to v1.5.

### 6.6 Hook module storage isolation

Already done via ERC-7201 namespaced storage. Cite:
`AgentAccount.sol:411-426`. Verify with SC7.

### 6.7 Restrict hook modules to first-party at v1

Already done per the NatSpec at `AgentAccount.sol:388-398`. Verify
with auditor that no third-party hook registry path exists.

---

## 7. Threat scenarios (adversarial)

The auditor MUST exercise each scenario in their threat model
walkthrough. We provide concrete attack paths.

### 7.1 Scenario: malicious enforcer reenters on beforeHook

**Attacker**: a delegation issuer attaches a custom enforcer.
**Path**:

1. User signs delegation D with caveat C = custom enforcer.
2. Delegate (attacker) calls `redeemDelegation(D, target=victim,
   value=0, data=bad)`.
3. Inside C.beforeHook(...), attacker calls back into
   `DelegationManager.redeemDelegation(D2, target=user_account,
   value=lots, data=transfer)` with a SECOND delegation D2 they
   also hold.
4. D2 redemption runs its own enforcers (which pass), executes
   transfer.
5. Control returns to D's redemption; D's target call also fires.

**Effect**: two redemptions for the price of one redemption's
caveat budget. Defeats RateLimit / Allocation enforcers if they
key on "this redemption" rather than the underlying account.

**Mitigation**: §6.2 ReentrancyGuard on `redeemDelegation` blocks
the nested call. The attacker still gets to call D2 outside of
D's redemption, but cannot **interleave** them.

### 7.2 Scenario: malicious target reenters on execute

**Attacker**: gets a victim to sign a delegation whose target is
an attacker-controlled contract.
**Path**:

1. User signs delegation D with target = AttackerContract,
   allowed under AllowedTargetsEnforcer.
2. Attacker calls `redeemDelegation(D, target=AttackerContract,
   value=0, data=...)`.
3. `delegator.execute(AttackerContract, 0, data)` fires.
4. Inside AttackerContract:
   - Re-enters into `delegator.execute(other_target, value,
     other_data)` — fails `_requireForExecute` (attacker is not
     EntryPoint / self / delegationManager).
   - Re-enters into `DelegationManager.redeemDelegation(D2,
     other_target, value, other_data)` — fails because attacker
     doesn't have D2 from this user.
   - Re-enters into the same D — passes signature check
     (already validated for D), but fails `_revoked` if D was
     revoked between calls.

**Effect**: bounded by what the attacker already has via valid
delegations. With ReentrancyGuard (§6.2), no nested redemption
at all.

### 7.3 Scenario: rate-limit bypass via stateful-enforcer re-entry

**Attacker**: legitimate session-key holder who wants to spend
faster than rate limit allows.
**Path**:

1. Session has delegation D with `RateLimitEnforcer(1/hour)`.
2. Session calls `redeemDelegation(D, target=Bank, value=X,
   data=withdraw)`.
3. Inside `Bank.withdraw`, callback to attacker contract.
4. Attacker calls `redeemDelegation(D, target=Bank, value=Y,
   data=withdraw)` again.
5. If the rate-limit counter is updated AFTER the target call
   completes (check-then-update), the second call sees the old
   counter and passes.

**Effect**: 2x rate limit bypass.

**Mitigation**: §6.2 ReentrancyGuard on `redeemDelegation` is the
primary fix. §6.3 ReentrancyGuard on the enforcer is defense in
depth. Audit must verify the enforcer's order is
check-effect-interaction.

### 7.4 Scenario: hook module reenters during target call

**Attacker**: user installed a malicious hook (self-attack, but
possible if the hook was attached by a compromised "install
delegation").
**Path**:

1. User has hook H installed.
2. User redeems delegation D, calling target T.
3. AgentAccount.execute runs preCheck on H.
4. H.preCheck calls back into `execute(other_target, value,
   data)`. `_requireForExecute` allows self (hook → execute? no,
   hook is called from `execute`, so msg.sender at preCheck is the
   redemption caller, which is EntryPoint OR DelegationManager).

   Actually wait — let's verify the msg.sender chain.

   - DelegationManager.redeemDelegation called by EOA →
     `delegator.call(execute(...))` → AgentAccount.execute
     msg.sender = DelegationManager.
   - In execute, `IERC7579HookLike(hooks[i]).preCheck(msgSender,
     value, hookMsgData)`. So inside H.preCheck, the `msg.sender`
     is `AgentAccount` (address(this)).
   - H.preCheck calls back into `execute(...)`. msg.sender for the
     re-entering call is H. `_requireForExecute` checks H against
     entryPoint / address(this) / DelegationManager. H is none.
     **Re-entry blocked.**

   So `_requireForExecute` is already a strong gate. We are safe
   from hook-to-execute re-entry.

   BUT: H can call other functions on AgentAccount that aren't
   gated by `_requireForExecute`. Examples:
   - `addPasskey` — `onlySelf` (`AgentAccount.sol:868`); H is not
     self. Safe.
   - `installModule` — `onlyOwnerOrSelf`. H is not owner / self.
     Safe (unless H is an owner — which only happens if user
     made it an owner, which is a self-attack).
   - `setDelegationManager` — `msg.sender != address(this) &&
     !_owners[msg.sender]` revert (line 248). Safe.

5. **Verdict**: hook re-entry through `execute` is blocked by
   `_requireForExecute`; hook re-entry through admin-style
   functions is blocked by `onlySelf` / `onlyOwnerOrSelf`. Hook
   surface is bounded.

**Auditor confirm**: enumerate every external function on
AgentAccount and confirm each has appropriate gating.

### 7.5 Scenario: ERC-1271 callback in DelegationManager._validateSignature

`DelegationManager.sol:225-240`:

```solidity
function _validateSignature(address signer, bytes32 digest, bytes calldata signature) internal view {
    if (signer.code.length > 0) {
        bytes4 result = IERC1271(signer).isValidSignature(digest, signature);
        if (result != IERC1271.isValidSignature.selector) revert InvalidSignature();
        return;
    }
    // ... EOA path ...
}
```

This is the smart-account signature path. `signer` (delegator) is
called via ERC-1271. If `signer` is a malicious contract:

- `isValidSignature` is declared `view` (`AgentAccount.sol:719`).
- But Solidity does not enforce `view` on the callee; the bytecode
  may write state if the caller doesn't use STATICCALL.
- Check: does DelegationManager use staticcall? Solidity compiler:
  for a function call to an interface declared `view`, the
  compiler emits STATICCALL only if it knows the function is
  `view`. Since `IERC1271.isValidSignature` is declared `view` in
  the interface, the compiler SHOULD emit STATICCALL.

**Auditor verify**: confirm STATICCALL is emitted for the
`isValidSignature` call (check bytecode via `forge inspect ... deployedBytecode`).

If STATICCALL is emitted: no reentrancy possible (state writes
fail). Safe.

If not: malicious `signer` could re-enter `DelegationManager`
during signature validation. §6.2 ReentrancyGuard would block it.

### 7.6 Scenario: afterHook reenters

`afterHook` runs after the target.call returns. State may have
changed during the target call (e.g. balance moved). If
`afterHook` reads post-execution state to enforce a constraint
(e.g. "balance after must be >= balance before"), a malicious
target could manipulate the read.

**Mitigation**: §6.1 ReentrancyGuard on `AgentAccount.execute`
bounds the target's re-entry surface to NON-execute paths only
(see §7.4). §6.2 ReentrancyGuard on `redeemDelegation` prevents
the target from triggering a second redemption that could
manipulate the same enforcer's state.

---

## 8. Adversarial test plan

Place under `packages/contracts/test/AdversarialReentrancy.t.sol`.

### 8.1 Malicious enforcer test fixtures

Build two malicious enforcers:

```solidity
contract MaliciousReentrantEnforcer is ICaveatEnforcer {
    DelegationManager public dm;
    Delegation[] public secondaryChain;
    bool public reentryAttempted;

    function beforeHook(...) external override {
        if (!reentryAttempted) {
            reentryAttempted = true;
            try dm.redeemDelegation(secondaryChain, target, value, data) {
                // re-entry succeeded
            } catch { /* re-entry blocked */ }
        }
    }

    function afterHook(...) external override {}
}

contract StateMutatingViewEnforcer is ICaveatEnforcer {
    uint256 public counter;
    function beforeHook(...) external override {
        // declared external (not view); could write state
        counter += 1;
    }
    function afterHook(...) external override {}
}
```

### 8.2 Test cases

1. **`test_MaliciousEnforcer_CannotReenterRedeem`** — set up
   delegation D1 with `MaliciousReentrantEnforcer`. Attempt to
   redeem D1; inside beforeHook, attempt to redeem D2 (separate
   delegation by same user). With §6.2 mitigation: outer redemption
   reverts on re-entry attempt. Assert outer redemption reverted;
   secondary chain's effects did NOT occur.

2. **`test_MaliciousTarget_CannotReenterExecute`** — set up
   delegation D with target = MaliciousTarget. MaliciousTarget
   calls back to `delegator.execute(victim, value, data)`. Assert
   inner execute reverts with `NotFromEntryPoint`. Outer
   redemption succeeds (the target call to MaliciousTarget itself
   succeeds, but its re-entry attempt failed).

3. **`test_MaliciousTarget_CannotReenterRedeem`** — set up D with
   target = MaliciousTarget. MaliciousTarget calls
   `dm.redeemDelegation(D2, victim, value, data)` where D2 is a
   delegation MaliciousTarget DOES have. With §6.2 mitigation:
   inner redemption reverts. Outer redemption succeeds.

4. **`test_RateLimitEnforcer_CannotBeBypassedViaReentry`** — set
   up D with RateLimitEnforcer(1/min). Trigger redemption that
   leads to a re-entry attempt at a second redemption within the
   minute. With mitigations: attempt fails; rate limit holds.
   Without mitigations: test FAILS (we want to see the failure
   so we can confirm the mitigation works).

5. **`test_HookModule_CannotReenterExecute`** — install
   MaliciousHookModule. Make a self-call to execute. Inside
   preCheck, attempt re-entry. Assert re-entry fails.

6. **`test_HookModule_CannotInstallAnotherModule`** — install
   MaliciousHookModule. Inside preCheck, attempt
   `installModule(...)`. Assert it reverts with
   `NotOwnerOrSelf`.

7. **`test_ERC1271_Callback_Is_StaticCall`** — deploy a
   StateMutatingERC1271 contract; use it as a delegator.
   Re-entry attempt during signature validation fails because
   STATICCALL prevents writes. Verify via `forge inspect` that
   STATICCALL is emitted.

8. **`test_AfterHook_Sees_PostExecutionState_Correctly`** —
   normal positive path; afterHook reads post-call state;
   assert correct.

9. **`test_AfterHook_CannotReenterMidExecution`** — pathological
   afterHook attempts re-entry; mitigations block.

10. **`test_NestedDelegation_RootMatches_NoReentry`** — multi-link
    chain (n=3); verify all 3 levels' beforeHooks fire in order,
    afterHooks fire in reverse order, target call fires exactly
    once.

### 8.3 Property tests

11. **`property_RedeemNeverInterleavesWithRedeem`** — invariant:
    no two `DelegationRedeemed` events emitted by the same
    DelegationManager have overlapping execution windows (in the
    same tx).

12. **`property_ReentryGuardSetCorrectly`** — invariant: at the
    end of any successful or failed redeemDelegation,
    ReentrancyGuard is in the "not entered" state.

13. **`property_AllStatefulEnforcers_NonReentrant`** — for each
    stateful enforcer, attempt a re-entry; verify it reverts.

---

## 9. SC1 auditor handoff checklist

The auditor receives this document plus:

- [ ] Bytecode disassembly of `DelegationManager` showing STATICCALL
      for `isValidSignature`.
- [ ] Per-enforcer state classification (state-less / view / pure
      vs. stateful) table.
- [ ] List of every function on AgentAccount with its access modifier
      (`onlySelf`, `onlyOwnerOrSelf`, `_requireForExecute`-gated,
      public).
- [ ] The adversarial test suite §8 passing.
- [ ] §6 mitigations either applied OR documented as "planned for
      v1.5, accept residual risk".

---

## 10. Residual risks (after mitigations)

| # | Risk | Mitigation | Residual |
|---|---|---|---|
| R1 | Future stateful enforcer added without ReentrancyGuard. | §6.3 + CI guard. | CI guard catches; failure to add guard = PR rejection. |
| R2 | Auditor finds a path we missed. | SC1 + SC3 bounty. | Acceptable; this is what the audit is for. |
| R3 | Re-entry through a function not yet enumerated. | §9 checklist enumerates every public/external function with its gate. | Continuous: every new function MUST add its gate to the doc. |
| R4 | ERC-1271 STATICCALL assumption is broken in future Solidity version. | Pin Solidity version (foundry.toml at 0.8.28). Re-verify on each version bump. | Acceptable. |
| R5 | EnforcerRegistry (§6.4) is not in v1; arbitrary enforcers allowed. | ReentrancyGuard everywhere; SC1 catches. | Acceptable for v1; revisit in v1.5. |
| R6 | Self-reentry pattern would be useful but we've blocked it. | Document the constraint; if a future spec needs it, redesign with explicit support. | Acceptable. |

---

## 11. Open questions

1. [OWE-REVIEWER] Confirm no legitimate test exercises self-reentry
   (§6.1 OWE). If one exists, redesign before applying
   ReentrancyGuard.
2. [OWE-REVIEWER] Decide v1 vs v1.5 for §6.4 EnforcerRegistry. Plan
   default: v1.5.
3. [OWE-REVIEWER] Decide §6.5 staticcall-mode-for-view-enforcers
   timing.
4. Auditor must verify §7.5 STATICCALL emission for ERC-1271.
5. Confirm `_requireForExecute` is sufficient for the hook
   re-entry case (§7.4); auditor specifically asked to enumerate
   all admin functions.

---

## 12. Next actions

1. Developer: implement §6.1 ReentrancyGuard on AgentAccount.execute
   / executeBatch. Run §6.1 OWE-REVIEWER check first.
2. Developer: implement §6.2 ReentrancyGuard on
   DelegationManager.redeemDelegation.
3. Developer: implement §6.3 ReentrancyGuard on stateful enforcers.
4. Developer: implement §8 adversarial test suite.
5. Security lead: confirm §7.5 STATICCALL assumption via bytecode
   inspection.
6. Security lead: bundle into SC1 audit handoff package.
