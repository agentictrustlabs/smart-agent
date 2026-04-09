// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ICaveatEnforcer
 * @notice Interface for caveat enforcers following MetaMask DeleGator patterns.
 *
 * Enforcers validate delegation constraints using a beforeHook/afterHook pattern.
 * They REVERT on failure rather than returning a bool — this aligns with
 * the MetaMask delegation-framework and ERC-7710 conventions.
 *
 * @dev terms: Immutable parameters set when the delegation is created (e.g., time window, allowed methods).
 *      args:  Mutable parameters provided by the redeemer at redemption time (e.g., proof data).
 */
interface ICaveatEnforcer {
    /**
     * @notice Called before the delegated action is executed.
     *         MUST revert if the caveat is not satisfied.
     * @param terms       Encoded parameters set at delegation creation time.
     * @param args        Encoded parameters provided at redemption time.
     * @param delegationHash Hash of the delegation being redeemed.
     * @param delegator   The account that created the delegation.
     * @param redeemer    The address calling redeemDelegation.
     * @param target      The target contract being called.
     * @param value       The ETH value being sent.
     * @param callData    The calldata for the target call.
     */
    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 delegationHash,
        address delegator,
        address redeemer,
        address target,
        uint256 value,
        bytes calldata callData
    ) external;

    /**
     * @notice Called after the delegated action is executed.
     *         MUST revert if post-execution state is invalid.
     *         Not all enforcers need post-hooks — default is a no-op.
     * @param terms       Encoded parameters set at delegation creation time.
     * @param args        Encoded parameters provided at redemption time.
     * @param delegationHash Hash of the delegation being redeemed.
     * @param delegator   The account that created the delegation.
     * @param redeemer    The address calling redeemDelegation.
     * @param target      The target contract being called.
     * @param value       The ETH value being sent.
     * @param callData    The calldata for the target call.
     */
    function afterHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 delegationHash,
        address delegator,
        address redeemer,
        address target,
        uint256 value,
        bytes calldata callData
    ) external;
}
