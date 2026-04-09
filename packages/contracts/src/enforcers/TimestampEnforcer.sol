// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title TimestampEnforcer
 * @notice Enforces a time window — delegation is only valid between two timestamps.
 * @dev terms = abi.encode(uint256 validAfter, uint256 validUntil)
 *      Follows ERC-7710 / MetaMask DeleGator beforeHook/afterHook pattern.
 */
contract TimestampEnforcer is ICaveatEnforcer {
    error TimestampNotYetValid();
    error TimestampExpired();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external view override {
        (uint256 validAfter, uint256 validUntil) = abi.decode(terms, (uint256, uint256));
        if (block.timestamp < validAfter) revert TimestampNotYetValid();
        if (block.timestamp > validUntil) revert TimestampExpired();
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
        // No post-execution check needed for timestamps
    }
}
