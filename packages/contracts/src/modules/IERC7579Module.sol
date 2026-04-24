// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IERC7579Module
 * @notice Minimal marker interface from ERC-7579 so external tooling can
 *         introspect our modules without requiring a full 7579 account port.
 *
 *   Our AgentAccount is not a full ERC-7579 account — it keeps the
 *   MetaMask-DeleGator-style execution model. But our module contracts
 *   (validators, enforcers) can declare themselves as 7579-shaped so
 *   compatible wallets and explorers identify them correctly.
 *
 *   Module type ids (from the ERC-7579 spec):
 *     1  Validator           — validates signatures / UserOps
 *     2  Executor            — executes on behalf of the account
 *     3  Fallback            — receives arbitrary calls
 *     4  Hook                — pre/post execution hooks
 *     5  Policy              — Kernel-style policy attachment (not in base spec)
 *
 *   We use TYPE_VALIDATOR for PasskeyValidator and a custom
 *   TYPE_CAVEAT_ENFORCER (id=100, outside the 7579 reserved range) for our
 *   delegation caveat enforcers, so standard tooling doesn't mis-type them
 *   while still picking up the 7579 introspection shape.
 */
interface IERC7579Module {
    /**
     * @notice Returns true iff this module implements the given module type.
     * @dev Callers pass one of the canonical type ids listed above.
     */
    function isModuleType(uint256 moduleTypeId) external view returns (bool);

    /// @notice Stable identifier for this module implementation.
    ///         Format is implementation-defined; most deployments use
    ///         `{vendor}-{kind}-{version}` e.g. "smart-agent-rate-limit-1".
    function moduleId() external view returns (string memory);
}

library SmartAgentModuleTypes {
    uint256 internal constant TYPE_VALIDATOR = 1;
    uint256 internal constant TYPE_EXECUTOR  = 2;
    uint256 internal constant TYPE_FALLBACK  = 3;
    uint256 internal constant TYPE_HOOK      = 4;
    // Smart-Agent-specific — outside the ERC-7579 reserved range to avoid
    // accidental cross-classification by ecosystem tools.
    uint256 internal constant TYPE_CAVEAT_ENFORCER = 100;
}
