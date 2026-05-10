// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title CallDataHashEnforcer
 * @notice Locks a sub-delegation to exactly one calldata payload.
 *
 * @dev terms = abi.encode(bytes32 expectedHash)
 *      where `expectedHash == keccak256(callData)` for the single call
 *      this delegation authorizes.
 *
 *      At redeem time `beforeHook` recomputes `keccak256(executionCallData)`
 *      and reverts if it doesn't match. Pairs with `TaskBindingEnforcer`
 *      to give sub-delegations BOTH a runtime calldata gate (this enforcer)
 *      and an audit-time task tag (TaskBindingEnforcer). Combined with a
 *      tight `TimestampEnforcer` window + post-redeem revocation, the
 *      result is a single-use, task-bound, calldata-locked grant — the
 *      Phase 2 "promoted ops" envelope.
 */
contract CallDataHashEnforcer is ICaveatEnforcer {
    error BadTermsLength();
    error CallDataMismatch(bytes32 expected, bytes32 actual);

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata callData
    ) external pure override {
        if (terms.length != 32) revert BadTermsLength();
        bytes32 expected = abi.decode(terms, (bytes32));
        bytes32 actual = keccak256(callData);
        if (expected != actual) revert CallDataMismatch(expected, actual);
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
    ) external pure override {
        // No post-execution check needed.
    }
}
