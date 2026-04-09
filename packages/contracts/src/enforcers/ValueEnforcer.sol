// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title ValueEnforcer
 * @notice Enforces a maximum ETH value per call.
 * @dev terms = abi.encode(uint256 maxValue)
 */
contract ValueEnforcer is ICaveatEnforcer {
    function enforceCaveat(
        bytes calldata terms,
        address,
        address,
        uint256 value,
        bytes calldata
    ) external pure override returns (bool) {
        uint256 maxValue = abi.decode(terms, (uint256));
        return value <= maxValue;
    }
}
