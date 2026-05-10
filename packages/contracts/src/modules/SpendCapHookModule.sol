// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579ModuleLifecycle, SmartAgentModuleTypes} from "./IERC7579Module.sol";

/**
 * @title SpendCapHookModule
 * @notice ERC-7579 Hook module (type 4) that enforces a per-(account, asset)
 *         spend cap across the lifetime of the install. ETH is keyed at
 *         `address(0)`; ERC-20s detected via the `transfer(address,uint256)`
 *         selector (`0xa9059cbb`).
 *
 *   Init data shape:
 *     abi.encode((address asset, uint256 budget)[])
 *
 *   Per-account budgets are stored under `msg.sender` so the same module
 *   contract serves many accounts.
 *
 *   pre/postCheck contract (Phase 3 AgentAccount):
 *     preCheck(msgSender, value, msgData):
 *       - msgData = abi.encode(target, value, callData)
 *       - if target == account, skip (self-calls don't drain budget)
 *       - if value > 0, charge against asset=address(0)
 *       - else if callData starts with the ERC-20 transfer selector,
 *           charge against asset=target (the token contract)
 *     postCheck commits the charge to `spent`.
 *
 *   We do the budget check in preCheck (revert before the call lands) and
 *   the spent-increment in postCheck (only after the call succeeded), so
 *   reverted user ops don't bleed budget.
 */
contract SpendCapHookModule is IERC7579ModuleLifecycle {
    bytes4 internal constant ERC20_TRANSFER_SELECTOR = 0xa9059cbb;

    struct Budget {
        uint256 max;     // 0 = no budget (skip)
        uint256 spent;
    }

    /// @dev account => asset => Budget
    mapping(address => mapping(address => Budget)) private _budgets;
    /// @dev account => list of assets that have a budget set (for full reset on uninstall)
    mapping(address => address[]) private _assetsForAccount;
    /// @dev account => asset => whether asset is in _assetsForAccount (dedup on install)
    mapping(address => mapping(address => bool)) private _assetSeen;

    event BudgetSet(address indexed account, address indexed asset, uint256 max);
    event Spent(address indexed account, address indexed asset, uint256 amount, uint256 newTotal);

    error InvalidInitData();
    error SpendCapExceeded(address asset, uint256 attempted, uint256 budget, uint256 already);

    // ─── Hook state passed via abi-encoded blob ─────────────────────

    struct HookContext {
        address asset;
        uint256 amount;
    }

    // ─── IERC7579Module ──────────────────────────────────────────────

    function onInstall(bytes calldata data) external override {
        if (data.length == 0) revert InvalidInitData();
        (address[] memory assets, uint256[] memory budgets) = abi.decode(data, (address[], uint256[]));
        if (assets.length != budgets.length) revert InvalidInitData();
        for (uint256 i = 0; i < assets.length; i++) {
            _budgets[msg.sender][assets[i]] = Budget({max: budgets[i], spent: 0});
            if (!_assetSeen[msg.sender][assets[i]]) {
                _assetsForAccount[msg.sender].push(assets[i]);
                _assetSeen[msg.sender][assets[i]] = true;
            }
            emit BudgetSet(msg.sender, assets[i], budgets[i]);
        }
    }

    function onUninstall(bytes calldata) external override {
        address[] storage list = _assetsForAccount[msg.sender];
        for (uint256 i = 0; i < list.length; i++) {
            delete _budgets[msg.sender][list[i]];
            delete _assetSeen[msg.sender][list[i]];
        }
        delete _assetsForAccount[msg.sender];
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == SmartAgentModuleTypes.TYPE_HOOK;
    }

    function moduleId() external pure override returns (string memory) {
        return "smart-agent.spend-cap-hook.1";
    }

    // ─── Hook surface ────────────────────────────────────────────────

    function preCheck(address /* msgSender */, uint256 /* value */, bytes calldata msgData)
        external view returns (bytes memory)
    {
        (address target, uint256 callValue, bytes memory callData) =
            abi.decode(msgData, (address, uint256, bytes));

        // Self-call: never charges budget.
        if (target == msg.sender) {
            return abi.encode(HookContext(address(0), 0));
        }

        // ETH transfer: any call carrying value charges asset=address(0).
        if (callValue > 0) {
            _assertWithinBudget(msg.sender, address(0), callValue);
            return abi.encode(HookContext(address(0), callValue));
        }

        // ERC-20 transfer: selector + abi-encoded (to, amount).
        if (callData.length >= 4 + 32 + 32) {
            bytes4 sel = _selector(callData);
            if (sel == ERC20_TRANSFER_SELECTOR) {
                // Decode the (to, amount) tuple skipping the 4-byte selector.
                uint256 amount;
                assembly {
                    // callData layout (memory): [length(32)][bytes...]
                    // selector occupies bytes[0..4], `to` bytes[4..36], `amount` bytes[36..68]
                    let dataPtr := add(callData, 0x20)
                    amount := mload(add(dataPtr, 0x24))
                }
                _assertWithinBudget(msg.sender, target, amount);
                return abi.encode(HookContext(target, amount));
            }
        }

        // No spend-relevant action — empty context.
        return abi.encode(HookContext(address(0), 0));
    }

    function postCheck(bytes calldata hookData) external {
        HookContext memory ctx = abi.decode(hookData, (HookContext));
        if (ctx.amount == 0) return; // nothing to commit
        Budget storage b = _budgets[msg.sender][ctx.asset];
        if (b.max == 0) return; // budget cleared between pre/post (paranoia)
        // Saturating add intentionally avoided — preCheck already asserted.
        b.spent += ctx.amount;
        emit Spent(msg.sender, ctx.asset, ctx.amount, b.spent);
    }

    // ─── Views ───────────────────────────────────────────────────────

    function getBudget(address account, address asset) external view returns (uint256 max, uint256 spent) {
        Budget memory b = _budgets[account][asset];
        return (b.max, b.spent);
    }

    function listAssets(address account) external view returns (address[] memory) {
        return _assetsForAccount[account];
    }

    // ─── Internals ───────────────────────────────────────────────────

    function _assertWithinBudget(address account, address asset, uint256 amount) internal view {
        Budget memory b = _budgets[account][asset];
        if (b.max == 0) return; // no budget set for this asset — skip
        if (b.spent + amount > b.max) {
            revert SpendCapExceeded(asset, amount, b.max, b.spent);
        }
    }

    function _selector(bytes memory data) internal pure returns (bytes4 sel) {
        assembly {
            sel := mload(add(data, 0x20))
        }
    }
}
