// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";
import "../AgentNameRegistry.sol";

/**
 * @title NameScopeEnforcer
 * @notice Caveat enforcer for delegated name subtree control.
 *
 * Constrains a DelegationManager delegation to only create names
 * within a specific subtree of the .agent namespace.
 *
 * Usage: An org delegates "manage names under yourorg.agent" to an operator
 * by including this enforcer with terms = abi.encode(parentNode).
 *
 * @dev terms = abi.encode(bytes32 authorizedParentNode)
 *      The delegation is valid only if the target call is
 *      AgentNameRegistry.register(parentNode, ...) where parentNode
 *      equals the authorized parent or is a descendant of it.
 */
contract NameScopeEnforcer is ICaveatEnforcer {

    error NameOutOfScope();
    error InvalidTarget();

    // AgentNameRegistry.register selector
    bytes4 private constant REGISTER_SELECTOR = bytes4(keccak256("register(bytes32,string,address,address,uint64)"));

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address target,
        uint256,
        bytes calldata callData
    ) external view override {
        bytes32 authorizedParent = abi.decode(terms, (bytes32));

        // Verify the call is to register()
        if (callData.length < 4) revert InvalidTarget();
        bytes4 selector = bytes4(callData[:4]);
        if (selector != REGISTER_SELECTOR) revert InvalidTarget();

        // Extract the parentNode argument from calldata (first parameter after selector)
        bytes32 callParentNode = abi.decode(callData[4:36], (bytes32));

        // The callParentNode must be the authorized parent or a descendant
        if (callParentNode == authorizedParent) return; // exact match

        // Walk up from callParentNode to see if authorizedParent is an ancestor
        AgentNameRegistry registry = AgentNameRegistry(target);
        bytes32 current = callParentNode;
        for (uint8 i = 0; i < 10; i++) {
            bytes32 parentNode = registry.parent(current);
            if (parentNode == bytes32(0)) revert NameOutOfScope();
            if (parentNode == authorizedParent) return; // found ancestor
            current = parentNode;
        }

        revert NameOutOfScope();
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
        // No post-execution check needed
    }
}
