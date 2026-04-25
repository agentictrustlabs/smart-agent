// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./CaveatEnforcerBase.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title RecoveryEnforcer
 * @notice ERC-7710 caveat for guardian-triggered account recovery.
 *
 *   Gates the delegated execution behind TWO conditions:
 *     1. At least `threshold` signatures from the configured guardian set,
 *        each over the canonical intent hash.
 *     2. A `delaySeconds` timelock after `propose(intentHash)` was called —
 *        giving the account owner a chance to cancel a hostile recovery.
 *
 *   Usage model:
 *     Owner creates a delegation to some agreed-upon `redeemer` (could be
 *     any of the guardians) scoped with caveats:
 *       - RecoveryEnforcer(terms: guardians + threshold + delay)
 *       - AllowedTargets([account])
 *       - AllowedMethods([addPasskey, removePasskey, addOwner, removeOwner, …])
 *
 *     Someone calls `propose(intentHash)` — logs the clock start.
 *     `delaySeconds` later, guardians sign the intent hash off-chain and one
 *     of them redeems the delegation with (intentHash, signatures) as args.
 *
 *   terms = abi.encode(address[] guardians, uint256 threshold, uint256 delaySeconds)
 *   args  = abi.encode(bytes32 intentHash, bytes[] signatures)
 *
 *   Where intentHash is:
 *     keccak256(abi.encode("smart-agent.recovery.v1", chainId, delegator, target, value, callData))
 *
 *   Any guardian can `propose(intentHash)` — it's rate-limited only by the
 *   delay, so a replay of a stale intent is blocked by the timelock-already-
 *   consumed check.
 */
contract RecoveryEnforcer is CaveatEnforcerBase {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @notice Map of proposed recoveries → first-proposed timestamp.
    ///         Keyed by (delegator, intentHash) so two accounts can't collide.
    mapping(address => mapping(bytes32 => uint64)) public proposedAt;
    /// @notice Consumed intents (prevents replay of a successful recovery).
    mapping(address => mapping(bytes32 => bool)) public consumed;

    event RecoveryProposed(address indexed delegator, bytes32 indexed intentHash, uint64 at);
    event RecoveryConsumed(address indexed delegator, bytes32 indexed intentHash, uint64 at);

    error InvalidTerms();
    error InvalidArgs();
    error IntentHashMismatch();
    error DelayNotElapsed(uint64 readyAt);
    error NotProposed();
    error AlreadyConsumed();
    error DuplicateSigner(address signer);
    error UnknownGuardian(address recovered);
    error InsufficientSignatures(uint256 provided, uint256 threshold);

    function moduleId() external pure override returns (string memory) {
        return "smart-agent-recovery-enforcer-1";
    }

    /// @notice Record that an intent has been proposed. Open to anyone —
    ///         economic cost is gas, semantic cost is the subsequent delay
    ///         which gives the owner time to notice and cancel.
    function propose(address delegator, bytes32 intentHash) external {
        proposedAt[delegator][intentHash] = uint64(block.timestamp);
        emit RecoveryProposed(delegator, intentHash, uint64(block.timestamp));
    }

    /// @notice Owner can cancel a proposal during the delay. Callable by the
    ///         delegator (the account itself) via a normal UserOp.
    function cancel(bytes32 intentHash) external {
        delete proposedAt[msg.sender][intentHash];
    }

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32,                    /* delegationHash */
        address delegator,
        address,                    /* redeemer */
        address target,
        uint256 value,
        bytes calldata callData
    ) external override {
        (address[] memory guardians, uint256 threshold, uint256 delaySeconds) = abi.decode(terms, (address[], uint256, uint256));
        if (guardians.length == 0 || threshold == 0 || threshold > guardians.length) revert InvalidTerms();

        (bytes32 intentHash, bytes[] memory sigs) = abi.decode(args, (bytes32, bytes[]));

        // Recompute the canonical intent hash from the live call and match.
        bytes32 expected = keccak256(abi.encode(
            "smart-agent.recovery.v1",
            block.chainid,
            delegator,
            target,
            value,
            callData
        ));
        if (intentHash != expected) revert IntentHashMismatch();

        // Timelock + consumption bookkeeping.
        uint64 proposedTs = proposedAt[delegator][intentHash];
        if (proposedTs == 0) revert NotProposed();
        if (consumed[delegator][intentHash]) revert AlreadyConsumed();
        uint64 readyAt = proposedTs + uint64(delaySeconds);
        if (block.timestamp < readyAt) revert DelayNotElapsed(readyAt);

        // Threshold of distinct guardian signatures.
        if (sigs.length < threshold) revert InsufficientSignatures(sigs.length, threshold);
        _verifyGuardianSignatures(guardians, threshold, intentHash, sigs);

        // Mark consumed — future redeems of the same intent fail even if the
        // delegation is still otherwise redeemable.
        consumed[delegator][intentHash] = true;
        emit RecoveryConsumed(delegator, intentHash, uint64(block.timestamp));
    }

    function afterHook(
        bytes calldata, bytes calldata, bytes32,
        address, address, address, uint256, bytes calldata
    ) external pure override {}

    /// @dev Verify threshold of distinct guardian ECDSA signatures over
    ///      the eth-signed-message wrap of intentHash.
    function _verifyGuardianSignatures(
        address[] memory guardians,
        uint256 threshold,
        bytes32 intentHash,
        bytes[] memory sigs
    ) private pure {
        bytes32 ethSigned = intentHash.toEthSignedMessageHash();
        // Track seen signers inline to reject duplicates without using storage.
        address[] memory seen = new address[](sigs.length);
        uint256 seenLen;
        uint256 validCount;
        for (uint256 i; i < sigs.length; i++) {
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(ethSigned, sigs[i]);
            if (err != ECDSA.RecoverError.NoError) continue;
            // Reject duplicates.
            for (uint256 j; j < seenLen; j++) {
                if (seen[j] == recovered) revert DuplicateSigner(recovered);
            }
            // Must be an authorised guardian.
            bool ok = false;
            for (uint256 j; j < guardians.length; j++) {
                if (guardians[j] == recovered) { ok = true; break; }
            }
            if (!ok) revert UnknownGuardian(recovered);
            seen[seenLen++] = recovered;
            validCount++;
            if (validCount >= threshold) return;
        }
        revert InsufficientSignatures(validCount, threshold);
    }

    /// @notice Canonical intent-hash helper for callers.
    function computeIntentHash(
        uint256 chainId,
        address delegator,
        address target,
        uint256 value,
        bytes memory callData
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(
            "smart-agent.recovery.v1",
            chainId,
            delegator,
            target,
            value,
            callData
        ));
    }
}
