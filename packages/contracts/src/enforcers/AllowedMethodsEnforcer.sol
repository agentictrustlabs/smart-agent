// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title AllowedMethodsEnforcer
 * @notice Restricts delegated calls to specific function selectors.
 * @dev terms = abi.encode(bytes4[] allowedSelectors)
 *      Follows ERC-7710 / MetaMask DeleGator beforeHook/afterHook pattern.
 */
contract AllowedMethodsEnforcer is ICaveatEnforcer {
    error MethodNotAllowed();
    error CalldataTooShort();

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
        if (callData.length < 4) revert CalldataTooShort();

        bytes4 selector = bytes4(callData[:4]);
        bytes4[] memory allowed = abi.decode(terms, (bytes4[]));
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == selector) return;
        }
        revert MethodNotAllowed();
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
