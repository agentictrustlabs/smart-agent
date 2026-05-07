// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title AllocationLimitEnforcer
 * @notice Per-tranche cap. Each disbursement against a given trancheId
 *         decrements a stored counter so the same tranche cannot be paid
 *         twice (or paid in pieces that exceed the cap).
 *
 * @dev terms = abi.encode(bytes32 trancheId, uint256 capAmount, address asset)
 *      args  = abi.encode(uint256 disburseAmount)
 *
 *      State key: `trancheId` is GLOBAL across all delegations because two
 *      delegations referencing the same trancheId should share the budget.
 *      A misuse where the same trancheId appears in two unrelated rounds
 *      is the round-creator's responsibility (recommend
 *      `keccak256(abi.encodePacked(roundId, proposalIRIHash, sequence))`).
 *
 *      Counter increments in `beforeHook`. `afterHook` does NOT decrement —
 *      a successful call permanently consumes the budget. If the underlying
 *      call reverts, the whole tx reverts, and the SSTORE on this counter
 *      reverts with it (same atomic state). Safe behavior.
 */
contract AllocationLimitEnforcer is ICaveatEnforcer {
    error TrancheCapExceeded(uint256 spent, uint256 cap, uint256 attempt);
    error AssetMismatch(address expected, address actual);

    /// trancheId => total spent so far against this tranche
    mapping(bytes32 => uint256) public trancheSpent;

    event TrancheDrawn(bytes32 indexed trancheId, address indexed asset, uint256 amount, uint256 totalSpent, uint256 cap);

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32, // delegationHash
        address, // delegator
        address, // redeemer
        address target,
        uint256, // value
        bytes calldata // callData
    ) external override {
        (bytes32 trancheId, uint256 capAmount, address asset) =
            abi.decode(terms, (bytes32, uint256, address));
        uint256 disburseAmount = abi.decode(args, (uint256));

        // Tie the asset to the call target so a delegation scoped to USDC
        // cannot be redirected to a different token by changing terms in
        // a sibling caveat.
        if (asset != target) revert AssetMismatch(asset, target);

        uint256 spent = trancheSpent[trancheId];
        uint256 next = spent + disburseAmount;
        if (next > capAmount) revert TrancheCapExceeded(spent, capAmount, disburseAmount);

        trancheSpent[trancheId] = next;
        emit TrancheDrawn(trancheId, asset, disburseAmount, next, capAmount);
    }

    function afterHook(
        bytes calldata, bytes calldata, bytes32,
        address, address, address, uint256, bytes calldata
    ) external pure override {}
}
