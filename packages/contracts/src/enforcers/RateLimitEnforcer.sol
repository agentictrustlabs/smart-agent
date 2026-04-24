// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";
import "../modules/IERC7579Module.sol";

/**
 * @title RateLimitEnforcer
 * @notice Caps the number of times a delegation may be redeemed within a
 *         rolling time window. A common ZeroDev / Biconomy pattern, fitted to
 *         our caveat-enforcer shape.
 *
 * @dev terms = abi.encodePacked(
 *        bytes32 scopeKey,     // caller-chosen bucket key (e.g. keccak256("daily-transfers"))
 *        uint32  maxCalls,     // max redemptions per window
 *        uint32  windowSeconds // rolling window length in seconds
 *      )
 *
 *      State is keyed by (delegator, delegationHash, scopeKey) so two
 *      delegations that happen to share a scopeKey don't cross-interfere,
 *      and a redeemer can't bypass by unlinking and re-anchoring the same
 *      scope under a different delegation.
 *
 *      Counter model: a compact (windowStart, callsInWindow) pair. When the
 *      redemption lands outside the current window, the window resets. This
 *      is a fixed-window rate limit — simple, cheap, and predictable. A
 *      sliding-window variant is possible but costs more gas per call.
 */
contract RateLimitEnforcer is ICaveatEnforcer, IERC7579Module {
    // ─── ERC-7579 Marker ──────────────────────────────────────────────
    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == SmartAgentModuleTypes.TYPE_CAVEAT_ENFORCER;
    }

    function moduleId() external pure override returns (string memory) {
        return "smart-agent-rate-limit-enforcer-1";
    }

    struct Bucket {
        uint64 windowStart;   // block.timestamp at the first redemption of the current window
        uint32 callsInWindow; // count so far in this window
    }

    /// delegator => delegationHash => scopeKey => bucket
    mapping(address => mapping(bytes32 => mapping(bytes32 => Bucket))) private _buckets;

    event RateLimitConsumed(
        address indexed delegator,
        bytes32 indexed delegationHash,
        bytes32 indexed scopeKey,
        uint32 callsInWindow,
        uint32 maxCalls,
        uint64 windowStart
    );

    error RateLimitExceeded(uint32 callsInWindow, uint32 maxCalls);
    error InvalidTerms();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32 delegationHash,
        address delegator,
        address,
        address,
        uint256,
        bytes calldata
    ) external override {
        (bytes32 scopeKey, uint32 maxCalls, uint32 windowSeconds) = _decode(terms);
        if (maxCalls == 0 || windowSeconds == 0) revert InvalidTerms();

        Bucket storage b = _buckets[delegator][delegationHash][scopeKey];
        uint64 nowTs = uint64(block.timestamp);

        // Roll the window if expired.
        if (b.windowStart == 0 || nowTs >= b.windowStart + windowSeconds) {
            b.windowStart = nowTs;
            b.callsInWindow = 0;
        }

        uint32 next = b.callsInWindow + 1;
        if (next > maxCalls) revert RateLimitExceeded(b.callsInWindow, maxCalls);
        b.callsInWindow = next;
        emit RateLimitConsumed(delegator, delegationHash, scopeKey, next, maxCalls, b.windowStart);
    }

    function afterHook(
        bytes calldata,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override {}

    // ─── Views ─────────────────────────────────────────────────────────

    function getBucket(
        address delegator,
        bytes32 delegationHash,
        bytes32 scopeKey
    ) external view returns (uint64 windowStart, uint32 callsInWindow) {
        Bucket storage b = _buckets[delegator][delegationHash][scopeKey];
        return (b.windowStart, b.callsInWindow);
    }

    // ─── Encoding ──────────────────────────────────────────────────────

    function encodeTerms(
        bytes32 scopeKey,
        uint32 maxCalls,
        uint32 windowSeconds
    ) external pure returns (bytes memory) {
        return abi.encodePacked(scopeKey, maxCalls, windowSeconds);
    }

    function _decode(bytes calldata terms) private pure returns (bytes32 scopeKey, uint32 maxCalls, uint32 windowSeconds) {
        // Packed layout: 32 + 4 + 4 = 40 bytes
        if (terms.length != 40) revert InvalidTerms();
        scopeKey        = bytes32(terms[0:32]);
        maxCalls        = uint32(bytes4(terms[32:36]));
        windowSeconds   = uint32(bytes4(terms[36:40]));
    }
}
