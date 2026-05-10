// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579ModuleLifecycle, SmartAgentModuleTypes} from "./IERC7579Module.sol";

interface IDelegationManagerMinimal {
    function revokeDelegation(bytes32 delegationHash) external;
}

/**
 * @title RevocationModule
 * @notice ERC-7579 Executor module (type 2). Single-action contract that
 *         calls `DelegationManager.revokeDelegation` from the account.
 *
 *   This module exists so a hook detecting anomaly (or the account owner
 *   via UserOp) can self-revoke a delegation atomically with detection —
 *   no out-of-band relay needed. Compared to revoking from a session EOA,
 *   revoking from the account itself signals "this revocation has full
 *   delegator authority" to downstream watchers.
 *
 *   Init data shape: abi.encode(address delegationManager)
 *
 *   Usage:
 *     account.execute(
 *       revocationModule,
 *       0,
 *       abi.encodeCall(RevocationModule.revoke, (delegationHash))
 *     )
 *
 *   Only the installing account (msg.sender at install time, same address
 *   that calls `revoke`) can revoke through this module. We use the
 *   AgentAccount's execute path: when the account self-executes a call to
 *   `revoke(hash)`, the call lands here with `msg.sender = account`. Other
 *   callers' calls succeed too — but they revoke under their OWN account's
 *   slot, which is unauthorized at DelegationManager level. Defense in
 *   depth.
 */
contract RevocationModule is IERC7579ModuleLifecycle {
    /// @dev account => DelegationManager set at install
    mapping(address => address) private _delegationManagerOf;

    event RevocationModuleInstalled(address indexed account, address indexed delegationManager);
    event RevocationModuleUninstalled(address indexed account);
    event DelegationRevoked(address indexed account, bytes32 indexed delegationHash);

    error InvalidInitData();
    error NotConfigured(address account);

    function onInstall(bytes calldata data) external override {
        if (data.length == 0) revert InvalidInitData();
        address dm = abi.decode(data, (address));
        if (dm == address(0)) revert InvalidInitData();
        _delegationManagerOf[msg.sender] = dm;
        emit RevocationModuleInstalled(msg.sender, dm);
    }

    function onUninstall(bytes calldata) external override {
        delete _delegationManagerOf[msg.sender];
        emit RevocationModuleUninstalled(msg.sender);
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == SmartAgentModuleTypes.TYPE_EXECUTOR;
    }

    function moduleId() external pure override returns (string memory) {
        return "smart-agent.revocation-module.1";
    }

    /// @notice Revoke a delegation hash on behalf of `msg.sender` (the calling account).
    function revoke(bytes32 delegationHash) external {
        address dm = _delegationManagerOf[msg.sender];
        if (dm == address(0)) revert NotConfigured(msg.sender);
        IDelegationManagerMinimal(dm).revokeDelegation(delegationHash);
        emit DelegationRevoked(msg.sender, delegationHash);
    }

    function delegationManagerOf(address account) external view returns (address) {
        return _delegationManagerOf[account];
    }
}
