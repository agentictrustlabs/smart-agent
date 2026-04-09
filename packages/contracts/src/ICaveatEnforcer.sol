// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ICaveatEnforcer
 * @notice Interface for caveat enforcers that validate delegation constraints.
 *
 * Each enforcer checks one type of constraint:
 * - TimestampEnforcer: valid within a time window
 * - ValueEnforcer: max ETH value per call
 * - AllowedTargetsEnforcer: restrict to specific contracts
 * - AllowedMethodsEnforcer: restrict to specific function selectors
 */
interface ICaveatEnforcer {
    /**
     * @notice Validate that a delegated action satisfies this caveat.
     * @param terms Encoded parameters specific to this enforcer type.
     * @param caller The address attempting to redeem the delegation.
     * @param target The target contract being called.
     * @param value The ETH value being sent.
     * @param data The calldata for the target call.
     * @return True if the caveat is satisfied, false otherwise.
     */
    function enforceCaveat(
        bytes calldata terms,
        address caller,
        address target,
        uint256 value,
        bytes calldata data
    ) external view returns (bool);
}
