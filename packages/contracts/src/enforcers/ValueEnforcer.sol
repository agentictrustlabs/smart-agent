// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title ValueEnforcer
 * @notice Enforces a maximum ETH value per call.
 * @dev terms = abi.encode(uint256 maxValue)
 *      Follows ERC-7710 / MetaMask DeleGator beforeHook/afterHook pattern.
 */
contract ValueEnforcer is ICaveatEnforcer {
    error ValueExceedsLimit();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256 value,
        bytes calldata
    ) external pure override {
        uint256 maxValue = abi.decode(terms, (uint256));
        if (value > maxValue) revert ValueExceedsLimit();
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
