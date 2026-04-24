// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";
import "../modules/IERC7579Module.sol";

/**
 * @title CaveatEnforcerBase
 * @notice Shared base for caveat enforcers that want to expose the
 *         ERC-7579 introspection shape. Each enforcer only has to
 *         override `moduleId()`.
 */
abstract contract CaveatEnforcerBase is ICaveatEnforcer, IERC7579Module {
    function isModuleType(uint256 moduleTypeId) external pure virtual override returns (bool) {
        return moduleTypeId == SmartAgentModuleTypes.TYPE_CAVEAT_ENFORCER;
    }

    function moduleId() external pure virtual override returns (string memory);
}
