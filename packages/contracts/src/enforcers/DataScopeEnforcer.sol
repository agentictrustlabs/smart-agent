// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title DataScopeEnforcer
 * @notice Caveat enforcer for cross-principal data access delegations.
 *
 * Terms encode the data scope: which MCP server, resources, and fields
 * the delegation grants access to. Enforcement is performed off-chain
 * by the MCP server — this contract exists so the caveat has a valid
 * on-chain enforcer address for the delegation hash.
 *
 * @dev terms = abi.encode(string scopeJson)
 *      The JSON contains: [{ server, resources, fields }]
 *      MCP servers decode and enforce the scope at request time.
 */
contract DataScopeEnforcer is ICaveatEnforcer {
    function beforeHook(
        bytes calldata,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override {
        // Scope enforcement is off-chain (MCP server validates).
        // On-chain: terms are part of the delegation hash, ensuring
        // the scope cannot be modified after signing.
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
        // No post-execution check needed for read-only data access.
    }
}
