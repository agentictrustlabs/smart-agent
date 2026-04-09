// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title AllowedTargetsEnforcer
 * @notice Restricts delegated calls to a specific set of target contracts.
 * @dev terms = abi.encode(address[] allowedTargets)
 *      Follows ERC-7710 / MetaMask DeleGator beforeHook/afterHook pattern.
 */
contract AllowedTargetsEnforcer is ICaveatEnforcer {
    error TargetNotAllowed();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address target,
        uint256,
        bytes calldata
    ) external pure override {
        address[] memory allowed = abi.decode(terms, (address[]));
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == target) return;
        }
        revert TargetNotAllowed();
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
