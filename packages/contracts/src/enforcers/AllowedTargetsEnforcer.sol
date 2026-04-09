// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title AllowedTargetsEnforcer
 * @notice Restricts delegated calls to a specific set of target contracts.
 * @dev terms = abi.encode(address[] allowedTargets)
 */
contract AllowedTargetsEnforcer is ICaveatEnforcer {
    function enforceCaveat(
        bytes calldata terms,
        address,
        address target,
        uint256,
        bytes calldata
    ) external pure override returns (bool) {
        address[] memory allowed = abi.decode(terms, (address[]));
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == target) return true;
        }
        return false;
    }
}
