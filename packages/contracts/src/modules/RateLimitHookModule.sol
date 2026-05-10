// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579ModuleLifecycle, SmartAgentModuleTypes} from "./IERC7579Module.sol";

/**
 * @title RateLimitHookModule
 * @notice ERC-7579 Hook module (type 4) enforcing a rolling-window call cap.
 *
 *   Init data shape:
 *     abi.encode(uint256 windowSeconds, uint256 maxCalls)
 *
 *   Per-account state: every install scopes by msg.sender so the same
 *   module instance serves many accounts.
 *
 *   pre/postCheck contract:
 *     preCheck reverts if the current count for the window would exceed
 *     `maxCalls`. If the previous window has fully elapsed, we reset
 *     before checking.
 *     postCheck increments the count.
 *
 *   This separation means a reverted call (whose preCheck passed but whose
 *   inner call failed) still counts toward the limit — important so a
 *   spammer can't burn rate-limit budget by repeatedly forcing failures.
 *
 *   Note: postCheck only runs on success in our AgentAccount wrapper today,
 *   so technically reverted calls don't count. For Phase 3 v1, accept that
 *   tradeoff — the simple semantics are easier to reason about. A future
 *   variant could track in preCheck if a stricter model is needed.
 */
contract RateLimitHookModule is IERC7579ModuleLifecycle {
    struct WindowState {
        uint64 windowSeconds;
        uint64 maxCalls;
        uint64 windowStart;
        uint64 callsInWindow;
    }

    mapping(address => WindowState) private _state;

    event WindowConfigured(address indexed account, uint64 windowSeconds, uint64 maxCalls);
    event WindowReset(address indexed account, uint64 newStart);

    error InvalidInitData();
    error RateLimitExceeded(uint64 callsInWindow, uint64 max);

    // ─── IERC7579Module ──────────────────────────────────────────────

    function onInstall(bytes calldata data) external override {
        if (data.length == 0) revert InvalidInitData();
        (uint256 windowSeconds, uint256 maxCalls) = abi.decode(data, (uint256, uint256));
        if (windowSeconds == 0 || maxCalls == 0 || windowSeconds > type(uint64).max || maxCalls > type(uint64).max) {
            revert InvalidInitData();
        }
        _state[msg.sender] = WindowState({
            windowSeconds: uint64(windowSeconds),
            maxCalls: uint64(maxCalls),
            windowStart: uint64(block.timestamp),
            callsInWindow: 0
        });
        emit WindowConfigured(msg.sender, uint64(windowSeconds), uint64(maxCalls));
    }

    function onUninstall(bytes calldata) external override {
        delete _state[msg.sender];
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == SmartAgentModuleTypes.TYPE_HOOK;
    }

    function moduleId() external pure override returns (string memory) {
        return "smart-agent.rate-limit-hook.1";
    }

    // ─── Hook surface ────────────────────────────────────────────────

    function preCheck(address /* msgSender */, uint256 /* value */, bytes calldata /* msgData */)
        external returns (bytes memory)
    {
        WindowState storage s = _state[msg.sender];
        if (s.maxCalls == 0) return ""; // module not configured for this account

        if (block.timestamp >= uint256(s.windowStart) + uint256(s.windowSeconds)) {
            s.windowStart = uint64(block.timestamp);
            s.callsInWindow = 0;
            emit WindowReset(msg.sender, s.windowStart);
        }
        if (s.callsInWindow + 1 > s.maxCalls) {
            revert RateLimitExceeded(s.callsInWindow, s.maxCalls);
        }
        return "";
    }

    function postCheck(bytes calldata /* hookData */) external {
        WindowState storage s = _state[msg.sender];
        if (s.maxCalls == 0) return;
        s.callsInWindow += 1;
    }

    // ─── Views ───────────────────────────────────────────────────────

    function getState(address account) external view returns (
        uint64 windowSeconds,
        uint64 maxCalls,
        uint64 windowStart,
        uint64 callsInWindow
    ) {
        WindowState memory s = _state[account];
        return (s.windowSeconds, s.maxCalls, s.windowStart, s.callsInWindow);
    }
}
