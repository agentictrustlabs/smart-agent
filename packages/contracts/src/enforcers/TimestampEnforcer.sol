// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title TimestampEnforcer
 * @notice Enforces a time window — delegation is only valid between two timestamps.
 * @dev terms = abi.encode(uint256 validAfter, uint256 validUntil)
 */
contract TimestampEnforcer is ICaveatEnforcer {
    function enforceCaveat(
        bytes calldata terms,
        address,
        address,
        uint256,
        bytes calldata
    ) external view override returns (bool) {
        (uint256 validAfter, uint256 validUntil) = abi.decode(terms, (uint256, uint256));
        return block.timestamp >= validAfter && block.timestamp <= validUntil;
    }
}
