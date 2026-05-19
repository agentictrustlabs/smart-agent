# SC4 — Upgrade Governance (Implementation Spec)

> **Status**: Draft, ready for PM pickup as Phase A.5 of spec 007.
> **Audience**: developer (executor), security lead (technical sponsor),
> engineering manager (gate-keeper), board sub-committee (multisig signers).
> **Document type**: BOTH planning doc AND implementation spec. The first
> half is the policy and reasoning; the second half is the contract spec
> a developer can pick up.
> **Prerequisite**: Spec 007 Phase A landed (✅ 2026-05-18). The
> `_authorizeUpgrade` + `upgradeToWithAuthorization` machinery for user
> accounts is in place. This doc adds the **system contracts** upgrade
> path.

---

## 1. Problem statement

Phase A locked down **user account** upgrades:

> `_authorizeUpgrade` requires `msg.sender == address(this)`. The ONLY
> path that satisfies this is a re-entrant call from
> `upgradeToWithAuthorization` (`AgentAccount.sol:216-232`), which
> verifies an explicit owner signature first. Master / bundler /
> session-issuer cannot upgrade.

Cite: `packages/contracts/src/AgentAccount.sol:189-197, 216-232`.

But Phase A says nothing about the OTHER upgradeable contracts in the
system — and several are upgradeable, while others have admin keys
that can drain or brick state. The current state is:

| Contract | Upgradeable? | Admin authority | Current governance |
|---|---|---|---|
| `AgentAccount` (per-account proxy) | Yes (UUPS) | User's owner sig | ✅ Phase A — owner-signed digest |
| `AgentAccountFactory` | **No** (immutable storage) | Deployer | ❌ Re-deploy = address change |
| `AgentAccountResolver` | TBD verify | TBD | ❌ Not yet specified |
| `DelegationManager` | **No** in current code | None — stateless except revocation set | ❌ Re-deploy possible but breaks chains |
| Caveat enforcers (16+ in `enforcers/`) | **No** | None | ❌ Re-deploy possible but breaks existing delegations citing them |
| `SmartAgentPaymaster` | **No** | `onlyOwner` (sets dev mode, accept list) | ❌ Single EOA owner — drainable |
| `MultiSendCallOnly` | **No** | None | n/a |
| Registries (Proposal/Commitment/Pledge/GrantProposal/MatchInitiation/Vote/Pool/Fund/Mandate/Credential/AgentName*/AgentSkill*/Steward/Geo*/Ontology/Shape/AttributeStorage-inheriting) | **No** | None at contract level; per-row gates (`onlyFundOwner`, `onlyDonorOwner`, etc.) | ❌ No upgrade path |
| `AttributeStorage` (abstract) | **No** | n/a | n/a |
| `OntologyTermRegistry` | **No** | Has admin to register/deactivate terms — **VERIFY** | ❌ Unverified admin model |
| `ShapeRegistry` | **No** | Has admin to register shapes — **VERIFY** | ❌ Unverified |
| `SessionAgentAccountFactory` | **No** | Deployer | ❌ Same as factory |

[OWE-REVIEWER] Per-contract verification of "Upgradeable?" and "Admin
authority" columns is required before the implementation work below.
The implementation lead opens a verification PR that adds storage
gap + governance gate per contract.

### 1.1 What is broken right now

1. **No upgrade path for system contracts.** If the auditor finds a
   bug in `DelegationManager` post-launch, our only recovery is:
   redeploy → migrate every active delegation → in-flight delegations
   citing the old DelegationManager become unredeemable. This is the
   exact scenario UUPS upgrades exist to avoid.

2. **No upgrade path for caveat enforcers.** A bug in
   `AllowedMethodsEnforcer` would force us to redeploy the enforcer
   and ask every existing delegation that cites the old enforcer to
   be reissued. With the substrate-independence rule (no Safe / DTK
   to fall back on), our user base has no graceful migration path.

3. **Single-EOA paymaster owner.** `SmartAgentPaymaster` (lines
   54-83) uses `onlyOwner` with the BasePaymaster Ownable2Step
   pattern. A single key controls `setDevMode`, `setAccepted`,
   `setAcceptedBatch`, and (inherited from BasePaymaster)
   `withdrawTo`. The paymaster deposit is fully drainable by that key.

4. **No timelock anywhere.** Any admin change is instant. Users
   cannot exit before a hostile change lands.

5. **No emergency pause.** No way to halt redemption activity if a
   critical bug is being actively exploited.

### 1.2 What we are NOT solving here

- Per-account upgrades by users: already done in Phase A.
- Tokenomics-driven on-chain governance (e.g. snapshot voting,
  Aragon-style DAOs): out of substrate-independence scope; we are
  building an upgrade-governance multisig, not a DAO.
- L2-bridging / cross-chain governance: out for v1.

---

## 2. Goals

[DECISION] The system-contracts upgrade-governance model is:

> **N-of-M multisig + timelock**, where the multisig owns the
> `_authorizeUpgrade` / admin gate of every system contract, and the
> timelock enforces a minimum delay between governance proposal and
> execution. Emergency pause is a separate, faster path that does NOT
> grant upgrade authority — only pause.

[DECISION] Specific parameters:

- **N = 5, M = 9** (5-of-9 multisig).
- **Timelock = 48 hours** for upgrades.
- **Emergency pause = same multisig (5-of-9), no timelock**, but
  pause is the ONLY action it can take with no timelock.
- **Hardware-wallet-backed key custody** for all 9 signers.
- **Geographically distributed signers** (2 continents minimum).

Rationale for these specific numbers:

- 5-of-9: industry standard for serious wallet contracts (Safe Global
  itself runs ~5-of-9 type configurations; Aave, Compound, Optimism
  use similar thresholds). Below 5-of-7 is too low; above 7-of-11
  becomes operationally infeasible (multi-week multisig coordination).
- 48-hour timelock: long enough for users to exit if they disagree;
  short enough that an incident response patch can deploy within a
  weekend. Compound v3 uses 48h; Optimism's superchain uses ~7-day;
  Aave varies by risk tier (24h-7d). 48h is the right balance for
  our risk surface (we have an emergency pause for incidents).
- 9-member set: enough redundancy that single signer loss (hardware
  failure, lost device, dismissal) doesn't break governance.

---

## 3. Membership

[DECISION] The 9 multisig members are spread across roles:

| Slot | Role | Holder |
|---|---|---|
| 1 | CTO | [name TBD] |
| 2 | Founder | [name TBD] |
| 3 | Security lead | [name TBD] |
| 4 | Senior contracts dev | [name TBD] |
| 5 | Senior contracts dev (second) | [name TBD] |
| 6 | External advisor (security) | [name TBD — auditor partner or community member] |
| 7 | External advisor (industry) | [name TBD] |
| 8 | Board member | [name TBD] |
| 9 | Operations lead | [name TBD] |

[OWE-REVIEWER] Slot assignments require board approval. Each
candidate signs a key-custody agreement covering:

- Hardware wallet only (Ledger or GridPlus Lattice1; SECP256K1).
- No cloud backup of the seed phrase.
- Off-site backup of the seed phrase in a tamper-evident envelope.
- Annual key-ceremony attendance (key health check).
- Disclosure obligation if hardware is lost / compromised.

### 3.1 Geographic distribution

Of the 9 signers, no more than 5 should be in any single country, and
no more than 3 in any single city. This bounds a "raid all signers at
once" scenario.

### 3.2 Replacement protocol

If a signer leaves:

1. Multisig issues a transaction (5-of-9) replacing the old signer
   with a new one.
2. Old signer's hardware is destroyed in front of two witnesses
   (one signer, one security lead).
3. New signer goes through key ceremony.

---

## 4. Architecture

### 4.1 `Governance.sol` contract

New contract: `packages/contracts/src/governance/Governance.sol`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Governance
/// @notice 5-of-9 multisig + 48-hour timelock for upgrade authority over
///         system contracts. Pause is the only action exempt from timelock.
contract Governance {
    // ─── Signer set ────────────────────────────────────────────────
    mapping(address => bool) public isSigner;
    uint256 public constant THRESHOLD = 5;
    uint256 public constant MEMBER_COUNT = 9;

    // ─── Timelock ──────────────────────────────────────────────────
    uint256 public constant UPGRADE_TIMELOCK = 48 hours;
    uint256 public constant SIGNER_TIMELOCK  = 48 hours; // signer-set changes too

    enum ProposalState { None, Queued, Executed, Cancelled }
    enum ProposalKind  { Upgrade, AdminCall, SignerChange, Pause, Unpause }

    struct Proposal {
        ProposalKind kind;
        address target;        // contract being acted on
        bytes data;            // call data
        uint256 readyAt;       // earliest exec time
        ProposalState state;
        uint256 approvals;
        mapping(address => bool) approvedBy;
    }

    mapping(bytes32 => Proposal) internal _proposals;

    // ─── Pause state ───────────────────────────────────────────────
    bool public paused;

    // ─── Events ────────────────────────────────────────────────────
    event ProposalQueued(bytes32 indexed proposalId, ProposalKind kind, address target, uint256 readyAt);
    event ProposalApproved(bytes32 indexed proposalId, address signer);
    event ProposalExecuted(bytes32 indexed proposalId);
    event ProposalCancelled(bytes32 indexed proposalId);
    event PauseSet(bool paused);
    event SignerSet(address indexed signer, bool active);

    // ─── Errors ────────────────────────────────────────────────────
    error NotSigner();
    error AlreadyApproved();
    error NotReady();
    error AlreadyExecuted();
    error InvalidKind();
    error InvalidThreshold();
    error ExecFailed(bytes reason);
    error CallerNotPaused();

    constructor(address[9] memory initialSigners) {
        for (uint256 i = 0; i < 9; i++) {
            require(initialSigners[i] != address(0), "zero signer");
            isSigner[initialSigners[i]] = true;
            emit SignerSet(initialSigners[i], true);
        }
    }

    // ─── Proposal flow ────────────────────────────────────────────

    function propose(
        ProposalKind kind,
        address target,
        bytes calldata data
    ) external returns (bytes32 proposalId) {
        if (!isSigner[msg.sender]) revert NotSigner();
        proposalId = keccak256(abi.encode(kind, target, data, block.timestamp));
        Proposal storage p = _proposals[proposalId];
        p.kind = kind;
        p.target = target;
        p.data = data;
        p.readyAt = block.timestamp + _delayFor(kind);
        p.state = ProposalState.Queued;
        p.approvals = 1;
        p.approvedBy[msg.sender] = true;
        emit ProposalQueued(proposalId, kind, target, p.readyAt);
        emit ProposalApproved(proposalId, msg.sender);
    }

    function approve(bytes32 proposalId) external {
        if (!isSigner[msg.sender]) revert NotSigner();
        Proposal storage p = _proposals[proposalId];
        if (p.state != ProposalState.Queued) revert AlreadyExecuted();
        if (p.approvedBy[msg.sender]) revert AlreadyApproved();
        p.approvedBy[msg.sender] = true;
        p.approvals += 1;
        emit ProposalApproved(proposalId, msg.sender);
    }

    function execute(bytes32 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.state != ProposalState.Queued) revert AlreadyExecuted();
        if (p.approvals < THRESHOLD) revert InvalidThreshold();
        if (block.timestamp < p.readyAt) revert NotReady();

        p.state = ProposalState.Executed;
        emit ProposalExecuted(proposalId);

        if (p.kind == ProposalKind.SignerChange) {
            _applySignerChange(p.data);
            return;
        }
        if (p.kind == ProposalKind.Pause) {
            paused = true;
            emit PauseSet(true);
            return;
        }
        if (p.kind == ProposalKind.Unpause) {
            paused = false;
            emit PauseSet(false);
            return;
        }

        (bool ok, bytes memory ret) = p.target.call(p.data);
        if (!ok) revert ExecFailed(ret);
    }

    function cancel(bytes32 proposalId) external {
        if (!isSigner[msg.sender]) revert NotSigner();
        Proposal storage p = _proposals[proposalId];
        if (p.state != ProposalState.Queued) revert AlreadyExecuted();
        p.state = ProposalState.Cancelled;
        emit ProposalCancelled(proposalId);
    }

    /// @notice Emergency pause. Bypasses timelock; same threshold.
    /// @dev Pause is the ONLY action the multisig can take with no
    ///      delay. Pause grants no upgrade authority; only the bool
    ///      `paused` flag flips. Downstream contracts read this flag
    ///      via `isPaused()`.
    function emergencyPause(bytes calldata signatures) external {
        // signatures = concat of 5+ signatures over a domain-separated
        // "EMERGENCY_PAUSE" digest. We don't use the standard propose
        // flow because pause must execute in one tx with one caller.
        bytes32 digest = keccak256(abi.encode(
            "EMERGENCY_PAUSE", address(this), block.chainid
        ));
        uint256 count = _countValidSignatures(digest, signatures);
        if (count < THRESHOLD) revert InvalidThreshold();
        paused = true;
        emit PauseSet(true);
    }

    function isPaused() external view returns (bool) {
        return paused;
    }

    // ─── Internals ────────────────────────────────────────────────

    function _delayFor(ProposalKind kind) internal pure returns (uint256) {
        if (kind == ProposalKind.Upgrade || kind == ProposalKind.AdminCall) return UPGRADE_TIMELOCK;
        if (kind == ProposalKind.SignerChange) return SIGNER_TIMELOCK;
        if (kind == ProposalKind.Unpause) return UPGRADE_TIMELOCK;
        if (kind == ProposalKind.Pause) revert InvalidKind(); // pause uses emergencyPause
        revert InvalidKind();
    }

    function _applySignerChange(bytes memory data) internal {
        (address oldSigner, address newSigner) = abi.decode(data, (address, address));
        if (oldSigner != address(0)) {
            isSigner[oldSigner] = false;
            emit SignerSet(oldSigner, false);
        }
        if (newSigner != address(0)) {
            isSigner[newSigner] = true;
            emit SignerSet(newSigner, true);
        }
    }

    function _countValidSignatures(bytes32 digest, bytes calldata sigs) internal view returns (uint256) {
        // 65 bytes per sig; count distinct signers in our set
        // (deduplicated). Implementation deferred to OZ SignatureChecker
        // or in-line ecrecover loop; pseudocode here.
        // ...
    }
}
```

### 4.2 Target contract modifications

Every system contract that needs governance gains an `onlyGovernance`
modifier and points to the Governance contract:

```solidity
abstract contract GovernanceManaged {
    address public immutable governance;

    error NotGovernance();
    error SystemPaused();

    constructor(address gov) {
        governance = gov;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier whenNotPaused() {
        if (IGovernanceView(governance).isPaused()) revert SystemPaused();
        _;
    }
}

interface IGovernanceView {
    function isPaused() external view returns (bool);
}
```

### 4.3 Per-contract retrofit

For each contract identified in §1 with admin authority:

#### 4.3.1 `SmartAgentPaymaster`

- Replace `onlyOwner` (inherited Ownable2Step) with `onlyGovernance`.
- `withdrawTo` (from BasePaymaster) — same.
- `setDevMode`, `setAccepted`, `setAcceptedBatch` — `onlyGovernance`.
- Apply `whenNotPaused` to `_validatePaymasterUserOp` so paused
  paymaster rejects all userOps gracefully.

#### 4.3.2 `OntologyTermRegistry`

- Term registration / deactivation — `onlyGovernance`.
- VERIFY current admin model before retrofit.

#### 4.3.3 `ShapeRegistry`

- Shape registration / deactivation — `onlyGovernance`.

#### 4.3.4 `DelegationManager`

Currently has no admin authority. To make it upgradeable, we'd need to
convert it to UUPS:

[DECISION] **Do NOT make `DelegationManager` upgradeable in v1.** It is
stateless except for the revoked-delegation set. Upgrading the
DelegationManager would break existing delegations (the EIP-712 domain
includes `verifyingContract`). Instead:

- Deploy a new DelegationManager on a critical bug, with explicit
  user migration.
- Make this commitment explicit: there is no upgrade path for the
  DelegationManager singleton. Auditor MUST clear it for production.
- Add a `DelegationManagerVersion` event so downstream code can
  index version transitions.
- The bug-bounty programme (SC3) prices DelegationManager bugs at
  the Critical ceiling specifically because they may require migration.

#### 4.3.5 Caveat enforcers

Same reasoning as DelegationManager — stateless (or carry only
counter state), not upgradeable in place. Re-deploy + reissue is the
migration path. Most v1 enforcers are pure / view (TimestampEnforcer,
ValueEnforcer, AllowedTargetsEnforcer, AllowedMethodsEnforcer) and
have no state to migrate.

For stateful enforcers (RateLimitEnforcer, QuorumEnforcer,
RecoveryEnforcer, AllocationLimitEnforcer):

- Add `onlyGovernance` administrative reset path
  (`resetState(bytes32 delegationHash)`) for incident response.
- Migration path: re-deploy with state migrated by governance
  proposal (snapshot read → multisig submits resetState calls on
  new enforcer).

#### 4.3.6 `AgentAccountFactory` / `SessionAgentAccountFactory`

Not upgradeable; constructor sets immutables. To rotate
`bundlerSigner` / `sessionIssuer`:

- Phase A docs state factory-indirect resolution (`AgentAccount.sol:270-279`).
- Add an upgrade path: a new `AgentAccountFactory` with new
  bundlerSigner / sessionIssuer can be deployed; the old factory's
  immutables don't change, but accounts could be migrated to read
  from the new factory via a per-account owner-signed call.
- This is a future enhancement; v1 ships with the existing
  factory-indirect pattern and the understanding that bundler /
  session-issuer rotation requires user-side migration.

#### 4.3.7 `AgentAccount` user accounts

Already governed by user's owner signature per Phase A. We do NOT
give the multisig authority over user accounts; that would violate
substrate-independence (the user is the ultimate owner of their
account).

Per-account upgrades remain user-signed (`upgradeToWithAuthorization`,
`AgentAccount.sol:216-232`).

#### 4.3.8 Registries

Most registry mutations are gated per-row (e.g.
`ProposalRegistry.onlyFundOwner`, `:77`). The registry contracts
themselves have no admin. To add system-wide pause:

- Add a `whenNotPaused` modifier from `GovernanceManaged` to the
  write surface (`announceAward`, `setStatus`, etc.).
- Paused state pauses ALL writes to ALL registries (system-wide kill
  switch). Reads stay live.

### 4.4 Migration

[DECISION] Migration sequence (Phase A.5 deployment):

1. Deploy `Governance.sol` with 9 multisig members in constructor.
2. Deploy new versions of every system contract using
   `GovernanceManaged` base, pointing to the deployed governance.
3. For registries: deploy new registries; migrate state via a
   one-shot read-emit migration script (run as `forge script`).
4. Update environment configuration (deployer-only) to point at new
   addresses.
5. Run `scripts/fresh-start.sh` on dev environments.
6. For production: coordinate with user base; no production live as
   of writing.

[OWE-REVIEWER] Counterfactual address change on each migrated
contract — same as Phase A. Documented in spec 007 master plan.

---

## 5. Threat model

### 5.1 Threats this addresses

- **T1 — Single-key compromise of system contracts.** Pre-SC4, a
  deployer-key compromise gave the attacker `setDevMode(false)` /
  `setAccepted(attacker, true)` / `withdrawTo(attacker, deposit)` on
  the paymaster, plus admin authority over any other contract using
  Ownable. Post-SC4, attacker needs 5 simultaneous hardware-wallet
  compromises geographically distributed.
- **T2 — Insider rug.** Pre-SC4, any single insider with deployer
  access could drain the paymaster. Post-SC4, 5 insiders must
  collude AND wait 48 hours (during which any one of them can
  cancel).
- **T3 — Surprise upgrade.** Pre-SC4, upgrade could land in a single
  block. Post-SC4, the 48-hour timelock window gives users 2 days
  to exit before any change.
- **T4 — Slow incident response.** Pre-SC4, no pause; an active
  exploit runs until contracts are abandoned. Post-SC4, 5 multisig
  signers can pause all writes within ~5-30 minutes of coordinating.
- **T5 — Bricking via signer-set drift.** Pre-SC4, signer changes
  on the paymaster were instant. Post-SC4, signer changes also
  flow through the 48-hour timelock — a captured signer can't
  remove the others before they can react.

### 5.2 Threats this does NOT address

- **T6 — User-account compromise.** Per-account ownership remains
  user-signed (Phase A); multisig has no authority here. This is
  by design.
- **T7 — DelegationManager singleton bug.** Mitigated by SC1 audit
  + SC3 bounty + the no-upgrade commitment in §4.3.4.
- **T8 — Caveat enforcer bug.** Same — re-deploy + reissue is the
  fix.
- **T9 — Multisig contract bug (this contract).** Audit SC1 in scope;
  hardware-wallet UI bug; etc. We accept the residual risk and aim
  to use a well-audited multisig implementation.

[DECISION] We do NOT use Safe Global multisig as a deployed
dependency (substrate-independence P1). We implement our own. The
implementation MUST be in SC1 audit scope at P0 tier.

### 5.3 Substrate-independence consideration

The substrate-independence rule (P1; `docs/architecture/principles.md`)
forbids runtime dependencies on Safe / Aragon / DTK. The multisig
contract is our own.

We will study (not depend on) Safe v1.4.1, Aragon Council, and
Compound Timelock for design patterns. Specifically:

- Compound Timelock (audited, widely-deployed) is the reference for
  the timelock semantics.
- Safe v1.4.1 is the reference for signer-set + threshold semantics
  (without the module surface — we don't need modules in the
  multisig itself).
- We omit features we don't need: meta-transactions, module
  registry, guard pattern.

---

## 6. Foundry test plan

Place under `packages/contracts/test/Governance.t.sol`.

### 6.1 Positive paths

1. `test_FiveOfNineCanProposeAndExecuteAfterTimelock` — propose;
   approvals: 1, 2, 3, 4, 5; warp 48h; execute. Asserts target
   state changed.
2. `test_AnySignerCanCancel` — propose; another signer cancels;
   execute fails with `AlreadyExecuted` (state == Cancelled).
3. `test_PauseSetsFlagAndBlocksWrites` — propose Pause (or
   emergencyPause); writes through `whenNotPaused` revert with
   `SystemPaused`.
4. `test_UnpauseRequiresFullTimelock` — propose Unpause; warp 47h
   59m; execute fails `NotReady`; warp +1m; execute succeeds.
5. `test_SignerChangeFlowsThroughTimelock` — propose SignerChange
   (oldSigner=A, newSigner=B); execute after 48h; A is no longer
   signer, B is.
6. `test_EmergencyPauseBypassesTimelock` — emergencyPause with 5
   valid sigs over the EMERGENCY_PAUSE digest; paused flips
   immediately.

### 6.2 Negative paths (THE LOAD-BEARING TESTS)

7. **`test_FourSignersCannotExecute`** — propose; 4 approvals; warp
   48h; execute reverts `InvalidThreshold`.
8. **`test_ExecuteBeforeTimelockReverts`** — propose; 5 approvals;
   warp 47h; execute reverts `NotReady`.
9. **`test_NonSignerCannotPropose`** — random EOA calls propose;
   reverts `NotSigner`.
10. **`test_NonSignerCannotApprove`** — random EOA calls approve;
    reverts `NotSigner`.
11. **`test_DoubleApproveReverts`** — signer A approves twice;
    second reverts `AlreadyApproved`.
12. **`test_CancelledProposalCannotBeExecuted`** — propose; cancel;
    execute reverts `AlreadyExecuted` (state == Cancelled).
13. **`test_DirectUpgradeReverts`** — try to call the target's
    upgrade function directly from a multisig member EOA (not
    through governance flow); reverts `NotGovernance`.
14. **`test_PauseDoesNotGrantUpgrade`** — emergencyPause succeeds;
    multisig member tries to upgrade without going through propose
    + 48h timelock; reverts.
15. **`test_EmergencyPauseRequiresFiveSigs`** — emergencyPause with
    4 valid sigs; reverts `InvalidThreshold`.

### 6.3 Adversarial / property tests

16. **`property_FourMaliciousSignersCannotExecute`** — Echidna /
    Foundry invariant: under any sequence of operations where
    only 4 signers ever approve a given proposal, that proposal
    is never in state Executed.
17. **`property_TimelockIsNeverBypassedForUpgrade`** — invariant:
    for every Upgrade or AdminCall proposal in state Executed,
    `block.timestamp >= readyAt`.
18. **`property_PauseCannotUpgrade`** — invariant: emergencyPause
    only changes `paused`; no other state changes.
19. **`property_RemovedSignerCannotAct`** — after a SignerChange
    proposal removes signer A, A's subsequent approve / propose
    calls revert.

### 6.4 Integration with target contracts

20. `integration_PaymasterUpgradeViaGovernance` — full path:
    propose upgrade of paymaster's accept-list; 5 approvals; warp;
    execute; paymaster state reflects.
21. `integration_RegistryPauseStopsWrites` — pause; attempt
    `ProposalRegistry.announceAward`; reverts `SystemPaused`.
22. `integration_UserAccountUpgradeUnaffected` — Phase A user
    upgrade flow still works regardless of multisig state.
23. `integration_DelegationStillRedeemsWhilePaused` — by design,
    pause stops writes but not redemptions. Verify
    DelegationManager.redeemDelegation still works when paused (or
    add it to pause scope; decide before audit).

[OWE-REVIEWER] Decision: does pause stop redemptions? Pros: total
kill switch. Cons: locks users out of recovering funds. Plan
default: **pause does NOT block redemptions** so users always have
exit liquidity. Confirm.

---

## 7. Operational runbook (post-deployment)

### 7.1 Routine upgrade

1. Developer submits PR to `audit-remediation/*` branch.
2. Security lead reviews; engineering manager approves.
3. Two signers co-author a multisig proposal txn (encoded in a
   `governance-proposal-N.md` doc submitted to the team).
4. Signers approve via hardware wallets.
5. Once 5 approvals on chain, 48-hour countdown begins.
6. Notification posted publicly: "Governance proposal N queued;
   ready at <timestamp>; if you disagree, exit before then."
7. After timelock, any signer (or anyone — `execute` is
   permissionless) calls execute.

### 7.2 Emergency pause

1. Incident detected (alert from monitoring; bug bounty submission;
   internal discovery).
2. Security lead convenes incident channel.
3. 5 signers each sign the `EMERGENCY_PAUSE` digest off-chain.
4. One signer concatenates the 5 sigs and calls `emergencyPause`.
5. Paused state propagates instantly.
6. Investigation; patch development; routine-upgrade flow to
   deploy fix.
7. Once fix is live: queue Unpause proposal (48h timelock).
8. After timelock: unpause; system resumes.

### 7.3 Signer rotation

1. Multisig proposes SignerChange (oldSigner = leaving signer,
   newSigner = incoming signer).
2. 5 approvals; 48h timelock.
3. After timelock: execute applies the change.
4. Leaving signer's hardware destroyed in front of witnesses.

### 7.4 Failover

If 5 signers are unreachable (e.g. natural disaster), governance is
permanently stuck. Mitigation:

- 9-signer set with geographic distribution makes this very
  unlikely.
- Each signer designates a backup who can reconstruct from the
  off-site seed envelope.
- Annual key-ceremony tests the failover path.

We deliberately do NOT add a "guardian override" for failure; that
would defeat the multisig's whole point.

---

## 8. Cost

### 8.1 Implementation cost

- Governance.sol: ~600 LOC; 1 senior contracts dev × 2 weeks =
  ~$30k loaded.
- GovernanceManaged base + retrofit across ~15 system contracts:
  1 senior dev × 1 week = ~$15k.
- Foundry test suite (§6): 1 senior dev × 2 weeks = ~$30k.
- Migration scripts: 1 senior dev × 1 week = ~$15k.
- **Total implementation: ~$90k.**

### 8.2 Operating cost

- Hardware wallets (9 × ~$200 = $1,800).
- Tamper-evident envelopes + safe-deposit-box rentals (9 × $300/yr
  = $2,700/yr).
- Signer time (estimated 4 hours/month per signer for routine
  proposals × 9 signers × loaded rate): ~$40k/yr.
- Annual key ceremony (1 day × 9 signers): ~$10k/yr.
- **Total Year 1: ~$55k.**
- **Total Year 2+: ~$55k/yr.**

### 8.3 Audit cost

This contract MUST be in SC1 audit scope at P0. No incremental cost
beyond SC1 envelope.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| G1 | Multisig contract itself has a bug. | SC1 P0 audit; SC2 formal verification of Governance invariants (signer set monotonicity, threshold enforcement, timelock enforcement). |
| G2 | Hardware wallet supply chain attack on 5+ signers. | Geographic distribution; mixed vendors (some Ledger, some GridPlus); buy from manufacturer direct, not Amazon. |
| G3 | Signer loses hardware. | Off-site backup; failover process per §7.4. |
| G4 | Insider collusion (5 of 9 collude). | Mixed roles (external advisors, board); transparency (every proposal queued is public); ability of any signer to cancel. |
| G5 | Coordination overhead slows critical patches. | Emergency pause provides 0-delay kill switch; routine patch path is 48h; both are realistic. |
| G6 | Migration to new governance breaks live state. | No prod accounts in flight; `fresh-start.sh` re-seeds; explicit migration scripts in §4.4. |
| G7 | Multisig becomes a single point of failure (governance attack). | 5-of-9 with 48h timelock + cancel-by-any-signer; we do not concentrate; signers are bound by signed agreements; no incentive aligned to attack. |
| G8 | Pause is abused (legitimate-looking attack triggers panic pause). | Pause is a multisig action with same threshold as any other; not unilateral. Public log of every pause event. |
| G9 | DelegationManager / enforcer non-upgradeability locks in a bug. | §4.3.4-§4.3.5 commitment is explicit; SC1 + SC3 priced to find these bugs early; migration paths documented. |
| G10 | Governance contract upgrade itself: who governs the governor? | Plan: Governance is NOT upgradeable in v1 (immutable contract). If a bug surfaces, redeploy + transfer authority via a one-time multisig action across both Governance instances. |

---

## 10. Acceptance criteria

Phase A.5 (this spec) is complete when ALL of:

- [ ] `Governance.sol` implemented per §4.1.
- [ ] `GovernanceManaged` base per §4.2.
- [ ] Every system contract identified in §1 retrofitted per §4.3.
- [ ] Foundry test suite (§6) passes.
- [ ] Forge coverage on `governance/` ≥ 95%.
- [ ] Migration scripts in `packages/contracts/script/` for fresh
      deploy.
- [ ] `scripts/fresh-start.sh` updated to deploy governance + new
      system contracts.
- [ ] Per-contract verification of "Upgradeable?" and "Admin
      authority" columns (§1 OWE-REVIEWER item).
- [ ] Halmos / Echidna specs for property tests (§6.3).
- [ ] Operational runbook in `docs/runbooks/governance-multisig.md`.
- [ ] Multisig member candidates identified; key-custody agreements
      signed.
- [ ] Initial key ceremony scheduled.

---

## 11. Open questions

1. Does pause block redemptions or only writes? (§6.4 OWE)
2. Confirm initial signer list (§3 OWE).
3. Is OntologyTermRegistry's admin model what we think it is?
   (§4.3.2 OWE)
4. Is ShapeRegistry's admin model what we think it is? (§4.3.3 OWE)
5. Do we add a "user-funds escape hatch" for the case where
   multisig is permanently stuck? Plan default: no (defeats the
   point). Confirm with security lead.
6. Hardware wallet vendor mix — single vendor (operationally simpler)
   vs. dual vendor (supply-chain resilience). Plan default: dual.
7. Initial key ceremony venue + observers.

---

## 12. Next actions

1. Engineering manager: open a Phase A.5 spec under
   `specs/007-architecture-hardening/phase-A5-upgrade-governance.md`
   referencing this doc.
2. Developer: implement `Governance.sol` + tests on a feature branch.
3. Security lead: drive signer-set decision through board; collect
   key-custody agreement signatures.
4. Engineering manager: schedule initial key ceremony 6 weeks out.
5. After implementation lands: bundle into SC1 audit scope at P0.
