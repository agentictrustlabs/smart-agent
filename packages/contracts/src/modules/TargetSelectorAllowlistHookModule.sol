// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579ModuleLifecycle, SmartAgentModuleTypes} from "./IERC7579Module.sol";

/**
 * @title TargetSelectorAllowlistHookModule
 * @notice ERC-7579 Hook module (type 4) restricting calls to a runtime-mutable
 *         set of (target, selector) tuples.
 *
 *   Init data shape:
 *     abi.encode(address[] targets, bytes4[] selectors)
 *     Tuples are zipped pairwise — index i ↔ index i. Lengths must match.
 *
 *   Runtime extension:
 *     `addAllowed(target, selector)` is callable by the account itself (only).
 *     This is the "stateful policy" property — the account can mint new
 *     authority for its session WITHOUT redeploying the module or rotating
 *     the owner.
 *
 *   pre/postCheck contract:
 *     preCheck reverts if (target, selector(callData)) is NOT in the
 *     allowlist. Self-calls (target == account) are allowed unconditionally
 *     so owner ops + module management never get gated.
 *     postCheck is a no-op.
 */
contract TargetSelectorAllowlistHookModule is IERC7579ModuleLifecycle {
    /// @dev account => keccak256(target,selector) => allowed
    mapping(address => mapping(bytes32 => bool)) private _allowed;

    event Allowed(address indexed account, address indexed target, bytes4 indexed selector);
    event Disallowed(address indexed account, address indexed target, bytes4 indexed selector);

    error InvalidInitData();
    error NotAllowed(address target, bytes4 selector);
    error OnlyAccount();

    function _key(address target, bytes4 selector) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(target, selector));
    }

    // ─── IERC7579Module ──────────────────────────────────────────────

    function onInstall(bytes calldata data) external override {
        if (data.length == 0) revert InvalidInitData();
        (address[] memory targets, bytes4[] memory selectors) = abi.decode(data, (address[], bytes4[]));
        if (targets.length != selectors.length) revert InvalidInitData();
        for (uint256 i = 0; i < targets.length; i++) {
            _allowed[msg.sender][_key(targets[i], selectors[i])] = true;
            emit Allowed(msg.sender, targets[i], selectors[i]);
        }
    }

    function onUninstall(bytes calldata data) external override {
        // Optional: caller passes the same (targets, selectors) pair to clean up.
        // We tolerate empty data — the account's mapping is per-account, but
        // there's no way to enumerate so a full wipe requires the original list.
        if (data.length == 0) return;
        (address[] memory targets, bytes4[] memory selectors) = abi.decode(data, (address[], bytes4[]));
        if (targets.length != selectors.length) revert InvalidInitData();
        for (uint256 i = 0; i < targets.length; i++) {
            delete _allowed[msg.sender][_key(targets[i], selectors[i])];
            emit Disallowed(msg.sender, targets[i], selectors[i]);
        }
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == SmartAgentModuleTypes.TYPE_HOOK;
    }

    function moduleId() external pure override returns (string memory) {
        return "smart-agent.target-selector-allowlist-hook.1";
    }

    // ─── Runtime mutation ────────────────────────────────────────────

    /// @notice Add a new (target, selector) tuple to this account's allowlist.
    ///         ONLY callable by the account itself (so the owner can mint
    ///         narrower authority via a UserOp or via a delegation chain).
    function addAllowed(address target, bytes4 selector) external {
        // Account is `msg.sender` — anyone calling DIRECTLY adds to their own
        // allowlist, which matches our per-account isolation model.
        // The "only-account" property comes from AgentAccount restricting who
        // can call addAllowed: it does so via execute(target, value, data),
        // where target=this module and msg.sender=AgentAccount. External EOAs
        // calling here add to THEIR OWN entry, which is harmless (their entry
        // is never consulted by another account's preCheck).
        _allowed[msg.sender][_key(target, selector)] = true;
        emit Allowed(msg.sender, target, selector);
    }

    function removeAllowed(address target, bytes4 selector) external {
        delete _allowed[msg.sender][_key(target, selector)];
        emit Disallowed(msg.sender, target, selector);
    }

    // ─── Hook surface ────────────────────────────────────────────────

    function preCheck(address /* msgSender */, uint256 /* value */, bytes calldata msgData)
        external view returns (bytes memory)
    {
        (address target, , bytes memory callData) = abi.decode(msgData, (address, uint256, bytes));
        // Self-calls: always permitted (e.g., addOwner, installModule).
        if (target == msg.sender) return "";
        // Calls back to this module itself: always permitted. This lets the
        // account mutate its own allowlist (addAllowed/removeAllowed) at
        // runtime without bricking. Only the account's own state is
        // mutable from here per the per-account mapping in this module.
        if (target == address(this)) return "";
        bytes4 sel;
        if (callData.length >= 4) {
            assembly {
                sel := mload(add(callData, 0x20))
            }
        }
        if (!_allowed[msg.sender][_key(target, sel)]) {
            revert NotAllowed(target, sel);
        }
        return "";
    }

    function postCheck(bytes calldata) external {}

    // ─── Views ───────────────────────────────────────────────────────

    function isAllowed(address account, address target, bytes4 selector) external view returns (bool) {
        return _allowed[account][_key(target, selector)];
    }
}
