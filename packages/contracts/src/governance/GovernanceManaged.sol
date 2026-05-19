// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./IGovernance.sol";

/**
 * @title GovernanceManaged
 * @notice Base contract that gates admin functions behind a single
 *         `Governance` multisig + timelock, and exposes a pause hook so
 *         downstream writes can be killed system-wide in an incident.
 *
 *         Spec 007 Phase A.5 (SC4 § 4.2). The `governance` address is
 *         immutable per deploy — to "upgrade" governance for a contract,
 *         you redeploy the contract pointing at the new governance.
 *         Governance itself is non-upgradeable.
 *
 *         Inheritors gain:
 *           - `onlyGovernance` modifier for setters / admin functions.
 *           - `whenNotPaused` modifier for write-surface functions that
 *             should freeze during an incident.
 *           - A pause-aware view (`paused()`) for off-chain tooling.
 */
abstract contract GovernanceManaged {
    /// @notice The Governance multisig + timelock contract that owns
    ///         admin authority over this contract.
    address public immutable governance;

    error NotGovernance();
    error SystemPaused();
    error ZeroGovernance();

    constructor(address governance_) {
        if (governance_ == address(0)) revert ZeroGovernance();
        governance = governance_;
    }

    /// @dev Only the governance contract (executing a passed proposal)
    ///      can call functions protected by this modifier.
    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    /// @dev Reverts when the governance pause flag is set. Read-only
    ///      functions stay live; this is for write-surface protection
    ///      only.
    modifier whenNotPaused() {
        if (IGovernanceView(governance).isPaused()) revert SystemPaused();
        _;
    }

    /// @notice Read the global pause flag.
    function paused() external view returns (bool) {
        return IGovernanceView(governance).isPaused();
    }
}
