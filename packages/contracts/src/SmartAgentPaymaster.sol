// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "account-abstraction/core/BasePaymaster.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/interfaces/PackedUserOperation.sol";
import "./governance/IGovernance.sol";

/**
 * @title SmartAgentPaymaster
 * @notice ERC-4337 v0.7 paymaster that sponsors gas at the EntryPoint level so
 *         that the master/bundler EOA's balance is fully decoupled from per-op
 *         gas economics. A userOp sets `paymasterAndData = <this paymaster>` and
 *         the EntryPoint reimburses the bundler from this paymaster's
 *         on-EntryPoint deposit.
 *
 * Design posture (v1):
 *   - DEV-SAFE accept-all policy. `_validatePaymasterUserOp` returns
 *     `(bytes(""), 0)` for every userOp, regardless of sender or callData.
 *   - The `_acceptList` mapping + `OWNER_ROLE` admin surface is wired so that
 *     a follow-up production PR can flip `_dev = false` and require senders to
 *     be allow-listed (or replace this with a verifying-paymaster variant that
 *     checks an off-chain signature in `paymasterData`).
 *   - No per-call accounting needed → `_postOp` is a no-op and
 *     `_validatePaymasterUserOp` returns empty context, telling EntryPoint to
 *     skip the postOp call entirely (saves ~30k gas per op).
 *
 * Production checklist (DO BEFORE PUBLIC DEPLOY):
 *   1. Set `_dev = false` via `setDevMode(false)`.
 *   2. Populate `_acceptList` with the canonical AgentAccountFactory and/or
 *      the set of legitimate smart-account senders.
 *   3. Decide whether to upgrade to a verifying-paymaster (off-chain signed
 *      paymasterData) before exposing this to untrusted senders.
 *   4. Monitor `getDeposit()` and alert below a runway threshold.
 *
 * @dev Inherits `addStake`, `unlockStake`, `withdrawStake`, `deposit`, and
 *      `withdrawTo` from BasePaymaster / Stakeable. Owner is set in the
 *      constructor and follows the Ownable2Step transfer pattern.
 */
contract SmartAgentPaymaster is BasePaymaster {
    /// @notice Whether the paymaster is in dev (accept-all) mode.
    /// @dev When `true`, _validatePaymasterUserOp accepts every userOp without
    ///      checking _acceptList. When `false`, only senders present in
    ///      _acceptList (with value == true) are sponsored.
    bool private _dev;

    /// @notice Per-sender allow-list for production mode.
    /// @dev Keyed by userOp.sender (the smart-account address). Owner-managed
    ///      via setAccepted / setAcceptedBatch.
    mapping(address => bool) private _acceptList;

    /// @notice The Governance contract whose pause flag halts paymaster
    ///         validation. Stored as immutable so an attacker who
    ///         compromises governance still cannot redirect the pause
    ///         signal to a contract they control.
    /// @dev Phase A.5 (SC4 § 4.3.1) — the paymaster's Ownable owner is
    ///      ALSO set to this address at construction, so withdraws and
    ///      admin operations flow through governance proposals.
    address public immutable governance;

    /// @notice Reason the paymaster rejected a userOp in production mode.
    error SenderNotAccepted(address sender);
    /// @notice Phase A.5 — global system pause is in effect.
    error SystemPaused();
    error ZeroGovernance();

    event DevModeSet(bool dev);
    event SenderAcceptedSet(address indexed sender, bool accepted);

    /// @dev Storage gap reserves slots for future state. Phase A.5
    ///      (SC7 § 3.1).
    uint256[50] private __gap;

    /// @param entryPointAddr ERC-4337 EntryPoint.
    /// @param initialOwner   Transient Ownable owner used during deploy
    ///                       so the deployer can `addStake` / `deposit`
    ///                       in the same broadcast. Transfer ownership
    ///                       to `governance_` at the end of deploy via
    ///                       `transferOwnership` + `acceptOwnership`.
    /// @param governance_    The Governance contract; sourced for the
    ///                       pause flag. Stored immutable so it cannot
    ///                       be redirected post-deploy.
    constructor(
        IEntryPoint entryPointAddr,
        address initialOwner,
        address governance_
    ) BasePaymaster(entryPointAddr, initialOwner) {
        if (governance_ == address(0)) revert ZeroGovernance();
        governance = governance_;
        // v1 ships in dev mode. Flip via setDevMode(false) before production.
        _dev = true;
        emit DevModeSet(true);
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    /// @dev Phase A.5 — policy setters are governance-only; Ownable
    ///      authority (inherited `addStake`/`withdrawTo`/etc.) is
    ///      transferred to governance at the end of deploy via
    ///      Ownable2Step.
    error NotGovernance();
    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    /// @notice Toggle accept-all (dev) vs. allow-list (prod) policy.
    function setDevMode(bool dev) external onlyGovernance {
        _dev = dev;
        emit DevModeSet(dev);
    }

    /// @notice Add or remove a single sender from the production accept-list.
    function setAccepted(address sender, bool accepted) external onlyGovernance {
        _acceptList[sender] = accepted;
        emit SenderAcceptedSet(sender, accepted);
    }

    /// @notice Batch variant for bulk migrations / seeds.
    function setAcceptedBatch(address[] calldata senders, bool accepted) external onlyGovernance {
        for (uint256 i = 0; i < senders.length; i++) {
            _acceptList[senders[i]] = accepted;
            emit SenderAcceptedSet(senders[i], accepted);
        }
    }

    // ─── Views ──────────────────────────────────────────────────────────

    function devMode() external view returns (bool) {
        return _dev;
    }

    function isAccepted(address sender) external view returns (bool) {
        return _acceptList[sender];
    }

    // ─── Paymaster hook ────────────────────────────────────────────────

    /// @inheritdoc BasePaymaster
    /// @dev Accept-all in dev; allow-list in prod. Returns empty context so
    ///      EntryPoint skips the postOp call (cheaper). `validationData = 0`
    ///      signals "valid signature, valid indefinitely".
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 /*maxCost*/
    ) internal view override returns (bytes memory context, uint256 validationData) {
        // Phase A.5 — refuse to sponsor when the system is paused.
        require(!IGovernanceView(governance).isPaused(), SystemPaused());
        if (!_dev) {
            require(_acceptList[userOp.sender], SenderNotAccepted(userOp.sender));
        }
        return ("", 0);
    }

    /// @inheritdoc BasePaymaster
    /// @dev No per-call accounting in v1. Override to a no-op so EntryPoint
    ///      can call us safely if it ever does (it won't, because we return
    ///      empty context from _validatePaymasterUserOp).
    function _postOp(
        PostOpMode /*mode*/,
        bytes calldata /*context*/,
        uint256 /*actualGasCost*/,
        uint256 /*actualUserOpFeePerGas*/
    ) internal pure override {
        // intentionally empty
    }
}
