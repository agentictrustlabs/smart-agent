# Phase A.5 — Contract Follow-Ups

> **Status**: ✅ Implemented (2026-05-18). All 504 forge tests pass
> (447 pre-existing Phase A + 57 new Phase A.5). pnpm typecheck clean.
> **Depends on**: Phase A (✅ landed 2026-05-18).
> **Unblocks**: Phase B (a2a-signer model). Phase B redeploys against
> the Phase A.5 contract surface so we never have to redeploy twice.
> **Contract redeploy required.** No backwards-compat. Fresh-start
> re-seeds.

## Goal

Close the four highest-priority findings the cryptographic-posture
audit (C2 § 5), key-management audit (K1-Q1), and smart-contract
review (SC4 / SC5 / SC7) raised against Phase A, so the next deploy is
the LAST one before Phase B.

Four headline outcomes:

1. **System contracts now upgrade through a Governance multisig +
   timelock.** `Governance.sol` is our own 5-of-9 (configurable)
   contract with proposal flow, per-kind timelock, emergency pause,
   and signer-rotation through the same proposal pipeline.
2. **`bundlerSigner` and `sessionIssuer` are mutable on the factory.**
   Governance can rotate either without per-account migration; every
   AgentAccount resolves the role through `factory().X()` so rotation
   propagates automatically.
3. **DelegationManager now supports Variant A revocation.**
   `revokeDelegationByOwner` is authenticated (delegator OR delegate)
   and verifies the delegation signature first so a delegate cannot
   poison the revoked set with forged hashes.
4. **`nonReentrant` blocks the obvious reentry surfaces** —
   `AgentAccount.execute / executeBatch` and
   `DelegationManager.redeemDelegation` are guarded.
5. **Storage gaps + CI snapshot.** Every state-bearing contract ends
   with `uint256[50] __gap`. `scripts/check-storage-layout.sh`
   compares `forge inspect`'s output against versioned baselines and
   fails CI on any drift.
6. **Optional per-account upgrade timelock.** `AgentAccount` now has
   a user-settable timelock (0 = immediate, up to 30 days). When >0
   `upgradeToWithAuthorization` queues a pending upgrade; the user
   can cancel during the window, or anyone can call
   `executePendingUpgrade` once `readyAt` passes.

## Locked design decisions (no re-debate post-merge)

- **K1-Q1**: factory holds `bundlerSigner` and `sessionIssuer` as
  MUTABLE storage. Setters gated by `onlyGovernance`. Account address
  stable; role addresses rotate.
- **C2 Q1**: session key as EOA calls `DelegationManager.redeemDelegation`
  directly. Phase A.5 contract surface supports this pattern.
- **§ D2 Q5**: caveat enforcer is authoritative on chain. Off-chain
  policy gate is UX only.
- **Per-account upgrades stay user-controlled.**
  `upgradeToWithAuthorization` remains owner-signature gated. Timelock
  is OPTIONAL (`_upgradeTimelock`), defaulting to immediate. Users may
  enable it via `setUpgradeTimelock(secs)` (callable only as a self-
  call from a userOp the owner signed).
- **System-contract upgrades require Governance.** Factory, registries
  with admin functions, paymaster all gate setters behind
  `onlyGovernance`. Paymaster pause flag also flows from the same
  Governance instance.

## What landed

### Source files (new)

- `packages/contracts/src/governance/Governance.sol` — N-of-M multisig
  + per-kind timelock + emergency pause. Replay-safe nonce.
- `packages/contracts/src/governance/GovernanceManaged.sol` — base
  contract with `onlyGovernance` modifier + `whenNotPaused` hook +
  `paused()` view. Inherited by `AgentAccountFactory`.
- `packages/contracts/src/governance/IGovernance.sol` — minimal view
  interface for downstream consumers (`isPaused`, `isSigner`).

### Source files (modified)

- `packages/contracts/src/AgentAccount.sol`
  - Inherits `ReentrancyGuard`; `execute`/`executeBatch` marked
    `nonReentrant`.
  - Storage: `_upgradeTimelock`, `_pendingUpgrade`, `__gap[50]`.
  - New external API: `setUpgradeTimelock`, `executePendingUpgrade`,
    `cancelPendingUpgrade`, `upgradeTimelock`, `pendingUpgrade`.
  - `upgradeToWithAuthorization` now queues when `_upgradeTimelock>0`.
  - `version()` bumped to `"2.2.0"`.
- `packages/contracts/src/AgentAccountFactory.sol`
  - Inherits `GovernanceManaged` (immutable `governance` address).
  - `bundlerSigner` / `sessionIssuer` converted from `immutable` →
    MUTABLE storage. New setters `setBundlerSigner` /
    `setSessionIssuer`, both `onlyGovernance`.
  - Constructor adds 5th arg `governance_`.
  - Storage gap `__gap[50]`.
- `packages/contracts/src/DelegationManager.sol`
  - Inherits `ReentrancyGuard`; `redeemDelegation` marked `nonReentrant`.
  - New external `revokeDelegationByOwner(Delegation)`: authenticated
    (delegator OR delegate), verifies signature before revoking.
  - New event `DelegationRevokedBy(hash, by)`.
  - Storage gap `__gap[50]`.
- `packages/contracts/src/IDelegationManager.sol` — interface gains
  `revokeDelegationByOwner`.
- `packages/contracts/src/SmartAgentPaymaster.sol`
  - Now constructs with `(entryPoint, initialOwner, governance)`. The
    initial owner is the deployer (so `addStake`/`deposit` work during
    bootstrap); ownership is transferred to Governance at deploy end.
  - `setDevMode`, `setAccepted`, `setAcceptedBatch` switched from
    `onlyOwner` to `onlyGovernance` so they cannot be invoked even by
    the deployer post-deploy.
  - `_validatePaymasterUserOp` reads `isPaused()` from governance and
    reverts `SystemPaused` on hit — system pause halts sponsorship.
  - Storage gap `__gap[50]`.
- `packages/contracts/script/Deploy.s.sol`
  - Deploys `Governance` first.
  - Reads `GOVERNANCE_SIGNERS`, `GOVERNANCE_THRESHOLD`,
    `GOVERNANCE_TIMELOCK_SECONDS` from env. Dev fallback: 1-of-1 with
    deployer + 0 timelock.
  - Passes `address(governance)` to factory + paymaster.
  - Transfers paymaster ownership to Governance at the end.
  - Logs `GOVERNANCE_ADDRESS` for downstream services.

### Tests (new)

- `packages/contracts/test/Governance.t.sol` — 27 tests covering
  proposal flow, multisig threshold, timelock, emergency pause,
  cancellation, signer rotation, and adversarial negatives.
- `packages/contracts/test/AgentAccountFactory.RotateSigners.t.sol`
  — 9 tests proving governance can rotate either signer, the change
  propagates to existing accounts, and non-governance callers are
  rejected.
- `packages/contracts/test/AgentAccount.UpgradeTimelock.t.sol` — 10
  tests for the per-account upgrade-timelock lifecycle (queue,
  execute, cancel, immediate path for timelock=0, double-queue
  protection, MAX_UPGRADE_TIMELOCK).
- `packages/contracts/test/DelegationManager.Revoke.t.sol` — 7 tests
  covering delegator-revoke, delegate-revoke, random-EOA rejection,
  forged-struct rejection, post-revoke redemption blocked.
- `packages/contracts/test/AgentAccount.Reentrancy.t.sol` — 2 tests
  exercising the `nonReentrant` guard on `execute` and `executeBatch`
  via an adversarial target probe.
- `packages/contracts/test/DelegationManager.Reentrancy.t.sol` — 1
  test where a malicious caveat enforcer attempts to reenter
  `redeemDelegation`; outer call reverts with the guard's error.
- `packages/contracts/test/helpers/MockGovernance.sol` — minimal
  `IGovernanceView` implementation for tests that don't drive the
  full proposal flow.
- `packages/contracts/test/helpers/GovernanceFixture.sol` — helper
  to deploy a real `Governance` with known signer keys.

Tests across 19 existing test files updated to pass the new 5th
factory-constructor arg via `address(new MockGovernance(address(this)))`.
Phase A's invariants are preserved.

### CI

- `scripts/check-storage-layout.sh` — compares current
  `forge inspect <c> storage-layout --json` against the latest
  baseline in `packages/contracts/storage-layouts/<c>.<version>.json`.
  Fails on diff; pass `--update` to refresh baselines locally.
- Baselines for `AgentAccount`, `AgentAccountFactory`,
  `DelegationManager`, `SmartAgentPaymaster`, `Governance` snapshotted
  at `v2.2.0`.

### SDK

- `packages/sdk/src/abi.ts` — AgentAccount ABI gains
  `setUpgradeTimelock`, `upgradeTimelock`, `pendingUpgrade`,
  `executePendingUpgrade`, `cancelPendingUpgrade`. Factory ABI gains
  `setBundlerSigner`, `setSessionIssuer`, `governance`, and the
  matching `BundlerSignerChanged` / `SessionIssuerChanged` events.
  DelegationManager ABI gains `revokeDelegationByOwner`.

## Divergences from the SC4 / SC5 / SC7 specs

1. **`Governance` constructor takes `(address[] memory initialSigners,
   uint256 threshold, uint256 maxMembers, uint256 timelock, bool
   allowZeroTimelock)` instead of the SC4-drafted `(address[9] memory
   initialSigners)`.**
   *Rationale*: dev environments need a 1-of-1 fast-path, prod wants
   exact 5-of-9 with 48h timelock. A configurable signer count + cap
   handles both without two contracts. The minimum-production-timelock
   constant (`MINIMUM_PROD_TIMELOCK = 48 hours`) and `allowZeroTimelock`
   flag together enforce SC4's prod constraints while leaving the dev
   path open.

2. **Emergency pause uses a `proposalNonce`-based replay guard, not
   a separate digest scheme.** Each `emergencyPause(nonce, signatures)`
   call must pass `nonce == proposalNonce + 1` and the bundle of
   signatures must be over that exact nonce. Burning the nonce post-
   pause prevents replay.
   *Rationale*: keeps a single anti-replay counter for both proposals
   and pause bundles. SC4 § 4.1 left the pause-replay mechanism
   unspecified ("implementation deferred"); the nonce reuse is
   strictly conservative.

3. **DelegationManager does NOT inherit `GovernanceManaged`.** It
   still has no admin functions per SC4 § 4.3.4. Reentrancy guard +
   `__gap` are the only Phase A.5 changes.
   *Rationale*: SC4 explicitly defers DelegationManager upgrades to
   a redeploy-with-migration plan. Phase A.5 does not change that.

4. **OntologyTermRegistry / ShapeRegistry keep their existing
   `onlyGovernor` model, with the deployer's transferGovernor flow
   pointing at the `Governance` contract address.** No code change
   to the registry contracts.
   *Rationale*: their internal `onlyGovernor` modifier is functionally
   equivalent to `onlyGovernance` once the governor slot is set to
   the Governance address. Switching to inheriting `GovernanceManaged`
   would touch their constructor (breaking call sites) for zero
   security gain. The deploy script does NOT yet wire this
   transferGovernor call — operator runs it as a one-shot governance
   proposal post-deploy. Documented as a follow-up not blocking
   Phase B.

5. **Paymaster keeps Ownable2Step for inherited stake/withdraw
   functions.** SC4 § 4.3.1 asked us to replace all `onlyOwner` with
   `onlyGovernance`. The narrowly-scoped retrofit (only the explicit
   `setDevMode`/`setAccepted` setters get `onlyGovernance`) keeps
   `addStake`/`deposit` working from the deployer during bootstrap;
   ownership is transferred to Governance at deploy end so the
   Ownable surface also becomes governance-gated.
   *Rationale*: pure two-step deploy ergonomics. The end state is
   identical to a one-step `onlyGovernance` design; only the path
   through deploy differs.

6. **No `EnforcerRegistry` (SC5 § 6.4).** SC5 explicitly defers this
   to v1.5. Not in Phase A.5 scope.

7. **No static-call enforcer probing (SC5 § 6.5).** Same — flagged
   non-trivial; defer to v1.5.

8. **No formal Halmos / Echidna invariant suite (SC4 § 6.3).** Foundry
   property tests are present in `Governance.t.sol`; formal-method
   integration is SC2 scope.

## Verification

- `forge build` clean.
- `forge test`: **504 passed, 0 failed** (447 baseline + 57 new).
- `pnpm typecheck` clean across 17 workspaces.
- `scripts/check-storage-layout.sh` passes against the v2.2.0
  baselines.
- `fresh-start.sh --no-services --minimal` boots clean against the
  new contracts; cast spot-checks confirm:
  - `governance` is reachable at the logged address;
  - factory's `bundlerSigner()` / `sessionIssuer()` return the seeded
    EOAs;
  - rotating either via a governance proposal updates the factory's
    storage AND the existing AgentAccount's `bundlerSigner()` /
    `sessionIssuer()` views;
  - `revokeDelegationByOwner` works for both delegator and delegate;
  - a random EOA reverts with `NotDelegatorOrDelegate`.

## Open questions (none blocking Phase B)

- **OntologyTermRegistry / ShapeRegistry governance transfer**:
  documented as a one-shot post-deploy proposal. Could be inlined
  into Deploy.s.sol as a `governance.propose + execute` step (the
  dev 0-timelock path supports it). Defer until we have a real prod
  multisig at deploy time.
- **Paymaster ownership two-step**: `transferOwnership` is called by
  the deployer, but `acceptOwnership` must be invoked by the
  governance contract via a proposal. The dev fast-path (1-of-1,
  0 timelock) can do this in seconds; the prod 5-of-9 needs an
  initial multisig session at deploy time. Document in the prod
  deploy runbook.
- **`emergencyPause` signature ordering**: the test suite confirms
  duplicate signers count once and below-threshold bundles revert.
  No ordering requirement on the bundle (deduplication happens by
  recovered-address comparison).
