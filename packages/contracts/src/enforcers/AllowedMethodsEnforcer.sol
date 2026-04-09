// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title AllowedMethodsEnforcer
 * @notice Restricts delegated calls to specific function selectors.
 * @dev terms = abi.encode(bytes4[] allowedSelectors)
 */
contract AllowedMethodsEnforcer is ICaveatEnforcer {
    function enforceCaveat(
        bytes calldata terms,
        address,
        address,
        uint256,
        bytes calldata data
    ) external pure override returns (bool) {
        if (data.length < 4) return false;

        bytes4 selector = bytes4(data[:4]);
        bytes4[] memory allowed = abi.decode(terms, (bytes4[]));
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == selector) return true;
        }
        return false;
    }
}
